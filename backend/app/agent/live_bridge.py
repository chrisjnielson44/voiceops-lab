"""
Live voice → SSE bridge.

The in-app *simulate* loop (`orchestrator.py`) runs both models in-process and
emits a rich event stream (turns, tool calls, streamed reasoning, the context
graph, anticipatory predictions, audit). The *live* voice agent, by contrast,
runs out-of-process in the LiveKit worker (`agent/agent.py`) — STT → LLM → TTS —
and historically only persisted an audit chain, so the cockpit's graph /
prediction / reasoning panels stayed dark during a real call.

This module closes that gap. The worker forwards each conversation turn, tool
call, and lifecycle event to `POST /api/agent/ingest`; a `LiveBridge` per run
then runs the SAME enrichment the orchestrator does — building the per-run
context graph, retrieving a grounding subgraph each turn, running the predictor,
and narrating a reasoning trace — and `emit()`s it into the run store so the
browser's existing `GET /api/agent/stream?runId=` SSE lights every panel up,
exactly like simulate.

Design notes:
- The worker remains the durable audit-chain authority (it writes `call_events`
  directly via `CallRecorder`). The bridge owns the live experience: it emits the
  SSE event stream and persists the full `event_stream` JSONB on completion so a
  voice call replays in Studio like any simulated run.
- The agent's own chain-of-thought is produced inside the LiveKit LLM pipeline
  and isn't surfaced here, so the reasoning trace narrates the graph walk and the
  weighed predictions (no streamed `think` segment) — every segment is still
  derived from real per-turn signals, nothing is invented.
- Prefetch is a simulate-only optimization (the live tools execute in the worker,
  not here), so the bridge anticipates + ranks predictions but does not warm a
  cache it could not serve.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from app.agent import run_store
from app.agent.notes import extract_notes
from app.agent.prediction import normalize_prediction_set, stats_summary
from app.agent.reasoning import narrate_graph, narrate_predictions
from app.agent.run_store import RunState, create_run, emit, get_run
from app.audit.ledger import audit_canonical
from app.config import settings
from app.core.format import clamp, format_time_of_day, now_ms
from app.core.hash import GENESIS_HASH, chain_hash
from app.db import query
from app.llm.local_llm import LLMAborted, chat_json, local_model_id
from app.packs.registry import get_scenario, pack_for_scenario
from app.schemas import agent as ev
from app.schemas.agent import LiveReasoning, LiveTool, LiveTurn, PrefetchRecord, RunMetrics, Subgraph
from app.schemas.audit import AuditEvent
from app.schemas.simulation import PredictionSnapshot, Scenario

PROMPT_VERSION = settings.voiceops_prompt_version

# Active bridges keyed by runId. Bounded implicitly by the run store's eviction;
# entries are dropped on `done`.
_bridges: dict[str, LiveBridge] = {}


class LiveBridge:
    """Per-run enrichment for a live voice call. Stateful (seq counters + audit
    hash chain), so all event handling is serialized under a lock — ingest POSTs
    from the worker can otherwise overlap."""

    def __init__(self, run: RunState, scenario: Scenario, pack: Any) -> None:
        self.run = run
        self.scenario = scenario
        self.pack = pack
        self.t0 = run.started_at
        self.seq = 0
        self.audit_seq = 0
        self.prev_hash = GENESIS_HASH
        self.metrics = RunMetrics()
        self.latencies: list[int] = []
        self.transcript_text = ""
        self.last_prediction: PredictionSnapshot | None = None
        self.graph_ready = False
        self.started = False
        self.finalized = False
        # Anticipation that serves the answer: records folded into the agent's
        # grounding so it already holds what the rep is most likely to ask next.
        self.preloaded_keys: set[str] = set()   # dedupe the prefetch `ready` signal
        self.preloaded_intents: set[str] = set()  # narrate which candidates were pre-loaded
        self.last_grounded: int | None = None     # records fed into the next agent turn
        self.last_anticipated: int | None = None   # of those, pre-loaded by anticipation
        self.noted_keys: set[str] = set()          # dedupe auto-captured conversational notes
        self.fast_model = (settings.local_llm_fast_model or "").strip() or run.model or local_model_id()
        self._lock = asyncio.Lock()

    # -- low-level emit helpers (mirror the orchestrator's closures) ----------

    def _now(self) -> int:
        return round(now_ms() - self.t0)

    def _push_audit(
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
        at_ms = self._now()
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
        emit(self.run, ev.audit_event(event))

    def _push_turn(
        self,
        speaker: str,
        text: str,
        latency_ms: int | None = None,
        *,
        grounded: int | None = None,
        anticipated: int | None = None,
    ) -> None:
        turn = LiveTurn(
            id=f"t-{self.seq}", seq=self.seq, speaker=speaker, text=text, at_ms=self._now(),
            latency_ms=latency_ms, grounded=grounded, anticipated=anticipated,
        )
        self.seq += 1
        emit(self.run, ev.turn_event(turn))

    def _push_metrics(self) -> None:
        self.metrics.avg_latency_ms = round(sum(self.latencies) / len(self.latencies)) if self.latencies else 0
        emit(self.run, ev.metrics_event(self.metrics))

    def _phase(self) -> int:
        p = self.last_prediction
        if not p:
            return 1
        captured = len(self.scenario.required_fields) - len(p.missing_fields)
        if captured <= 0:
            return 1
        return 2 if captured < len(self.scenario.required_fields) else 3

    async def _ensure_graph(self) -> None:
        if self.graph_ready:
            return
        self.graph_ready = True  # set first: never retry-build on every turn
        try:
            self.run.graph = await self.pack.build_graph(self.scenario)
        except Exception:  # noqa: BLE001 - never block the call on graph build
            self.run.graph = None

    def _retrieve_context(self) -> Subgraph | None:
        """Per-turn graph retrieval. Grows the displayed graph from entities the
        conversation has surfaced and emits a `graph` event only when the lit
        subgraph changes — identical to the orchestrator's path."""
        if self.run.graph is None:
            return None
        missing = self.last_prediction.missing_fields if self.last_prediction else list(self.scenario.required_fields)
        subgraph, _ctx = self.run.graph.retrieve(
            self.transcript_text[-3000:], missing_fields=missing, intent=self.scenario.category
        )

        member_node = f"member:{self.scenario.patient.member_id}"
        current_seeds = {n.id for n in subgraph.nodes if n.seed}
        self.run.discovered |= current_seeds
        self.run.discovered.add(member_node)
        disc_nodes = [n for n in subgraph.nodes if n.id in self.run.discovered]
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
        if disc_nodes and sig != self.run.last_lit_sig:
            self.run.last_lit_sig = sig
            emit(self.run, ev.graph_event(grown))
            phi = any(n.type in ("member", "coverage", "claim", "auth") for n in disc_nodes if n.lit)
            self._push_audit(
                type="context.retrieve",
                actor="system",
                summary=f"Context graph now spans {len(disc_ids)} discovered record(s) as the call surfaces them.",
                phi=phi,
                phi_scope=self.pack.sensitive_scope(self.scenario) if phi else None,
                redaction="tokenized" if phi else "none",
            )
        # Narration uses the FULL BFS slice so the reasoning shows the whole walk.
        return subgraph

    def _emit_reasoning(self, subgraph: Subgraph | None) -> None:
        """Inline reasoning trace for a live agent turn: the graph walk + the
        predictions weighed last exchange. (The agent's own chain-of-thought is
        produced in the LiveKit pipeline and not available here.)"""
        segments = []
        g = narrate_graph(subgraph)
        if g:
            segments.append(g)
        # `preloaded_intents` marks the candidates whose records were actually
        # folded into the agent's grounding this call (not a decorative claim).
        a = narrate_predictions(self.run.last_pred_set, self.preloaded_intents)
        if a:
            segments.append(a)
        if not segments:
            return
        emit(self.run, ev.reasoning_event(LiveReasoning(
            id=f"r-{self.seq}", seq=self.seq, at_ms=self._now(), model=self.run.model,
            segments=segments, streaming=False, duration_ms=None,
        )))

    async def _anticipate(self) -> None:
        """Forecast the call + rank the likely next exchanges from the live
        transcript. Best-effort; never crashes the call."""
        try:
            pr = await chat_json(
                [
                    {"role": "system", "content": self.pack.predictor_system_prompt(self.scenario)},
                    {"role": "user", "content": f"Transcript so far:\n{self.transcript_text[-3000:]}"},
                ],
                temperature=0.2,
                max_tokens=512,
                model=self.fast_model,
                abort=self.run.abort,
            )
            self.metrics.inferences += 1
            self.latencies.append(pr.latency_ms)
            if not isinstance(pr.value, dict):
                return
            self.last_prediction = _normalize_prediction(pr.value, self.scenario)
            emit(self.run, ev.prediction_event(self.last_prediction))
            ps = normalize_prediction_set(pr.value, self.scenario)
            ps.generated_at_ms = self._now()
            ps.model_ms = pr.latency_ms
            ps.hit_rate, ps.avg_saved_ms, ps.wasted = stats_summary(self.run.pred_stats)
            self.run.last_pred_set = ps
            emit(self.run, ev.prediction_set_event(ps))
            self._push_audit(
                type="prediction.update",
                actor="system",
                summary=(
                    f"Prediction — completion {self.last_prediction.completion_probability * 100:.0f}%, "
                    f"escalation {self.last_prediction.escalation_risk * 100:.0f}%; "
                    f"{len(ps.predictions)} anticipated next turns."
                ),
                phi=False,
                redaction="none",
            )
            self._push_metrics()
        except (LLMAborted, asyncio.CancelledError):
            return
        except Exception:  # noqa: BLE001 - predictor is best-effort
            return

    # -- anticipatory grounding (pulled by the worker before each agent turn) --

    async def grounding(self, extra_user_text: str = "") -> dict[str, Any]:
        """Build the grounding the live agent should see for its UPCOMING reply:
        the records the conversation has surfaced (base graph retrieval) PLUS the
        records the *anticipated* next intents point at, folded in so the agent
        already holds the facts the rep is most likely to ask for next. This is
        anticipation that serves the answer — the live tools run out-of-process in
        the worker, so there is no speculative cache to serve; pre-loading the
        record into context is the equivalent latency win (the agent answers
        without a fresh lookup). Pure graph reads on this path (no LLM, no SQL);
        best-effort — any failure degrades to ungrounded, never raises."""
        await self._ensure_graph()
        if self.run.graph is None:
            return {"context": "", "anticipated": []}
        try:
            transcript = self.transcript_text
            extra = (extra_user_text or "").strip()
            if extra:
                transcript = f"{transcript}\nPAYER: {extra}"
            missing = (
                self.last_prediction.missing_fields
                if self.last_prediction
                else list(self.scenario.required_fields)
            )
            subgraph, ctx = self.run.graph.retrieve(
                transcript[-3000:], missing_fields=missing, intent=self.scenario.category
            )

            # Anticipation's real job: the base context is score-ordered and
            # char-budgeted (BUDGET_CHARS), so a relevant-but-lower-scored record
            # can fall below the cut. Fold in each anticipated record whose fact
            # line isn't already in the base context — guaranteeing the record the
            # rep is most likely to ask about next survives the budget and is in
            # front of the agent. (Cheap; on the small single-member graphs it's
            # usually already present, so this only bites when it matters.)
            anticipated: list[dict[str, str]] = []
            extra_lines: list[str] = []
            ps = self.run.last_pred_set
            records = self.pack.anticipated_records(ps.predictions, self.scenario) if (ps and ps.predictions) else []
            for intent, tool, nid in records:
                line = self.run.graph.fact_for(nid)
                if not line or line in ctx or line in extra_lines:
                    continue  # already grounded (in base context or already folded)
                extra_lines.append(line)
                anticipated.append({"intent": intent, "tool": tool, "node": nid})

            parts: list[str] = []
            if ctx:
                parts.append(ctx)
            if extra_lines:
                parts.append(
                    "LIKELY-NEXT — records the representative is most likely to ask "
                    "about next (verified, read-only; pre-loaded so you can answer "
                    "without another lookup):\n" + "\n".join(extra_lines)
                )
            base_n = sum(1 for ln in ctx.splitlines() if ln.strip()) if ctx else 0
            self.last_grounded = (base_n + len(extra_lines)) or None
            self.last_anticipated = len(anticipated) or None
            if anticipated:
                async with self._lock:
                    self._signal_preloaded(anticipated)
            return {"context": "\n".join(parts), "anticipated": [a["node"] for a in anticipated]}
        except Exception:  # noqa: BLE001 - grounding is best-effort; never block the call
            return {"context": "", "anticipated": []}

    def _signal_preloaded(self, anticipated: list[dict[str, str]]) -> None:
        """Surface a real prefetch signal for the records folded into grounding so
        the cockpit's prediction panel reflects live pre-loading (deduped per
        tool+record). No fabricated `savedMs`: the win is the avoided lookup, not a
        measured cache serve."""
        for rec in anticipated:
            self.preloaded_intents.add(rec["intent"])
            key = f"preload:{rec['tool']}|{rec['node']}"
            if key in self.preloaded_keys:
                continue
            self.preloaded_keys.add(key)
            emit(self.run, ev.prefetch_event(PrefetchRecord(
                key=key, kind="tool", status="ready", intent=rec["intent"], label=rec["tool"],
            )))

    # -- public lifecycle (called from the ingest endpoint) -------------------

    async def on_start(self) -> None:
        async with self._lock:
            if self.started:
                return
            self.started = True
            emit(self.run, ev.status_event("dialing", 0, self._now()))
            self._push_audit(
                type="call.session.open",
                actor="operator",
                summary="Operator opened a live voice session (LiveKit + ElevenLabs, on-device LLM).",
                phi=False,
                redaction="none",
            )
            self._push_audit(
                type="call.start",
                actor="operator",
                summary=f"Live voice call connected to {self.scenario.payer} ({self.scenario.payer_id}) — {self.scenario.category}.",
                phi=False,
                redaction="none",
                model=self.run.model,
            )
            emit(self.run, ev.status_event("active", 1, self._now()))
        await self._ensure_graph()

    def _capture_notes(self, text: str, speaker: str) -> None:
        """Auto-record conversational facts (rep name, reference numbers) into the
        live memory graph, deduped — parity with the simulate orchestrator."""
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
            except Exception:  # noqa: BLE001
                pass

    async def on_turn(self, speaker: str, text: str, latency_ms: int | None = None) -> None:
        text = (text or "").strip()
        if not text:
            return
        await self._ensure_graph()
        async with self._lock:
            speaker = "agent" if speaker == "agent" else "payer"
            if speaker == "agent":
                # Ground this turn, narrate the walk + last predictions, then the turn.
                subgraph = self._retrieve_context()
                self._emit_reasoning(subgraph)
                self._push_turn("agent", text, latency_ms, grounded=self.last_grounded, anticipated=self.last_anticipated)
                self.transcript_text += f"\nAGENT: {text}"
                self._capture_notes(text, "agent")
                snippet = text[:72] + ("…" if len(text) > 72 else "")
                self._push_audit(
                    type="model.invoke",
                    actor="agent",
                    summary=f'Agent turn generated: "{snippet}"',
                    phi=False,
                    redaction="none",
                    model=self.run.model,
                )
                self._push_metrics()
            else:
                self._push_turn("payer", text, latency_ms)
                self.transcript_text += f"\nPAYER: {text}"
                self._capture_notes(text, "payer")
                # Surface the payer's mention into the graph before forecasting.
                self._retrieve_context()
                emit(self.run, ev.status_event("active", self._phase(), self._now()))
        # Off the lock: the predictor inference can take a beat; it re-locks
        # internally only via emit (which is cheap and thread-safe enough here).
        if speaker == "payer":
            await self._anticipate()

    async def on_tool(
        self,
        *,
        tool: str,
        args: dict[str, Any] | None,
        result: str,
        status: str = "ok",
        latency_ms: int = 0,
        phi: bool = False,
        phi_scope: str | None = None,
    ) -> None:
        async with self._lock:
            args = args or {}
            live_tool = LiveTool(
                id=f"tool-{self.seq}",
                seq=self.seq,
                tool=tool,
                args=args,
                result=result,
                status=status if status in ("ok", "error") else "ok",
                latency_ms=max(0, int(latency_ms)),
                phi=bool(phi),
                at_ms=self._now(),
            )
            self.seq += 1
            emit(self.run, ev.tool_event(live_tool))
            self.metrics.tool_calls += 1
            if live_tool.status == "error":
                self.metrics.tool_errors += 1
            if phi:
                self.metrics.phi_accesses += 1
            scope = phi_scope or (self.pack.sensitive_scope(self.scenario) if phi else None)
            self._push_audit(
                type="tool.call",
                actor="agent",
                summary=f"{tool}({', '.join(args.keys())}) → {result}",
                tool=tool,
                tool_status=live_tool.status,
                phi=bool(phi),
                phi_scope=scope,
                redaction="tokenized" if phi else "none",
                model=self.run.model,
            )
            if phi:
                self._push_audit(
                    type="phi.access",
                    actor="agent",
                    summary=f"PHI accessed via {tool} (minimum-necessary scope).",
                    phi=True,
                    phi_scope=scope,
                    redaction="tokenized",
                )
            self._push_metrics()

    async def on_done(self, outcome: str) -> None:
        async with self._lock:
            if self.finalized:
                return
            self.finalized = True
            outcome = outcome if outcome in ("completed", "escalated", "stopped") else "completed"
            if outcome == "escalated":
                self._push_audit(
                    type="call.escalate",
                    actor="system",
                    summary="Live call escalated to a human specialist — hand-off packet queued.",
                    phi=True,
                    phi_scope="handoff:packet",
                    redaction="tokenized",
                    model=self.run.model,
                )
            elif outcome == "completed":
                self._push_audit(
                    type="call.complete",
                    actor="system",
                    summary="Live call objective met — record finalized and written back.",
                    phi=False,
                    redaction="none",
                    model=self.run.model,
                )
            final_status = "escalated" if outcome == "escalated" else "idle" if outcome == "stopped" else "completed"
            emit(self.run, ev.status_event(final_status, 3, self._now()))
            self._push_metrics()
        await self._persist()
        emit(self.run, ev.done_event(outcome))  # type: ignore[arg-type]
        self.run.done = True
        run_store.close_subscribers(self.run)
        _bridges.pop(self.run.id, None)

    async def _persist(self) -> None:
        """Persist the full SSE stream so the call replays in Studio. The worker's
        CallRecorder owns `call_events` + the run's status/outcome, so we touch
        only the replay stream + prediction summary columns to avoid racing it."""
        try:
            await query(
                """UPDATE call_runs
                   SET completion_prob=$2, escalation_risk=$3, event_stream=$4::jsonb
                   WHERE id=$1""",
                [
                    self.run.id,
                    self.last_prediction.completion_probability if self.last_prediction else None,
                    self.last_prediction.escalation_risk if self.last_prediction else None,
                    json.dumps(self.run.events),
                ],
            )
        except Exception as err:  # noqa: BLE001
            emit(self.run, ev.error_event(f"persist warning: {err}"))


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


async def get_or_create_bridge(
    *, run_id: str, scenario_id: str, model: str | None, user_id: str | None
) -> LiveBridge | None:
    """Resolve the bridge for a live run, creating its RunState + bridge on first
    contact. Returns None if the scenario can't be resolved (bad/garbage id)."""
    bridge = _bridges.get(run_id)
    if bridge:
        return bridge

    try:
        scenario = get_scenario(scenario_id)
    except Exception:  # noqa: BLE001 - unknown scenario id
        return None
    pack = pack_for_scenario(scenario.id)

    run = get_run(run_id)
    if run is None:
        run = create_run(id=run_id, scenario_id=scenario.id, model=model or local_model_id(), user_id=user_id)
    run.live = True
    if model and not run.model:
        run.model = model

    bridge = LiveBridge(run, scenario, pack)
    _bridges[run_id] = bridge
    await bridge.on_start()
    return bridge
