"""
Live-call endpoints, ported from the Next.js `/api/agent/*` routes:
  POST /api/agent/start    — create a run, fire the orchestrator, return the runId
  GET  /api/agent/stream   — SSE replay + live event stream for a run
  POST /api/agent/control  — pause / resume / stop a run
"""
from __future__ import annotations

import asyncio
import json
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.agent.dispatch import run_call
from app.agent.live_bridge import get_or_create_bridge
from app.agent.run_store import STREAM_END, create_run, get_run, subscribe, unsubscribe
from app.db import query_one
from app.llm.local_llm import local_model_id
from app.routers._deps import require_internal, require_user

router = APIRouter(prefix="/api/agent", tags=["agent"], dependencies=[Depends(require_internal)])

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _run_id() -> str:
    return f"run_{int(time.time() * 1000):x}_{secrets.token_hex(3)}"


def _parse_stream(value) -> list | None:
    """asyncpg may hand back JSONB as a str (no codec) or already-parsed."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return value if isinstance(value, list) else None


@router.post("/start")
async def start(request: Request, user_id: str = Depends(require_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - tolerate empty/invalid body like the TS route
        body = {}

    scenario_id = body.get("scenarioId") if isinstance(body.get("scenarioId"), str) else "elig-aetna"
    model = body.get("model") if isinstance(body.get("model"), str) and body.get("model") else local_model_id()
    # Text role-play: the agent leads and the human plays the payer rep (the
    # orchestrator awaits POST /api/agent/say instead of running the payer model).
    human_payer = bool(body.get("humanPayer"))

    run = create_run(
        id=_run_id(),
        scenario_id=scenario_id,
        model=model,
        user_id=user_id,
        human_payer=human_payer,
    )
    # Fire-and-forget; the loop streams via SSE and persists on completion.
    # run_call opens the trace and selects the engine (legacy / langgraph).
    run.task = asyncio.create_task(run_call(run))

    return {"runId": run.id, "model": model, "scenarioId": scenario_id, "humanPayer": human_payer}


@router.get("/stream")
async def stream(runId: str, request: Request, _user: str = Depends(require_user)):
    run = get_run(runId)
    if not run:
        # Not in memory. Either: (a) a stored call → replay the persisted stream
        # so it re-opens in full from Call History; or (b) a *live* voice run that
        # the worker hasn't ingested yet → attach a placeholder the LiveBridge
        # will feed, so the browser can subscribe before the first event lands.
        row = await query_one(
            "SELECT scenario_id, model, status, event_stream FROM call_runs WHERE id=$1", [runId]
        )
        events = _parse_stream(row.get("event_stream")) if row else None
        if events:
            async def replay_source():
                for e in events:
                    yield f"data: {json.dumps(e)}\n\n"
                if not events or (isinstance(events[-1], dict) and events[-1].get("kind") != "done"):
                    yield f"data: {json.dumps({'kind': 'done', 'outcome': 'completed'})}\n\n"

            return StreamingResponse(replay_source(), media_type="text/event-stream", headers=_SSE_HEADERS)

        if row and row.get("status") in ("dialing", "active"):
            # A live voice run not yet ingested — attach a placeholder the
            # LiveBridge will feed, then fall through to the live event_source.
            run = create_run(
                id=runId,
                scenario_id=row.get("scenario_id") or "",
                model=row.get("model") or "",
                user_id=None,
            )
            run.live = True
        else:
            raise HTTPException(status_code=404, detail="run not found")

    async def event_source():
        # Replay buffered events so a late-joining client sees the whole call.
        for e in list(run.events):
            yield f"data: {json.dumps(e)}\n\n"
        if run.done:
            return

        q = subscribe(run)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(q.get(), timeout=15.0)
                except TimeoutError:
                    # Heartbeat comment keeps proxies from closing an idle stream.
                    yield ": keep-alive\n\n"
                    continue
                if item is STREAM_END:
                    break
                yield f"data: {json.dumps(item)}\n\n"
                if isinstance(item, dict) and item.get("kind") == "done":
                    break
        finally:
            unsubscribe(run, q)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/ingest")
async def ingest(request: Request):
    """Out-of-process live-voice bridge. The LiveKit worker (`agent/agent.py`)
    forwards each conversation turn, tool call, and lifecycle event here; the
    LiveBridge enriches them (context graph, predictions, reasoning, audit) and
    fans the result into the run's SSE so the cockpit lights up like simulate.

    Internal/machine-to-machine: gated by the router's `require_internal` shared
    secret only — the worker has no user session, so no `require_user` here."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}

    run_id = body.get("runId")
    event = body.get("event")
    if not isinstance(run_id, str) or not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="runId and event required")

    bridge = await get_or_create_bridge(
        run_id=run_id,
        scenario_id=str(body.get("scenarioId") or ""),
        model=body.get("model") if isinstance(body.get("model"), str) else None,
        user_id=body.get("userId") if isinstance(body.get("userId"), str) else None,
    )
    if bridge is None:
        raise HTTPException(status_code=422, detail="unknown scenario")

    kind = event.get("kind")
    if kind == "turn":
        await bridge.on_turn(
            str(event.get("speaker") or "payer"),
            str(event.get("text") or ""),
            event.get("latencyMs") if isinstance(event.get("latencyMs"), int) else None,
        )
    elif kind == "tool":
        await bridge.on_tool(
            tool=str(event.get("tool") or "tool"),
            args=event.get("args") if isinstance(event.get("args"), dict) else {},
            result=str(event.get("result") or ""),
            status=str(event.get("status") or "ok"),
            latency_ms=event.get("latencyMs") if isinstance(event.get("latencyMs"), int) else 0,
            phi=bool(event.get("phi")),
            phi_scope=event.get("phiScope") if isinstance(event.get("phiScope"), str) else None,
        )
    elif kind == "done":
        await bridge.on_done(str(event.get("outcome") or "completed"))
    elif kind == "hello":
        pass  # get_or_create_bridge already emitted the open/start events
    else:
        raise HTTPException(status_code=400, detail=f"unknown event kind: {kind}")

    return {"ok": True, "runId": run_id}


