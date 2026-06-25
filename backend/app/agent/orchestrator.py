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
from app.agent.personas import (
    agent_system_prompt,
    load_ground_truth,
    payer_system_prompt,
    predictor_system_prompt,
)
from app.agent.run_store import RunState, emit
from app.agent.tools import ToolContext, execute_tool
from app.audit.ledger import audit_canonical
from app.config import settings
from app.core.format import clamp, format_time_of_day, now_ms
from app.core.hash import GENESIS_HASH, chain_hash
from app.db import query
from app.llm.local_llm import LLMAborted, chat_json, local_model_id
from app.schemas import agent as ev
from app.schemas.agent import LiveTool, LiveTurn, RunMetrics
from app.schemas.audit import AuditEvent
from app.schemas.simulation import PredictionSnapshot, Scenario
from app.simulation.scenarios import get_scenario

MAX_STEPS = 16
PROMPT_VERSION = settings.voiceops_prompt_version


async def run_orchestrator(run: RunState) -> None:
    scenario = get_scenario(run.scenario_id)
    t0 = run.started_at

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

    def push_turn(speaker: str, text: str, latency_ms: int | None = None) -> None:
        nonlocal seq
        turn = LiveTurn(id=f"t-{seq}", seq=seq, speaker=speaker, text=text, at_ms=now(), latency_ms=latency_ms)
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

    agent_msgs: list[dict] = [{"role": "system", "content": agent_system_prompt(scenario)}]
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

        gt = await load_ground_truth(scenario)
        payer_msgs.append({"role": "system", "content": payer_system_prompt(scenario, gt.text)})

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

        for step in range(MAX_STEPS):
            if run.stopped:
                outcome = "stopped"
                break
            await wait_while_paused()

            # ---- AGENT decides an action ----
            dec = await chat_json(
                [
                    *agent_msgs,
                    {
                        "role": "user",
                        "content": "Begin the call. Output your first JSON action."
                        if step == 0
                        else "Continue. Output your next JSON action.",
                    },
                ],
                temperature=0.3,
                max_tokens=240,
                abort=abort,
            )
            metrics.inferences += 1
            metrics.completion_tokens += dec.completion_tokens
            latencies.append(dec.latency_ms)
            decision = dec.value if isinstance(dec.value, dict) else None

            if not decision or not decision.get("action"):
                agent_msgs.append({"role": "user", "content": "Your last reply was not valid JSON. Output one JSON action only."})
                if step > 2:
                    outcome = "completed"
                    break
                continue

            agent_msgs.append({"role": "assistant", "content": json.dumps(decision)})
            action = decision.get("action")

            if action == "tool" and decision.get("tool"):
                started = now()
                tool_name = decision["tool"]
                tool_args = decision.get("args") or {}
                res = await execute_tool(
                    tool_name,
                    tool_args,
                    ToolContext(
                        run_id=run.id,
                        scenario_id=scenario.id,
                        member_id=scenario.patient.member_id,
                        claim_id=scenario.claim.id if (scenario.category == "claim-status" and scenario.claim) else None,
                        auth_id=scenario.claim.id if (scenario.category == "prior-auth" and scenario.claim) else None,
                        transcript=transcript_text,
                    ),
                )
                metrics.tool_calls += 1
                if res.status == "error":
                    metrics.tool_errors += 1
                if res.phi:
                    metrics.phi_accesses += 1

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
                )
                seq += 1
                emit(run, ev.tool_event(tool))

                phi_scope = f"member:***{scenario.patient.member_id[-4:]}" if res.phi else None
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
            push_turn("agent", text, dec.latency_ms)
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

            # ---- PAYER replies (second live model) ----
            if run.stopped:
                outcome = "stopped"
                break
            await wait_while_paused()
            payer_msgs.append({"role": "user", "content": text})
            pr = await chat_json(payer_msgs, temperature=0.45, max_tokens=180, abort=abort)
            metrics.inferences += 1
            metrics.completion_tokens += pr.completion_tokens
            latencies.append(pr.latency_ms)
            payer = pr.value if isinstance(pr.value, dict) else None
            if payer is None:
                payer = {"text": "I'm sorry, could you repeat that?", "ends": False, "escalate": False}
            payer_msgs.append({"role": "assistant", "content": json.dumps(payer)})
            payer_text = (payer.get("text") or "").strip() or "Let me check on that."
            push_turn("payer", payer_text, pr.latency_ms)
            transcript_text += f"\nPAYER: {payer_text}"
            agent_msgs.append({"role": "user", "content": f"PAYER said: {payer_text}"})

            # ---- PREDICTION (third live inference) ----
            pred = await chat_json(
                [
                    {"role": "system", "content": predictor_system_prompt(scenario)},
                    {"role": "user", "content": f"Transcript so far:\n{transcript_text[-3000:]}"},
                ],
                temperature=0.2,
                max_tokens=220,
                abort=abort,
            )
            metrics.inferences += 1
            latencies.append(pred.latency_ms)
            if isinstance(pred.value, dict):
                last_prediction = _normalize_prediction(pred.value, scenario)
                emit(run, ev.prediction_event(last_prediction))
                push_audit(
                    type="prediction.update",
                    actor="system",
                    summary=f"Prediction — completion {last_prediction.completion_probability * 100:.0f}%, "
                    f"escalation {last_prediction.escalation_risk * 100:.0f}%.",
                    phi=False,
                    redaction="none",
                )

            emit(run, ev.status_event("active", phase_from_prediction(last_prediction), now()))
            push_metrics()

            if payer.get("escalate"):
                payer_ended = True
            if payer.get("ends") and step > 1:
                agent_msgs.append({"role": "user", "content": "The payer indicated the call is concluding. Record, summarize, and end."})
            # (payer_ended + high escalation risk simply lets the agent escalate next turn)
            _ = payer_ended

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
        run_store.close_subscribers(run)


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
            """INSERT INTO call_runs(id,user_id,scenario_id,payer,model,status,outcome,completion_prob,escalation_risk,started_at,ended_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10/1000.0), now())
               ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, outcome=EXCLUDED.outcome,
                 completion_prob=EXCLUDED.completion_prob, escalation_risk=EXCLUDED.escalation_risk, ended_at=now()""",
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
