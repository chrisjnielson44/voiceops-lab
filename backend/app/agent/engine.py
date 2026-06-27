"""
CallEngine — the call's behaviour, factored out of the closures in
`orchestrator.py` into reusable methods.

The legacy `run_orchestrator` keeps its own hand-rolled loop (it stays the
fallback engine). This class holds the same per-call state and operations so the
LangGraph nodes in `app/agent/graph` can drive a call by composing these methods
instead of re-implementing the SSE-emit / audit-hash / context-graph / prediction
logic. Each method maps 1:1 to a former closure, so the two engines produce the
same event stream and an internally-consistent audit chain.

Tracing: methods pass a role `name` to the inference calls (`llm.agent`,
`llm.payer`, `llm.predictor`, `tool.summarize`) so Langfuse shows one generation
per role, nested under the run trace opened in `dispatch.run_call`.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from app.agent.notes import extract_notes
from app.agent.prediction import (
    CONFIDENCE_PREFETCH,
    PREFETCH_TOP,
    normalize_prediction_set,
    prefetch_key,
    stats_summary,
)
from app.agent.reasoning import narrate_graph, narrate_predictions, narrate_think
from app.agent.run_store import RunState, emit
from app.agent.tools import ToolResult
from app.audit.ledger import audit_canonical
from app.config import settings
from app.core.format import clamp, format_time_of_day, now_ms
from app.core.hash import GENESIS_HASH, chain_hash
from app.db import query
from app.llm.local_llm import LLMAborted, chat_json, chat_stream, extract_speak_text_fragment, local_model_id
from app.observability import tracing
from app.packs.registry import get_scenario, pack_for_scenario
from app.schemas import agent as ev
from app.schemas.agent import LiveReasoning, LiveTool, LiveTurn, PrefetchRecord, RunMetrics, Subgraph
from app.schemas.audit import AuditEvent
from app.schemas.simulation import PredictionSnapshot, Scenario

MAX_STEPS = 16
PROMPT_VERSION = settings.voiceops_prompt_version


class CallEngine:
    """Holds the per-call state and the operations both engines share."""

    def __init__(self, run: RunState) -> None:
        self.run = run
        self.scenario: Scenario = get_scenario(run.scenario_id)
        self.pack = pack_for_scenario(self.scenario.id)
        self.t0 = run.started_at

        # Per-role models (see orchestrator.py for the rationale).
        self.agent_model = run.model or local_model_id()
        self.fast_model = (settings.local_llm_fast_model or "").strip() or self.agent_model

        self.seq = 0
        self.audit_seq = 0
        self.prev_hash = GENESIS_HASH
        self.metrics = RunMetrics()
        self.latencies: list[int] = []
        self.audit_buffer: list[dict[str, Any]] = []

        self.agent_msgs: list[dict] = [{"role": "system", "content": self.pack.agent_system_prompt(self.scenario)}]
        self.payer_msgs: list[dict] = []
        self.transcript_text = ""
        self.last_prediction: PredictionSnapshot | None = None
        self.outcome = "completed"

        self.noted_keys: set[str] = set()
        self.had_payer_exchange = False
        self.guard_nudges = 0

    # --- timing ------------------------------------------------------------
    def now(self) -> int:
        return round(now_ms() - self.t0)

    @property
    def abort(self) -> asyncio.Event:
        return self.run.abort

    # --- audit -------------------------------------------------------------
    def push_audit(
        self,
        *,
        type: str,
        actor: str,
        summary: str,
        phi: bool,
        redaction: str,
        tool: str | None = None,
        tool_status: str | None = None,
        phi_scope: str | None = None,
        model: str | None = None,
    ) -> None:
        at_ms = self.now()
        canonical_base = {
            "seq": self.audit_seq,
            "type": type,
            "atMs": at_ms,
            "actor": actor,
            "summary": summary,
            "tool": tool,
            "phi": phi,
            "phiScope": phi_scope,
            "redaction": redaction,
            "model": model,
            "promptVersion": PROMPT_VERSION if model else None,
        }
        h = chain_hash(self.prev_hash, audit_canonical(canonical_base))
        event = AuditEvent(
            seq=self.audit_seq,
            id=f"evt-{self.audit_seq:03d}",
            type=type,
            at_ms=at_ms,
            clock=format_time_of_day(self.t0 + at_ms),
            actor=actor,
            summary=summary,
            tool=tool,
            tool_status=tool_status,
            phi=phi,
            phi_scope=phi_scope,
            redaction=redaction,
            model=model,
            prompt_version=PROMPT_VERSION if model else None,
            hash=h,
            prev_hash=self.prev_hash,
        )
        self.prev_hash = h
        self.audit_seq += 1
        wire = event.to_wire()
        self.audit_buffer.append(wire)
        emit(self.run, ev.audit_event(event))

    # --- turns / metrics ---------------------------------------------------
    def push_turn(
        self,
        speaker: str,
        text: str,
        latency_ms: int | None = None,
        *,
        grounded: int | None = None,
        anticipated: int | None = None,
    ) -> None:
        turn = LiveTurn(
            id=f"t-{self.seq}", seq=self.seq, speaker=speaker, text=text, at_ms=self.now(),
            latency_ms=latency_ms, grounded=grounded, anticipated=anticipated,
        )
        self.seq += 1
        emit(self.run, ev.turn_event(turn))

    def stream_agent_turn(self, text: str, ctx_str: str) -> None:
        grounded_n = sum(1 for ln in ctx_str.splitlines() if ln.strip()) if ctx_str else 0
        turn = LiveTurn(
            id=f"t-{self.seq}",
            seq=self.seq,
            speaker="agent",
            text=text,
            at_ms=self.now(),
            grounded=grounded_n or None,
            anticipated=len(self.warmed_intents_now()) or None,
            streaming=True,
        )
        emit(self.run, ev.turn_event(turn))

    def push_metrics(self) -> None:
        self.metrics.avg_latency_ms = round(sum(self.latencies) / len(self.latencies)) if self.latencies else 0
        emit(self.run, ev.metrics_event(self.metrics))

    def capture_notes(self, text: str, speaker: str) -> None:
        if self.run.graph is None:
            return
        for label, value in extract_notes(text, speaker, self.scenario):
            key = f"{label}={value}".lower()
            if key in self.noted_keys:
                continue
            self.noted_keys.add(key)
            try:
                nid = self.run.graph.note(label, value)
                if nid:
                    self.run.discovered.add(nid)
            except Exception:  # noqa: BLE001 - never block the call on a note
                pass

    def phase_from_prediction(self, p: PredictionSnapshot | None) -> int:
        if not p:
            return 1
        captured = len(self.scenario.required_fields) - len(p.missing_fields)
        if captured <= 0:
            return 1
        if captured < len(self.scenario.required_fields):
            return 2
        return 3

    async def wait_while_paused(self) -> None:
        while self.run.paused and not self.run.stopped:
            await asyncio.sleep(0.2)

    # --- context graph -----------------------------------------------------
    def retrieve_context(self):
        run = self.run
        if run.graph is None:
            return "", None
        missing = self.last_prediction.missing_fields if self.last_prediction else list(self.scenario.required_fields)
        subgraph, ctx_str = run.graph.retrieve(
            self.transcript_text[-3000:], missing_fields=missing, intent=self.scenario.category
        )
        member_node = f"member:{self.scenario.patient.member_id}"
        current_seeds = {n.id for n in subgraph.nodes if n.seed}
        run.discovered |= current_seeds
        run.discovered.add(member_node)
        disc_nodes = [n for n in subgraph.nodes if n.id in run.discovered]
        disc_ids = {n.id for n in disc_nodes}
        disc_edges = [e for e in subgraph.edges if e.source in disc_ids and e.target in disc_ids]
        grown = Subgraph(
            nodes=disc_nodes,
            edges=disc_edges,
            seeds=list(current_seeds & disc_ids),
            context=subgraph.context,
            hops=subgraph.hops,
        )
        sig = "g:" + ",".join(sorted(disc_ids)) + "|l:" + ",".join(sorted(n.id for n in disc_nodes if n.lit))
        if disc_nodes and sig != run.last_lit_sig:
            run.last_lit_sig = sig
            emit(run, ev.graph_event(grown))
            phi = any(n.type in ("member", "coverage", "claim", "auth") for n in disc_nodes if n.lit)
            self.push_audit(
                type="context.retrieve",
                actor="system",
                summary=f"Context graph now spans {len(disc_ids)} discovered record(s) as the call surfaces them.",
                phi=phi,
                phi_scope=self.pack.sensitive_scope(self.scenario) if phi else None,
                redaction="tokenized" if phi else "none",
            )
        return ctx_str, subgraph

    def warmed_intents_now(self) -> set[str]:
        warmed: set[str] = set()
        ps = self.run.last_pred_set
        if not ps:
            return warmed
        for p in ps.predictions:
            mapping = self.pack.predicted_tool_for(p.needs_tool or p.intent, self.scenario)
            if not mapping:
                continue
            cached = self.run.prefetch_cache.get(prefetch_key(*mapping))
            if cached and cached.get("status") in ("ready", "evicted"):
                warmed.add(p.intent)
        return warmed

    def emit_reasoning(self, subgraph, *, started_ms: int, think_text: str, streaming: bool, duration_ms: int | None = None) -> None:
        segments = []
        g = narrate_graph(subgraph)
        if g:
            segments.append(g)
        a = narrate_predictions(self.run.last_pred_set, self.warmed_intents_now())
        if a:
            segments.append(a)
        t = narrate_think(think_text)
        if t:
            segments.append(t)
        if not segments:
            return
        emit(self.run, ev.reasoning_event(LiveReasoning(
            id=f"r-{self.seq}", seq=self.seq, at_ms=started_ms, model=self.agent_model,
            segments=segments, streaming=streaming, duration_ms=duration_ms,
        )))

    # --- anticipatory prediction + prefetch --------------------------------
    async def _prefetch_predictions(self, ps, snapshot: str) -> None:
        run = self.run
        seen: set[str] = set()
        count = 0
        for p in ps.predictions:
            if count >= PREFETCH_TOP:
                break
            if p.confidence < CONFIDENCE_PREFETCH:
                continue
            mapping = self.pack.predicted_tool_for(p.needs_tool or p.intent, self.scenario)
            if not mapping:
                continue
            tool_name, tool_args = mapping
            key = prefetch_key(tool_name, tool_args)
            cached = run.prefetch_cache.get(key)
            if key in seen or (cached and cached.get("status") == "ready"):
                continue
            seen.add(key)
            count += 1
            emit(run, ev.prefetch_event(PrefetchRecord(key=key, kind="tool", status="prefetching", intent=p.intent, label=tool_name)))
            try:
                started = self.now()
                res = await self.pack.prefetch(
                    tool_name, tool_args,
                    self.pack.tool_context(run_id=run.id, scenario=self.scenario, transcript=snapshot, model=self.agent_model),
                )
                lat = self.now() - started
                run.prefetch_cache[key] = {
                    "status": "ready", "result": res.result, "status_tool": res.status,
                    "phi": res.phi, "data": res.data, "latency_ms": lat, "intent": p.intent,
                }
                emit(run, ev.prefetch_event(PrefetchRecord(key=key, kind="tool", status="ready", intent=p.intent, label=tool_name, saved_ms=lat)))
            except (LLMAborted, asyncio.CancelledError):
                raise
            except Exception:  # noqa: BLE001 - a failed speculation is just wasted work
                run.pred_stats["wasted"] += 1

    async def anticipate(self, snapshot: str) -> None:
        run = self.run
        try:
            pr = await chat_json(
                [
                    {"role": "system", "content": self.pack.predictor_system_prompt(self.scenario)},
                    {"role": "user", "content": f"Transcript so far:\n{snapshot[-3000:]}"},
                ],
                temperature=0.2,
                max_tokens=512,
                model=self.fast_model,
                abort=self.abort,
                name="llm.predictor",
            )
            self.metrics.inferences += 1
            self.latencies.append(pr.latency_ms)
            if not isinstance(pr.value, dict):
                return
            self.last_prediction = _normalize_prediction(pr.value, self.scenario)
            emit(run, ev.prediction_event(self.last_prediction))
            ps = normalize_prediction_set(pr.value, self.scenario)
            ps.generated_at_ms = self.now()
            ps.model_ms = pr.latency_ms
            ps.hit_rate, ps.avg_saved_ms, ps.wasted = stats_summary(run.pred_stats)
            run.last_pred_set = ps
            emit(run, ev.prediction_set_event(ps))
            self.push_audit(
                type="prediction.update",
                actor="system",
                summary=(
                    f"Prediction — completion {self.last_prediction.completion_probability * 100:.0f}%, "
                    f"escalation {self.last_prediction.escalation_risk * 100:.0f}%; {len(ps.predictions)} anticipated next turns."
                ),
                phi=False,
                redaction="none",
            )
            self.push_metrics()
            await self._prefetch_predictions(ps, snapshot)
        except (LLMAborted, asyncio.CancelledError):
            return
        except Exception:  # noqa: BLE001 - predictor is best-effort, never crash the call
            return

    def fire_anticipation(self) -> None:
        run = self.run
        if run.pred_task and not run.pred_task.done():
            run.pred_task.cancel()
        run.pred_task = asyncio.create_task(self.anticipate(self.transcript_text))

    # --- lifecycle ---------------------------------------------------------
    async def build_graph(self) -> None:
        try:
            self.run.graph = await self.pack.build_graph(self.scenario)
        except Exception:  # noqa: BLE001 - never block the call on graph build
            self.run.graph = None

    async def setup(self) -> None:
        run = self.run
        emit(run, ev.status_event("dialing", 0, self.now()))
        self.push_audit(
            type="call.session.open",
            actor="operator",
            summary="Operator opened a secure VoiceOps session (real local-model runtime).",
            phi=False,
            redaction="none",
        )
        gt_text = await self.pack.load_ground_truth(self.scenario)
        self.payer_msgs.append({"role": "system", "content": self.pack.counterparty_system_prompt(self.scenario, gt_text)})
        self.push_audit(
            type="call.start",
            actor="operator",
            summary=f"Outbound call initiated to {self.scenario.payer} ({self.scenario.payer_id}) — {self.scenario.category}.",
            phi=False,
            redaction="none",
            model=local_model_id(),
        )
        emit(run, ev.status_event("active", 1, self.now()))

    async def decide(self, step: int):
        """Stream the agent's next action. Returns (decision|None, ctx_str)."""
        ctx_str, subgraph = self.retrieve_context()
        grounding: list[dict] = (
            [{
                "role": "user",
                "content": (
                    "CONTEXT (verified records from the payer's system of record — read-only "
                    "grounding; you must still call tools to act and to write results back):\n" + ctx_str
                ),
            }]
            if ctx_str
            else []
        )
        prompt_msgs = [
            *self.agent_msgs,
            *grounding,
            {
                "role": "user",
                "content": "Begin the call. Output your first JSON action."
                if step == 0
                else "Continue. Output your next JSON action.",
            },
        ]
        started_ms = self.now()
        self.emit_reasoning(subgraph, started_ms=started_ms, think_text="", streaming=True)
        emit_state = {"reasoning_len": 0, "speech_len": 0}

        async def on_delta(
            reasoning_text: str,
            content: str,
            *,
            state: dict[str, int] = emit_state,
            active_subgraph: Subgraph | None = subgraph,
            active_started_ms: int = started_ms,
            active_ctx_str: str = ctx_str,
        ) -> None:
            if len(reasoning_text) - state["reasoning_len"] >= 64:
                state["reasoning_len"] = len(reasoning_text)
                self.emit_reasoning(active_subgraph, started_ms=active_started_ms, think_text=reasoning_text, streaming=True)
            speech = extract_speak_text_fragment(content)
            if speech is None:
                return
            text, complete = speech
            if text and (complete or len(text) - state["speech_len"] >= 8):
                state["speech_len"] = len(text)
                self.stream_agent_turn(text, active_ctx_str)

        dec = await chat_stream(
            prompt_msgs,
            temperature=0.3,
            max_tokens=1024,
            model=self.agent_model,
            abort=self.abort,
            on_delta=on_delta,
            name="llm.agent",
        )
        self.metrics.inferences += 1
        self.metrics.completion_tokens += dec.completion_tokens
        self.latencies.append(dec.latency_ms)
        self.emit_reasoning(subgraph, started_ms=started_ms, think_text=dec.reasoning, streaming=False, duration_ms=self.now() - started_ms)
        decision = dec.value if isinstance(dec.value, dict) else None
        self._last_dec_latency = dec.latency_ms
        return decision, ctx_str

    def apply_guard(self, decision: dict) -> bool:
        """Returns True if a guard nudge was applied (the agent must re-decide
        before recording/ending). Mirrors the conversation guard in the loop."""
        action = decision.get("action")
        premature = action == "end" or (action == "tool" and decision.get("tool") in ("record_status", "summarize"))
        if premature and not self.had_payer_exchange and self.guard_nudges < 3:
            self.guard_nudges += 1
            self.agent_msgs.append({
                "role": "user",
                "content": (
                    "You have not spoken with the representative yet. This is a phone call — "
                    "greet the rep, authenticate with your tax ID/NPI, and ask them to confirm the "
                    "required fields out loud BEFORE recording, summarizing, or ending. Use "
                    '{"action":"speak","text":"..."} now.'
                ),
            })
            return True
        return False

    async def execute_tool(self, decision: dict) -> None:
        run = self.run
        started = self.now()
        tool_name = decision["tool"]
        tool_args = decision.get("args") or {}

        key = prefetch_key(tool_name, tool_args)
        cached = run.prefetch_cache.get(key)
        prefetch_hit = False
        saved_ms: int | None = None
        if cached and cached.get("status") == "ready":
            res = ToolResult(
                result=cached["result"],
                status=cached["status_tool"],
                phi=cached["phi"],
                data=cached.get("data"),
            )
            prefetch_hit = True
            saved_ms = int(cached.get("latency_ms") or 0)
            cached["status"] = "evicted"
            run.pred_stats["hits"] += 1
            run.pred_stats["savedMs"] += saved_ms
            emit(run, ev.prefetch_event(PrefetchRecord(
                key=key, kind="tool", status="hit", intent=cached.get("intent"), label=tool_name, saved_ms=saved_ms,
            )))
        else:
            res = await self.pack.execute_tool(
                tool_name,
                tool_args,
                self.pack.tool_context(run_id=run.id, scenario=self.scenario, transcript=self.transcript_text, model=self.agent_model),
            )
            if run.pred_stats.get("misses") is not None:
                run.pred_stats["misses"] += 1

        self.metrics.tool_calls += 1
        if res.status == "error":
            self.metrics.tool_errors += 1
        if res.phi:
            self.metrics.phi_accesses += 1

        if run.graph is not None and res.data:
            try:
                if tool_name == "note_fact":
                    nid = run.graph.note(
                        str(res.data.get("label") or ""),
                        str(res.data.get("value") or ""),
                        kind=str(res.data.get("kind") or "note"),
                    )
                    if nid:
                        run.discovered.add(nid)
                else:
                    run.graph.widen(tool_name.replace("verify_", "").replace("lookup_", "member"), [res.data])
            except Exception:  # noqa: BLE001
                pass

        tool = LiveTool(
            id=f"tool-{self.seq}",
            seq=self.seq,
            tool=tool_name,
            args=tool_args,
            result=res.result,
            status=res.status,
            latency_ms=self.now() - started,
            phi=res.phi,
            at_ms=self.now(),
            prefetch_hit=prefetch_hit,
            saved_ms=saved_ms,
        )
        self.seq += 1
        emit(run, ev.tool_event(tool))

        phi_scope = self.pack.sensitive_scope(self.scenario) if res.phi else None
        self.push_audit(
            type="tool.call",
            actor="agent",
            summary=f"{tool_name}({', '.join(tool_args.keys())}) → {res.result}",
            tool=tool_name,
            tool_status=res.status,
            phi=res.phi,
            phi_scope=phi_scope,
            redaction="tokenized" if res.phi else "none",
            model=local_model_id(),
        )
        if res.phi:
            self.push_audit(
                type="phi.access",
                actor="agent",
                summary=f"PHI accessed via {tool_name} (minimum-necessary scope).",
                phi=True,
                phi_scope=phi_scope,
                redaction="tokenized",
            )
        self.agent_msgs.append({"role": "user", "content": f"TOOL_RESULT {tool_name}: {res.result}"})
        self.push_metrics()

    def speak(self, decision: dict, ctx_str: str) -> None:
        text = (decision.get("text") or "").strip() or "Thank you, one moment."
        grounded_n = sum(1 for ln in ctx_str.splitlines() if ln.strip()) if ctx_str else 0
        self.push_turn(
            "agent", text, getattr(self, "_last_dec_latency", None),
            grounded=grounded_n or None,
            anticipated=len(self.warmed_intents_now()) or None,
        )
        self.transcript_text += f"\nAGENT: {text}"
        self.capture_notes(text, "agent")
        snippet = text[:72] + ("…" if len(text) > 72 else "")
        self.push_audit(
            type="model.invoke",
            actor="agent",
            summary=f'Agent turn generated: "{snippet}"',
            phi=False,
            redaction="none",
            model=local_model_id(),
        )
        return text

    async def run_payer_model(self, agent_text: str):
        """Autonomous payer: a second model plays the rep. Returns (payer dict, latency)."""
        self.payer_msgs.append({"role": "user", "content": agent_text})
        pr = await chat_json(self.payer_msgs, temperature=0.45, max_tokens=512, model=self.fast_model, abort=self.abort, name="llm.payer")
        self.metrics.inferences += 1
        self.metrics.completion_tokens += pr.completion_tokens
        self.latencies.append(pr.latency_ms)
        payer = pr.value if isinstance(pr.value, dict) else None
        if payer is None:
            payer = {"text": "I'm sorry, could you repeat that?", "ends": False, "escalate": False}
        self.payer_msgs.append({"role": "assistant", "content": json.dumps(payer)})
        return payer, pr.latency_ms

    def record_payer(self, payer_text: str, latency: int | None) -> None:
        self.push_turn("payer", payer_text, latency)
        self.had_payer_exchange = True
        self.transcript_text += f"\nPAYER: {payer_text}"
        self.capture_notes(payer_text, "payer")
        self.agent_msgs.append({"role": "user", "content": f"PAYER said: {payer_text}"})

    async def drain_prediction(self) -> None:
        run = self.run
        if run.pred_task and not run.pred_task.done():
            if self.outcome == "stopped":
                run.pred_task.cancel()
            else:
                try:
                    await run.pred_task
                except BaseException:  # noqa: BLE001 - predictor is best-effort
                    pass

    async def finalize(self) -> None:
        await self.drain_prediction()
        if self.outcome != "stopped":
            if self.outcome == "escalated":
                self.push_audit(
                    type="call.escalate",
                    actor="system",
                    summary="Call escalated to a human specialist — hand-off packet queued.",
                    phi=True,
                    phi_scope="handoff:packet",
                    redaction="tokenized",
                    model=local_model_id(),
                )
            else:
                self.push_audit(
                    type="call.complete",
                    actor="system",
                    summary="Call objective met — record finalized and written back.",
                    phi=False,
                    redaction="none",
                    model=local_model_id(),
                )
        final_status = "escalated" if self.outcome == "escalated" else "idle" if self.outcome == "stopped" else "completed"
        emit(self.run, ev.status_event(final_status, 3, self.now()))
        self.push_metrics()
        # Score the run trace (no-op when tracing is disabled).
        if self.last_prediction:
            tracing.score_current_trace(name="completion_probability", value=self.last_prediction.completion_probability)
            tracing.score_current_trace(name="escalation_risk", value=self.last_prediction.escalation_risk)
        await self.persist()
        emit(self.run, ev.done_event(self.outcome))
        self.run.done = True

    async def persist(self) -> None:
        await _persist_run(self.run, self.scenario.payer, self.outcome, self.last_prediction, self.audit_buffer)


