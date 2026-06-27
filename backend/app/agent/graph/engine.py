"""
The LangGraph call engine.

A `StateGraph` drives the same call the legacy loop runs, but as explicit nodes
and conditional edges instead of one `for` loop. The behaviour (SSE events, audit
chain, context graph, prediction/prefetch) lives on `CallEngine` — nodes are thin
wrappers that compose its methods, so both engines emit the same stream.

Graph shape::

    setup → decide ─┬─ tool ──────────────→ decide        (agent calls a tool)
                    ├─ speak → payer_model → decide        (autonomous payer)
                    │          payer_await → payer_human → decide   (human payer)
                    └─ finalize → END                      (end / max steps / stop)

Human-in-the-loop is native: the human-payer turn and (optionally) sensitive-tool
approvals call LangGraph's `interrupt()`, which suspends the graph at a
checkpoint. The driver resolves the interrupt from the run's inbox queues (fed by
POST /api/agent/say and /approve) and resumes with `Command(resume=...)`.
"""
from __future__ import annotations

import asyncio
import json

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import Command, interrupt

from app.agent import run_store
from app.agent.engine import MAX_STEPS, CallEngine
from app.agent.graph.state import TurnState
from app.agent.run_store import RunState, emit
from app.config import settings
from app.llm.local_llm import LLMAborted
from app.schemas import agent as ev

# Sentinel: an interrupt could not be satisfied (the run was stopped while we
# waited for the human), so the driver should finalize as "stopped".
_STOP = object()


def _engine(config) -> CallEngine:
    return config["configurable"]["engine"]


# --- nodes -----------------------------------------------------------------
async def setup_node(state: TurnState, config) -> dict:
    engine = _engine(config)
    await engine.build_graph()
    await engine.setup()
    return {"step": 0, "finished": False}


async def decide_node(state: TurnState, config) -> dict:
    engine = _engine(config)
    run = engine.run
    step = state.get("step", 0)
    if run.stopped:
        engine.outcome = "stopped"
        return {"route": "finalize", "finished": True}
    await engine.wait_while_paused()
    if step >= MAX_STEPS:
        return {"route": "finalize", "finished": True}

    decision, ctx_str = await engine.decide(step)
    new_step = step + 1

    if not decision or not decision.get("action"):
        engine.agent_msgs.append({"role": "user", "content": "Your last reply was not valid JSON. Output one JSON action only."})
        if step > 2:
            engine.outcome = "completed"
            return {"step": new_step, "route": "finalize", "finished": True}
        return {"step": new_step, "route": "decide", "ctx_str": ctx_str}

    engine.agent_msgs.append({"role": "assistant", "content": json.dumps(decision)})
    action = decision.get("action")

    # Conversation guard — may not record/summarize/end before speaking with the rep.
    if engine.apply_guard(decision):
        return {"step": new_step, "route": "decide", "ctx_str": ctx_str}

    if action == "tool" and decision.get("tool"):
        return {"step": new_step, "route": "tool", "decision": decision, "ctx_str": ctx_str}

    if action == "end":
        engine.outcome = "escalated" if decision.get("outcome") == "escalated" else "completed"
        summary = decision.get("summary")
        if summary:
            engine.push_turn("agent", summary)
            engine.transcript_text += f"\nAGENT: {summary}"
        return {"step": new_step, "route": "finalize", "finished": True}

    return {"step": new_step, "route": "speak", "decision": decision, "ctx_str": ctx_str}


async def tool_node(state: TurnState, config) -> dict:
    engine = _engine(config)
    run = engine.run
    decision = dict(state["decision"] or {})
    tool_name = decision.get("tool")
    args = decision.get("args") or {}

    # ---- HITL: approval interrupt for sensitive write tools (gated by config) ----
    # interrupt() must be the first side-effect in the node: on resume the node
    # re-executes from the top, and interrupt() then returns the resume value.
    if tool_name in settings.approval_tools:
        emit(run, ev.await_event(True, "approval"))
        approval = interrupt({"type": "approval", "tool": tool_name, "args": args})
        emit(run, ev.await_event(False, "approval"))
        if isinstance(approval, dict) and not approval.get("approved", True):
            engine.agent_msgs.append(
                {"role": "user", "content": f"TOOL_DENIED {tool_name}: a human reviewer declined this action. Choose another step."}
            )
            engine.push_audit(
                type="compliance.flag", actor="operator",
                summary=f"Human reviewer declined the {tool_name} action (approval interrupt).",
                phi=False, redaction="none",
            )
            return {"route": "decide"}
        if isinstance(approval, dict) and isinstance(approval.get("args"), dict) and approval["args"]:
            decision["args"] = approval["args"]

    await engine.execute_tool(decision)
    if run.stopped:
        engine.outcome = "stopped"
        return {"route": "finalize", "finished": True}
    return {"route": "decide"}


async def speak_node(state: TurnState, config) -> dict:
    engine = _engine(config)
    run = engine.run
    text = engine.speak(state["decision"], state.get("ctx_str", ""))
    if run.stopped:
        engine.outcome = "stopped"
        return {"agent_text": text, "route": "finalize", "finished": True}
    await engine.wait_while_paused()
    if run.human_payer:
        return {"agent_text": text, "route": "payer_await"}
    return {"agent_text": text, "route": "payer_model"}


async def payer_model_node(state: TurnState, config) -> dict:
    engine = _engine(config)
    run = engine.run
    payer, latency = await engine.run_payer_model(state["agent_text"])
    payer_text = (payer.get("text") or "").strip() or "Let me check on that."
    engine.record_payer(payer_text, latency)
    engine.fire_anticipation()
    emit(run, ev.status_event("active", engine.phase_from_prediction(engine.last_prediction), engine.now()))
    engine.push_metrics()
    if payer.get("ends") and state.get("step", 0) > 2:
        engine.agent_msgs.append({"role": "user", "content": "The payer indicated the call is concluding. Record, summarize, and end."})
    return {"route": "decide"}