@router.post("/context")
async def context(request: Request):
    """Anticipatory grounding for a live voice turn. The LiveKit worker calls this
    from `on_user_turn_completed` (before the LLM replies) to fetch the verified
    records — those the conversation has surfaced PLUS the records the anticipated
    next intents point at — and injects them into the agent's chat context. So the
    context graph and anticipation actually steer the live agent's answer, not just
    the cockpit panels.

    Internal/machine-to-machine: the worker has no user session, so this is gated
    by the router's `require_internal` shared secret only (like `/ingest`)."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}

    run_id = body.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise HTTPException(status_code=400, detail="runId required")

    bridge = await get_or_create_bridge(
        run_id=run_id,
        scenario_id=str(body.get("scenarioId") or ""),
        model=body.get("model") if isinstance(body.get("model"), str) else None,
        user_id=body.get("userId") if isinstance(body.get("userId"), str) else None,
    )
    if bridge is None:
        # Unknown scenario / nothing to ground — the agent proceeds ungrounded.
        return {"context": "", "anticipated": []}

    text = body.get("text") if isinstance(body.get("text"), str) else ""
    return await bridge.grounding(text)


@router.post("/say")
async def say(request: Request, _user: str = Depends(require_user)):
    """Submit the human's reply in a text role-play run (the human plays the payer
    rep). The text is handed to the orchestrator, which resumes the agent's turn."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}

    run = get_run(body.get("runId")) if isinstance(body.get("runId"), str) else None
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    if not run.human_payer:
        raise HTTPException(status_code=409, detail="run is not a role-play session")
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=400, detail="text required")

    run.payer_inbox.put_nowait(text.strip())
    return {"ok": True}


@router.post("/approve")
async def approve(request: Request, _user: str = Depends(require_user)):
    """Resolve a pending sensitive-tool approval interrupt (langgraph engine).
    Body: {runId, approved: bool, args?: object}. The graph driver is blocked on
    the run's approval_inbox; this hands it the human's decision so the tool node
    resumes (executes, executes with edited args, or is declined)."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}

    run = get_run(body.get("runId")) if isinstance(body.get("runId"), str) else None
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    approved = bool(body.get("approved"))
    args = body.get("args") if isinstance(body.get("args"), dict) else None
    run.approval_inbox.put_nowait({"approved": approved, "args": args})
    return {"ok": True, "approved": approved}


@router.post("/control")
async def control(request: Request, _user: str = Depends(require_user)):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}

    run = get_run(body.get("runId")) if isinstance(body.get("runId"), str) else None
    if not run:
        raise HTTPException(status_code=404, detail="run not found")

    action = body.get("action")
    if action == "pause":
        run.paused = True
    elif action == "resume":
        run.paused = False
    elif action == "stop":
        run.stopped = True
        run.paused = False
        run.abort.set()
    else:
        raise HTTPException(status_code=400, detail="unknown action")

    return {"ok": True, "status": run.status, "paused": run.paused, "stopped": run.stopped}
