"""
Voice-agent sandbox endpoints (browser/WebRTC via LiveKit).

  GET  /api/voice/options  — the selectable building blocks (scenarios, voices,
                             models) so the playground UI can be fully modular.
  POST /api/voice/token    — mint a room token AND stamp the chosen session
                             config (scenario, voice, model, instructions, temp)
                             onto the room metadata so the agent runs exactly the
                             configuration the user picked. Provisions a call_runs
                             row so the run shows in analytics.
"""
from __future__ import annotations

import json
import secrets
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from app.config import settings
from app.db import query
from app.providers.registry import MODELS
from app.routers._deps import require_internal, require_user
from app.simulation.scenarios import DEFAULT_SCENARIO_ID, SCENARIOS, get_scenario

router = APIRouter(prefix="/api/voice", tags=["voice"], dependencies=[Depends(require_internal)])

_DEFAULT_VOICES = [
    {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "category": "professional"},
    {"id": "JBFqnCBsd6RMkjVDRZzb", "name": "George", "category": "professional"},
    {"id": "pqHfZKP75CvOlQylNhV4", "name": "Bill", "category": "professional"},
]


async def _elevenlabs_voices() -> list[dict]:
    """Real voice catalog from the ElevenLabs account; falls back to a small set."""
    key = (settings.elevenlabs_api_key or "").strip()
    if not key:
        return _DEFAULT_VOICES
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(6.0)) as client:
            res = await client.get(
                "https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key}
            )
        if res.status_code == 200:
            voices = res.json().get("voices", [])
            return [
                {"id": v["voice_id"], "name": v.get("name", v["voice_id"]), "category": v.get("category", "")}
                for v in voices
            ]
    except Exception:  # noqa: BLE001 - degrade to defaults
        pass
    return _DEFAULT_VOICES


def _runnable_models() -> list[dict]:
    """Models the agent can actually run: the local MLX model, plus hosted ones if a key is set."""
    out: list[dict] = [
        {"id": settings.local_llm_model, "label": f"{settings.local_llm_model.split('/')[-1]} (local)", "kind": "local"}
    ]
    if (settings.openrouter_api_key or "").strip():
        out.extend(
            {"id": m.id, "label": m.label, "kind": "hosted"}
            for m in MODELS
            if m.provider_id == "openrouter"
        )
    return out


@router.get("/options")
async def options():
    voices = await _elevenlabs_voices()
    models = _runnable_models()
    return {
        "scenarios": [
            {
                "id": s.id,
                "title": s.title,
                "payer": s.payer,
                "category": s.category,
                "objective": s.objective,
                "requiredFields": s.required_fields,
            }
            for s in SCENARIOS
        ],
        "voices": voices,
        "models": models,
        "defaults": {
            "scenarioId": DEFAULT_SCENARIO_ID,
            "model": models[0]["id"] if models else settings.local_llm_model,
            "voiceId": voices[0]["id"] if voices else None,
            "temperature": 0.4,
        },
        "speechProvider": "elevenlabs" if (settings.elevenlabs_api_key or "").strip() else None,
    }


@router.post("/token")
async def token(request: Request, user_id: str = Depends(require_user)):
    if not (settings.livekit_url and settings.livekit_api_key and settings.livekit_api_secret):
        raise HTTPException(status_code=503, detail="LiveKit is not configured on the server")

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}

    scenario = get_scenario(body.get("scenarioId") if isinstance(body.get("scenarioId"), str) else DEFAULT_SCENARIO_ID)
    model = body.get("model") if isinstance(body.get("model"), str) and body.get("model") else settings.local_llm_model

    run_id = f"voice_{int(time.time() * 1000):x}_{secrets.token_hex(3)}"
    room = run_id

    # The full session config the agent will run — stamped onto the room metadata.
    config = {
        "runId": run_id,
        "scenarioId": scenario.id,
        "model": model,
        "voiceId": body.get("voiceId") if isinstance(body.get("voiceId"), str) else None,
        "instructions": body.get("instructions") if isinstance(body.get("instructions"), str) else None,
        "temperature": body.get("temperature") if isinstance(body.get("temperature"), (int, float)) else 0.4,
    }
    metadata = json.dumps(config)

    try:
        await query(
            """INSERT INTO call_runs(id,user_id,scenario_id,payer,model,status,outcome,started_at)
               VALUES ($1,$2,$3,$4,$5,'dialing',NULL, now()) ON CONFLICT (id) DO NOTHING""",
            [run_id, user_id, scenario.id, scenario.payer, model],
        )
    except Exception:  # noqa: BLE001
        pass

    from livekit import api

    # Create the room up-front carrying the config metadata, so the agent reads
    # the exact selected configuration (best-effort; token still works without it).
    try:
        lk = api.LiveKitAPI(
            url=settings.livekit_url.replace("wss://", "https://").replace("ws://", "http://"),
            api_key=settings.livekit_api_key,
            api_secret=settings.livekit_api_secret,
        )
        await lk.room.create_room(api.CreateRoomRequest(name=room, metadata=metadata, empty_timeout=300))
        await lk.aclose()
    except Exception:  # noqa: BLE001
        pass

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

    return {"url": settings.livekit_url, "token": jwt, "room": room, "runId": run_id, "config": config}