async def payer_await_node(state: TurnState, config) -> dict:
    # Forecast the rep's reply BEFORE we wait — the predictions become the
    # suggested replies the human sees while typing (mirrors the legacy loop).
    engine = _engine(config)
    engine.fire_anticipation()
    emit(engine.run, ev.await_event(True, "payer"))
    return {"route": "payer_human"}


async def payer_human_node(state: TurnState, config) -> dict:
    engine = _engine(config)
    run = engine.run
    text = interrupt({"type": "payer", "awaiting": "payer"})
    emit(run, ev.await_event(False, "payer"))
    if text is None or run.stopped:
        engine.outcome = "stopped"
        return {"route": "finalize", "finished": True}
    engine.record_payer((text or "").strip() or "…", None)
    emit(run, ev.status_event("active", engine.phase_from_prediction(engine.last_prediction), engine.now()))
    engine.push_metrics()
    return {"route": "decide"}


async def finalize_node(state: TurnState, config) -> dict:
    engine = _engine(config)
    await engine.finalize()
    return {"finished": True}


def _route(state: TurnState) -> str:
    return state.get("route", "finalize")


def build_call_graph():
    g = StateGraph(TurnState)
    g.add_node("setup", setup_node)
    g.add_node("decide", decide_node)
    g.add_node("tool", tool_node)
    g.add_node("speak", speak_node)
    g.add_node("payer_model", payer_model_node)
    g.add_node("payer_await", payer_await_node)
    g.add_node("payer_human", payer_human_node)
    g.add_node("finalize", finalize_node)

    g.set_entry_point("setup")
    g.add_edge("setup", "decide")
    g.add_conditional_edges("decide", _route, {"tool": "tool", "speak": "speak", "decide": "decide", "finalize": "finalize"})
    g.add_conditional_edges("tool", _route, {"decide": "decide", "finalize": "finalize"})
    g.add_conditional_edges("speak", _route, {"payer_model": "payer_model", "payer_await": "payer_await", "finalize": "finalize"})
    g.add_edge("payer_await", "payer_human")
    g.add_conditional_edges("payer_model", _route, {"decide": "decide", "finalize": "finalize"})
    g.add_conditional_edges("payer_human", _route, {"decide": "decide", "finalize": "finalize"})
    g.add_edge("finalize", END)

    # In-process MemorySaver matches the single-instance run_store; it persists
    # checkpoints so interrupt()/resume works within the process lifetime.
    return g.compile(checkpointer=MemorySaver())


# A single compiled graph is reused across runs; per-run state is isolated by
# `thread_id` and the `engine` passed in config, so this is safe to share.
_GRAPH = None


def _graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_call_graph()
    return _GRAPH


async def _await_inbox(run: RunState, inbox: asyncio.Queue):
    """Block until the human submits to `inbox`, racing the run's abort. Returns
    the submitted value, or `_STOP` if the run was stopped while waiting."""
    get_task = asyncio.create_task(inbox.get())
    abort_task = asyncio.create_task(run.abort.wait())
    done, _pending = await asyncio.wait({get_task, abort_task}, return_when=asyncio.FIRST_COMPLETED)
    for t in (get_task, abort_task):
        if t not in done:
            t.cancel()
    if get_task in done and not run.stopped:
        try:
            return get_task.result()
        except Exception:  # noqa: BLE001
            return _STOP
    return _STOP


async def _resolve_interrupt(run: RunState, payload: dict):
    kind = (payload or {}).get("type")
    if kind == "payer":
        text = await _await_inbox(run, run.payer_inbox)
        if text is _STOP:
            emit(run, ev.await_event(False, "payer"))  # clear the reply box on stop
        return text
    if kind == "approval":
        return await _await_inbox(run, run.approval_inbox)
    return _STOP


async def run_orchestrator_lg(run: RunState) -> None:
    """Drive a call through the StateGraph engine. Same SSE contract + persistence
    as the legacy `run_orchestrator`; selected via settings.agent_engine."""
    engine = CallEngine(run)
    graph = _graph()
    config = {"configurable": {"thread_id": run.id, "engine": engine}, "recursion_limit": 200}
    try:
        result = await graph.ainvoke({"step": 0, "finished": False}, config)
        # Resume loop: each suspended interrupt is satisfied from an inbox queue.
        while result and "__interrupt__" in result:
            payload = result["__interrupt__"][0].value
            resume = await _resolve_interrupt(run, payload)
            if resume is _STOP:
                engine.outcome = "stopped"
                break
            result = await graph.ainvoke(Command(resume=resume), config)
        # Stopped while suspended at an interrupt → finalize never ran in-graph.
        if engine.outcome == "stopped" and not run.done:
            await engine.finalize()
    except (LLMAborted, asyncio.CancelledError):
        emit(run, ev.status_event("idle", 0, engine.now()))
        emit(run, ev.done_event("stopped"))
        run.done = True
    except Exception as err:  # noqa: BLE001 - surface any engine failure to the stream
        if run.abort.is_set() or run.stopped:
            emit(run, ev.status_event("idle", 0, engine.now()))
            emit(run, ev.done_event("stopped"))
        else:
            emit(run, ev.error_event(str(err) or "Orchestrator error"))
            emit(run, ev.done_event("stopped"))
        run.done = True
    finally:
        if run.pred_task and not run.pred_task.done():
            run.pred_task.cancel()
        run_store.close_subscribers(run)
