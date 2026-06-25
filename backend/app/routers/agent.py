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

from app.agent.orchestrator import run_orchestrator
from app.agent.run_store import STREAM_END, create_run, get_run, subscribe, unsubscribe
from app.llm.local_llm import local_model_id
from app.routers._deps import require_internal, require_user

router = APIRouter(prefix="/api/agent", tags=["agent"], dependencies=[Depends(require_internal)])


def _run_id() -> str:
    return f"run_{int(time.time() * 1000):x}_{secrets.token_hex(3)}"


@router.post("/start")
async def start(request: Request, user_id: str = Depends(require_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - tolerate empty/invalid body like the TS route
        body = {}

    scenario_id = body.get("scenarioId") if isinstance(body.get("scenarioId"), str) else "elig-aetna"
    model = body.get("model") if isinstance(body.get("model"), str) and body.get("model") else local_model_id()

    run = create_run(
        id=_run_id(),
        scenario_id=scenario_id,
        model=model,
        user_id=user_id,
    )
    # Fire-and-forget; the loop streams via SSE and persists on completion.
    run.task = asyncio.create_task(run_orchestrator(run))

    return {"runId": run.id, "model": model, "scenarioId": scenario_id}


@router.get("/stream")
async def stream(runId: str, request: Request, _user: str = Depends(require_user)):
    run = get_run(runId)
    if not run:
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
                except asyncio.TimeoutError:
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
