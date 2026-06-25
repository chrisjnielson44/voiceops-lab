"""
LiveKit voice endpoints (browser/WebRTC). `POST /api/voice/token` mints a
short-lived room access token for the authenticated user and provisions a
`call_runs` row so the voice call shows up in the cockpit/analytics just like a
text run. The agent worker joins the same room (scenario/run id are passed as
room metadata) and appends `call_events`.
"""
from __future__ import annotations

import json
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request

from app.config import settings
from app.db import query
from app.routers._deps import require_internal, require_user
from app.simulation.scenarios import get_scenario

router = APIRouter(prefix="/api/voice", tags=["voice"], dependencies=[Depends(require_internal)])


@router.post("/token")
async def token(request: Request, user_id: str = Depends(require_user)):
    if not (settings.livekit_url and settings.livekit_api_key and settings.livekit_api_secret):
        raise HTTPException(status_code=503, detail="LiveKit is not configured on the server")

    body = {}
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    scenario_id = body.get("scenarioId") if isinstance(body.get("scenarioId"), str) else "elig-aetna"
    scenario = get_scenario(scenario_id)

    run_id = f"voice_{int(time.time() * 1000):x}_{secrets.token_hex(3)}"
    room = run_id
    metadata = json.dumps({"runId": run_id, "scenarioId": scenario.id})

    # Best-effort: register the run so the cockpit/analytics see the voice call.
    try:
        await query(
            """INSERT INTO call_runs(id,user_id,scenario_id,payer,model,status,outcome,started_at)
               VALUES ($1,$2,$3,$4,$5,'dialing',NULL, now()) ON CONFLICT (id) DO NOTHING""",
            [run_id, user_id, scenario.id, scenario.payer, "livekit+mlx"],
        )
    except Exception:  # noqa: BLE001 - persistence is best-effort
        pass

    # Import here so the rest of the app runs even if livekit-api isn't installed.
    from livekit import api

    jwt = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(user_id)
        .with_name(user_id)
        .with_metadata(metadata)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )

    return {"url": settings.livekit_url, "token": jwt, "room": room, "runId": run_id, "scenarioId": scenario.id}
