"""
The real call loop, ported from `src/lib/agent/orchestrator.ts`. Runs a
turn-by-turn conversation between two live local models — the VoiceOps agent and
a payer rep — with the agent calling real tools (SQL against Neon) and a third
predictor inference each exchange. Emits a typed event stream consumed over SSE
and persists the run to Postgres. Nothing here is scripted.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from app.agent import run_store
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
from app.llm.local_llm import LLMAborted, chat_json, chat_stream, local_model_id
from app.packs.registry import get_scenario, pack_for_scenario
from app.schemas import agent as ev
from app.schemas.agent import LiveReasoning, LiveTool, LiveTurn, PrefetchRecord, RunMetrics, Subgraph
from app.schemas.audit import AuditEvent
from app.schemas.simulation import PredictionSnapshot, Scenario

MAX_STEPS = 16
PROMPT_VERSION = settings.voiceops_prompt_version


async def run_orchestrator(run: RunState) -> None:
    scenario = get_scenario(run.scenario_id)
    pack = pack_for_scenario(scenario.id)
    t0 = run.started_at

    # Per-role models: the agent runs on the selected (reasoning) model so we can
    # surface its chain-of-thought; the payer + predictor run on a faster model
    # (when configured) so they don't add the reasoning model's latency twice per
    # turn. Both fall back to the agent model.
    agent_model = run.model or local_model_id()
    fast_model = (settings.local_llm_fast_model or "").strip() or agent_model

    # Build the per-run context graph once, off the turn critical path. Pure
    # SQL/Python — works even when the local models are offline.
    try:
        run.graph = await pack.build_graph(scenario)
    except Exception:  # noqa: BLE001 - never block the call on graph build
        run.graph = None

    def now() -> int:
        return round(now_ms() - t0)

    abort = run.abort

    seq = 0
    audit_seq = 0
    prev_hash = GENESIS_HASH
    metrics = RunMetrics()
    latencies: list[int] = []
    audit_buffer: list[dict[str, Any]] = []

    def push_audit(
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
        nonlocal prev_hash, audit_seq
        at_ms = now()
        canonical_base = {
            "seq": audit_seq,
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
        h = chain_hash(prev_hash, audit_canonical(canonical_base))
        event = AuditEvent(
            seq=audit_seq,
            id=f"evt-{audit_seq:03d}",
            type=type,
            at_ms=at_ms,
            clock=format_time_of_day(t0 + at_ms),
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
            prev_hash=prev_hash,
        )
        prev_hash = h
        audit_seq += 1
        wire = event.to_wire()
        audit_buffer.append(wire)
        emit(run, ev.audit_event(event))

    def push_turn(
        speaker: str,
        text: str,
        latency_ms: int | None = None,
        *,
        grounded: int | None = None,
        anticipated: int | None = None,
    ) -> None:
        nonlocal seq
        turn = LiveTurn(
            id=f"t-{seq}", seq=seq, speaker=speaker, text=text, at_ms=now(),
            latency_ms=latency_ms, grounded=grounded, anticipated=anticipated,
        )
        seq += 1
        emit(run, ev.turn_event(turn))

    def push_metrics() -> None:
        metrics.avg_latency_ms = round(sum(latencies) / len(latencies)) if latencies else 0
        emit(run, ev.metrics_event(metrics))

    def phase_from_prediction(p: PredictionSnapshot | None) -> int:
        if not p:
            return 1
        captured = len(scenario.required_fields) - len(p.missing_fields)
        if captured <= 0:
            return 1
        if captured < len(scenario.required_fields):
            return 2
        return 3

    async def wait_while_paused() -> None:
        while run.paused and not run.stopped:
            await asyncio.sleep(0.2)

    def retrieve_context():
        """Per-turn graph retrieval. Emits a graph event only when the lit
        subgraph changes; returns (serialized context, subgraph) — the subgraph
        is reused to narrate the traversal in the reasoning trace."""
        if run.graph is None:
            return "", None
        missing = last_prediction.missing_fields if last_prediction else list(scenario.required_fields)
        subgraph, ctx_str = run.graph.retrieve(transcript_text[-3000:], missing_fields=missing, intent=scenario.category)

        # GROW the displayed graph from what the CONVERSATION has actually
        # surfaced: focus entities + any node mentioned in the transcript (a
        # seed), accumulated across turns. The agent is still grounded on the
        # broader BFS slice (the reasoning narration shows that full walk), but
        # the graph viz starts small and expands as entities come up on the call.
        member_node = f"member:{scenario.patient.member_id}"
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
            push_audit(
                type="context.retrieve",
                actor="system",
                summary=f"Context graph now spans {len(disc_ids)} discovered record(s) as the call surfaces them.",
                phi=phi,
                phi_scope=pack.sensitive_scope(scenario) if phi else None,
                redaction="tokenized" if phi else "none",
            )
        # Narration uses the FULL BFS slice so the reasoning still shows the walk.
        return ctx_str, subgraph

    def warmed_intents_now() -> set[str]:
        """Which of the last round's predicted intents had their read tool warmed
        in the prefetch cache — used to narrate 'I prefetched this' in reasoning."""
        warmed: set[str] = set()
        ps = run.last_pred_set
        if not ps:
            return warmed
        for p in ps.predictions:
            mapping = pack.predicted_tool_for(p.needs_tool or p.intent, scenario)
            if not mapping:
                continue
            cached = run.prefetch_cache.get(prefetch_key(*mapping))
            if cached and cached.get("status") in ("ready", "evicted"):
                warmed.add(p.intent)
        return warmed

    def emit_reasoning(subgraph, *, started_ms: int, think_text: str, streaming: bool, duration_ms: int | None = None) -> None:
        """Assemble + emit the inline reasoning trace (graph walk + weighed
        predictions + streamed chain-of-thought) for the upcoming agent turn.
        Tagged with the seq the following turn/tool uses; the client upserts by id
        so the trace grows live as `think_text` streams in."""
        segments = []
        g = narrate_graph(subgraph)
        if g:
            segments.append(g)
        a = narrate_predictions(run.last_pred_set, warmed_intents_now())
        if a:
            segments.append(a)
        t = narrate_think(think_text)
        if t:
            segments.append(t)
        if not segments:
            return
        emit(run, ev.reasoning_event(LiveReasoning(
            id=f"r-{seq}", seq=seq, at_ms=started_ms, model=agent_model,
            segments=segments, streaming=streaming, duration_ms=duration_ms,
        )))

    async def _prefetch_predictions(ps, snapshot: str) -> None:
        """Speculatively warm the cache for the top predicted next tools. Only
        idempotent read tools are mapped (see Pack.predicted_tool_for)."""
        seen: set[str] = set()
        count = 0
        for p in ps.predictions:
            if count >= PREFETCH_TOP:
                break
            if p.confidence < CONFIDENCE_PREFETCH:
                continue
            mapping = pack.predicted_tool_for(p.needs_tool or p.intent, scenario)
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
                started = now()
                res = await pack.prefetch(
                    tool_name, tool_args,
                    pack.tool_context(run_id=run.id, scenario=scenario, transcript=snapshot, model=agent_model),
                )
                lat = now() - started
                run.prefetch_cache[key] = {
                    "status": "ready", "result": res.result, "status_tool": res.status,
                    "phi": res.phi, "data": res.data, "latency_ms": lat, "intent": p.intent,
                }
                emit(run, ev.prefetch_event(PrefetchRecord(key=key, kind="tool", status="ready", intent=p.intent, label=tool_name, saved_ms=lat)))
            except (LLMAborted, asyncio.CancelledError):
                raise
            except Exception:  # noqa: BLE001 - a failed speculation is just wasted work
                run.pred_stats["wasted"] += 1

    async def anticipate(snapshot: str) -> None:
        """Off-critical-path: forecast the call + anticipate the next exchange,
        then prefetch. Fire-and-forget; cancelled when superseded or stopped."""
        nonlocal last_prediction
        try:
            pr = await chat_json(
                [
                    {"role": "system", "content": pack.predictor_system_prompt(scenario)},
                    {"role": "user", "content": f"Transcript so far:\n{snapshot[-3000:]}"},
                ],
                temperature=0.2,
                max_tokens=512,
                model=fast_model,
                abort=abort,
            )
            metrics.inferences += 1
            latencies.append(pr.latency_ms)
            if not isinstance(pr.value, dict):
                return
            last_prediction = _normalize_prediction(pr.value, scenario)
            emit(run, ev.prediction_event(last_prediction))
            ps = normalize_prediction_set(pr.value, scenario)
            ps.generated_at_ms = now()
            ps.model_ms = pr.latency_ms
            ps.hit_rate, ps.avg_saved_ms, ps.wasted = stats_summary(run.pred_stats)
            run.last_pred_set = ps
            emit(run, ev.prediction_set_event(ps))
            push_audit(
                type="prediction.update",
                actor="system",
                summary=(
                    f"Prediction — completion {last_prediction.completion_probability * 100:.0f}%, "
                    f"escalation {last_prediction.escalation_risk * 100:.0f}%; {len(ps.predictions)} anticipated next turns."
                ),
                phi=False,
                redaction="none",
            )
            push_metrics()
            await _prefetch_predictions(ps, snapshot)
        except (LLMAborted, asyncio.CancelledError):
            return
        except Exception:  # noqa: BLE001 - predictor is best-effort, never crash the call
            return

    def fire_anticipation() -> None:
        if run.pred_task and not run.pred_task.done():
            run.pred_task.cancel()
        run.pred_task = asyncio.create_task(anticipate(transcript_text))

    agent_msgs: list[dict] = [{"role": "system", "content": pack.agent_system_prompt(scenario)}]
    payer_msgs: list[dict] = []
    transcript_text = ""
    last_prediction: PredictionSnapshot | None = None
    outcome = "completed"

    try:
        emit(run, ev.status_event("dialing", 0, now()))
        push_audit(
            type="call.session.open",
            actor="operator",
            summary="Operator opened a secure VoiceOps session (real local-model runtime).",
            phi=False,
            redaction="none",
        )

        gt_text = await pack.load_ground_truth(scenario)
        payer_msgs.append({"role": "system", "content": pack.counterparty_system_prompt(scenario, gt_text)})

        push_audit(
            type="call.start",
            actor="operator",
            summary=f"Outbound call initiated to {scenario.payer} ({scenario.payer_id}) — {scenario.category}.",
            phi=False,
            redaction="none",
            model=local_model_id(),
        )
        emit(run, ev.status_event("active", 1, now()))

        payer_ended = False
        # The call is a conversation: the agent must actually speak with the rep
        # before it may record/summarize/end. The context graph grounds the agent
        # so well it would otherwise run tools and hang up without a word.
        had_payer_exchange = False
        guard_nudges = 0

        for step in range(MAX_STEPS):
            if run.stopped:
                outcome = "stopped"
                break
            await wait_while_paused()

            # ---- CONTEXT GRAPH: retrieve grounding for this turn ----
            ctx_str, subgraph = retrieve_context()
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

            # ---- AGENT decides an action (STREAMED on the reasoning model) ----
            # The reasoning model streams its chain-of-thought token-by-token; we
            # emit it live (throttled) so the trace grows in real time above the
            # turn. Generous token budget — most of it is the thinking.
            prompt_msgs = [
                *agent_msgs,
                *grounding,
                {
                    "role": "user",
                    "content": "Begin the call. Output your first JSON action."
                    if step == 0
                    else "Continue. Output your next JSON action.",
                },
            ]
            started_ms = now()
            # Show the graph walk + weighed predictions immediately (before any token).
            emit_reasoning(subgraph, started_ms=started_ms, think_text="", streaming=True)
            emit_state = {"len": 0}

            async def on_delta(
                reasoning_text: str,
                _content: str,
                *,
                state: dict[str, int] = emit_state,
                active_subgraph: Subgraph | None = subgraph,
                active_started_ms: int = started_ms,
            ) -> None:
                if len(reasoning_text) - state["len"] >= 64:
                    state["len"] = len(reasoning_text)
                    emit_reasoning(active_subgraph, started_ms=active_started_ms, think_text=reasoning_text, streaming=True)

            dec = await chat_stream(
                prompt_msgs,
                temperature=0.3,
                max_tokens=1024,
                model=agent_model,
                abort=abort,
                on_delta=on_delta,
            )
            metrics.inferences += 1
            metrics.completion_tokens += dec.completion_tokens
            latencies.append(dec.latency_ms)
            # Final reasoning frame settles the shimmer and records think time.
            emit_reasoning(subgraph, started_ms=started_ms, think_text=dec.reasoning, streaming=False, duration_ms=now() - started_ms)
            decision = dec.value if isinstance(dec.value, dict) else None

            if not decision or not decision.get("action"):
                agent_msgs.append({"role": "user", "content": "Your last reply was not valid JSON. Output one JSON action only."})
                if step > 2:
                    outcome = "completed"
                    break
                continue

            agent_msgs.append({"role": "assistant", "content": json.dumps(decision)})
            action = decision.get("action")

            # ---- CONVERSATION GUARD ----
            # The agent may not record/summarize/end before it has actually spoken
            # with the rep and gotten a reply. Without this it reads the grounding
            # context and hangs up wordlessly. Bounded so it can never deadlock.
            premature = action == "end" or (action == "tool" and decision.get("tool") in ("record_status", "summarize"))
            if premature and not had_payer_exchange and guard_nudges < 3:
                guard_nudges += 1
                agent_msgs.append({
                    "role": "user",
                    "content": (
                        "You have not spoken with the representative yet. This is a phone call — "
                        "greet the rep, authenticate with your tax ID/NPI, and ask them to confirm the "
                        "required fields out loud BEFORE recording, summarizing, or ending. Use "
                        '{"action":"speak","text":"..."} now.'
                    ),
                })
                continue

            if action == "tool" and decision.get("tool"):
                started = now()
                tool_name = decision["tool"]
                tool_args = decision.get("args") or {}

                # ---- PREFETCH HIT: serve a speculatively-warmed read from cache ----
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
                    res = await pack.execute_tool(
                        tool_name,
                        tool_args,
                        pack.tool_context(run_id=run.id, scenario=scenario, transcript=transcript_text, model=agent_model),
                    )
                    if run.pred_stats.get("misses") is not None:
                        run.pred_stats["misses"] += 1

                metrics.tool_calls += 1
                if res.status == "error":
                    metrics.tool_errors += 1
                if res.phi:
                    metrics.phi_accesses += 1

                # Surface any tool-returned rows into the graph so later turns see them.
                if run.graph is not None and res.data:
                    try:
                        if tool_name == "note_fact":
                            # The agent recorded a fact ON the call — add it to the
                            # live memory graph and mark it discovered so it shows in
                            # the viz now and grounds later turns ("record + look back").
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
                    id=f"tool-{seq}",
                    seq=seq,
                    tool=tool_name,
                    args=tool_args,
                    result=res.result,
                    status=res.status,
                    latency_ms=now() - started,
                    phi=res.phi,
                    at_ms=now(),
                    prefetch_hit=prefetch_hit,
                    saved_ms=saved_ms,
                )
                seq += 1
                emit(run, ev.tool_event(tool))

                phi_scope = pack.sensitive_scope(scenario) if res.phi else None
                push_audit(
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
                    push_audit(
                        type="phi.access",
                        actor="agent",
                        summary=f"PHI accessed via {tool_name} (minimum-necessary scope).",
                        phi=True,
                        phi_scope=phi_scope,
                        redaction="tokenized",
                    )

                agent_msgs.append({"role": "user", "content": f"TOOL_RESULT {tool_name}: {res.result}"})
                push_metrics()
                continue

            if action == "end":
                outcome = "escalated" if decision.get("outcome") == "escalated" else "completed"
                if decision.get("summary"):
                    push_turn("agent", decision["summary"])
                    transcript_text += f"\nAGENT: {decision['summary']}"
                break

            # ---- AGENT speaks ----
            text = (decision.get("text") or "").strip() or "Thank you, one moment."
            grounded_n = sum(1 for ln in ctx_str.splitlines() if ln.strip()) if ctx_str else 0
            push_turn(
                "agent", text, dec.latency_ms,
                grounded=grounded_n or None,
                anticipated=len(warmed_intents_now()) or None,
            )
            transcript_text += f"\nAGENT: {text}"
            snippet = text[:72] + ("…" if len(text) > 72 else "")
            push_audit(
                type="model.invoke",
                actor="agent",
                summary=f'Agent turn generated: "{snippet}"',
                phi=False,
                redaction="none",
                model=local_model_id(),
            )

            # ---- PAYER replies ----
            # Autonomous: a second model plays the payer. Role-play (human_payer):
            # the agent leads and a human plays the rep — we await their typed reply
            # instead of running the model.
            if run.stopped:
                outcome = "stopped"
                break
            await wait_while_paused()
            if run.human_payer:
                # Forecast the rep's reply to the agent's turn BEFORE we wait — the
                # human plays the payer, so these predictions become the suggested
                # replies shown while they type (anticipation lands during the wait).
                fire_anticipation()
                payer_text = await _await_human_payer(run)
                if payer_text is None:  # stopped while waiting
                    outcome = "stopped"
                    break
                payer = {"text": payer_text, "ends": False, "escalate": False}
                payer_latency = None
            else:
                payer_msgs.append({"role": "user", "content": text})
                pr = await chat_json(payer_msgs, temperature=0.45, max_tokens=512, model=fast_model, abort=abort)
                metrics.inferences += 1
                metrics.completion_tokens += pr.completion_tokens
                latencies.append(pr.latency_ms)
                payer = pr.value if isinstance(pr.value, dict) else None
                if payer is None:
                    payer = {"text": "I'm sorry, could you repeat that?", "ends": False, "escalate": False}
                payer_msgs.append({"role": "assistant", "content": json.dumps(payer)})
                payer_text = (payer.get("text") or "").strip() or "Let me check on that."
                payer_latency = pr.latency_ms
            push_turn("payer", payer_text, payer_latency)
            had_payer_exchange = True
            transcript_text += f"\nPAYER: {payer_text}"
            agent_msgs.append({"role": "user", "content": f"PAYER said: {payer_text}"})

            # ---- ANTICIPATORY PREDICTION + PREFETCH (off the critical path) ----
            # Fire-and-forget: forecast + warm the cache for likely next tools
            # while the loop moves on. Cancelled if superseded or the run stops.
            # In role-play we already fired before the human's turn (above), so we
            # don't double-fire here.
            if not run.human_payer:
                fire_anticipation()

            emit(run, ev.status_event("active", phase_from_prediction(last_prediction), now()))
            push_metrics()

            if payer.get("escalate"):
                payer_ended = True
            if payer.get("ends") and step > 1:
                agent_msgs.append({"role": "user", "content": "The payer indicated the call is concluding. Record, summarize, and end."})
            # (payer_ended + high escalation risk simply lets the agent escalate next turn)
            _ = payer_ended

        # Let the final anticipation finish so the last prediction/prefetch lands
        # and is persisted — but never wait on a stopped run. anticipate() swallows
        # its own errors, so this await returns cleanly.
        if run.pred_task and not run.pred_task.done():
            if outcome == "stopped":
                run.pred_task.cancel()
            else:
                try:
                    await run.pred_task
                except BaseException:  # noqa: BLE001 - predictor is best-effort, never block finalize
                    pass

        if outcome != "stopped":
            if outcome == "escalated":
                push_audit(
                    type="call.escalate",
                    actor="system",
                    summary="Call escalated to a human specialist — hand-off packet queued.",
                    phi=True,
                    phi_scope="handoff:packet",
                    redaction="tokenized",
                    model=local_model_id(),
                )
            else:
                push_audit(
                    type="call.complete",
                    actor="system",
                    summary="Call objective met — record finalized and written back.",
                    phi=False,
                    redaction="none",
                    model=local_model_id(),
                )

        final_status = "escalated" if outcome == "escalated" else "idle" if outcome == "stopped" else "completed"
        emit(run, ev.status_event(final_status, 3, now()))
        push_metrics()

        await _persist_run(run, scenario.payer, outcome, last_prediction, audit_buffer)
        emit(run, ev.done_event(outcome))
        run.done = True
    except (LLMAborted, asyncio.CancelledError):
        emit(run, ev.status_event("idle", 0, now()))
        emit(run, ev.done_event("stopped"))
        run.done = True
    except Exception as err:  # noqa: BLE001 - surface any orchestrator failure to the stream
        if abort.is_set() or run.stopped:
            emit(run, ev.status_event("idle", 0, now()))
            emit(run, ev.done_event("stopped"))
        else:
            emit(run, ev.error_event(str(err) or "Orchestrator error"))
            emit(run, ev.done_event("stopped"))
        run.done = True
    finally:
        if run.pred_task and not run.pred_task.done():
            run.pred_task.cancel()
        run_store.close_subscribers(run)


async def _await_human_payer(run: RunState) -> str | None:
    """Block the loop until the human (playing the payer rep) submits a reply via
    POST /api/agent/say, or the run is stopped. Emits `await` events so the UI can
    show/hide the reply box. Returns the text, or None if the call was stopped."""
    emit(run, ev.await_event(True, "payer"))
    get_task = asyncio.create_task(run.payer_inbox.get())
    abort_task = asyncio.create_task(run.abort.wait())
    try:
        done, pending = await asyncio.wait({get_task, abort_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        emit(run, ev.await_event(False, "payer"))
    for t in (get_task, abort_task):
        if t not in done:
            t.cancel()
    if get_task in done and not run.stopped:
        try:
            text = get_task.result()
        except Exception:  # noqa: BLE001
            return None
        return (text or "").strip() or "…"
    return None


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
                # Full SSE stream so the call can be replayed in Studio later.
                json.dumps(run.events),
            ],
        )
        for e in events:
            await query(
                """INSERT INTO call_events(run_id,seq,type,at_ms,actor,summary,model,tool,phi,phi_scope,redaction,hash,prev_hash)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                [
                    run.id,
                    e["seq"],
                    e["type"],
                    e["atMs"],
                    e["actor"],
                    e["summary"],
                    e.get("model"),
                    e.get("tool"),
                    e["phi"],
                    e.get("phiScope"),
                    e["redaction"],
                    e["hash"],
                    e["prevHash"],
                ],
            )
    except Exception as err:  # noqa: BLE001
        emit(run, ev.error_event(f"persist warning: {err}"))