def _normalize_prediction(raw: dict[str, Any], scenario: Scenario) -> PredictionSnapshot:
    missing_raw = raw.get("missingFields")
    if isinstance(missing_raw, list):
        missing = [f for f in missing_raw if isinstance(f, str)][: len(scenario.required_fields)]
    else:
        missing = list(scenario.required_fields)
    return PredictionSnapshot(
        completion_probability=clamp(float(raw.get("completionProbability", 0.5) or 0.5), 0, 1),
        escalation_risk=clamp(float(raw.get("escalationRisk", 0.2) or 0.2), 0, 1),
        next_payer_response=str(raw.get("nextPayerResponse") or "Payer responds to the agent's request.")[:240],
        next_response_confidence=clamp(float(raw.get("nextResponseConfidence", 0.6) or 0.6), 0, 1),
        missing_fields=missing,
        est_remaining_ms=max(0, round(float(raw.get("estRemainingSec", 60) or 60) * 1000)),
        rationale=str(raw.get("rationale") or "Estimating from the live transcript.")[:280],
    )


async def _persist_run(
    run: RunState,
    payer: str,
    outcome: str,
    prediction: PredictionSnapshot | None,
    events: list[dict[str, Any]],
) -> None:
    """Best-effort persistence; never crash the call on a DB hiccup."""
    try:
        await query(
            """INSERT INTO call_runs(id,user_id,scenario_id,payer,model,status,outcome,completion_prob,escalation_risk,started_at,ended_at,event_stream)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10/1000.0), now(), $11::jsonb)
               ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, outcome=EXCLUDED.outcome,
                 completion_prob=EXCLUDED.completion_prob, escalation_risk=EXCLUDED.escalation_risk,
                 ended_at=now(), event_stream=EXCLUDED.event_stream""",
            [
                run.id,
                run.user_id,
                run.scenario_id,
                payer,
                run.model,
                "stopped" if outcome == "stopped" else outcome,
                outcome,
                prediction.completion_probability if prediction else None,
                prediction.escalation_risk if prediction else None,
                run.started_at,
                json.dumps(run.events),
            ],
        )
        for e in events:
            await query(
                """INSERT INTO call_events(run_id,seq,type,at_ms,actor,summary,model,tool,phi,phi_scope,redaction,hash,prev_hash)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                [
                    run.id, e["seq"], e["type"], e["atMs"], e["actor"], e["summary"], e.get("model"),
                    e.get("tool"), e["phi"], e.get("phiScope"), e["redaction"], e["hash"], e["prevHash"],
                ],
            )
    except Exception as err:  # noqa: BLE001
        emit(run, ev.error_event(f"persist warning: {err}"))
