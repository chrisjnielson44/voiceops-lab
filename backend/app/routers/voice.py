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
from fastapi.responses import Response

from app.config import settings
from app.db import query
from app.packs.registry import all_scenarios, default_scenario_id, get_scenario, pack_for_scenario
from app.providers.registry import MODELS
from app.routers._deps import require_internal, require_user

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


# Name fragments that mark a local model as reasoning-capable (emits a separate
# chain-of-thought we can surface inline). Embedding models are excluded.
_REASONING_HINTS = ("qwen3", "gemma", "deepseek", "-r1", "r1-", "magistral", "think", "reason", "phi-4")


def _is_reasoning(model_id: str) -> bool:
    m = model_id.lower()
    if "embed" in m:
        return False
    return any(h in m for h in _REASONING_HINTS)


def _model_label(model_id: str) -> str:
    return f"{model_id.split('/')[-1]} (local)"


async def _local_models() -> list[dict]:
    """Enumerate the models the local OpenAI-compatible server can run, so the
    picker offers every installed model (reasoning ones flagged). Degrades to the
    single configured model if the server can't be reached."""
    base = settings.local_llm_base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
            res = await client.get(
                f"{base}/models", headers={"Authorization": f"Bearer {settings.local_llm_api_key}"}
            )
        if res.status_code == 200:
            ids = [m.get("id") for m in (res.json().get("data") or []) if m.get("id")]
            models = [
                {"id": mid, "label": _model_label(mid), "kind": "local", "reasoning": _is_reasoning(mid)}
                for mid in ids
                if "embed" not in mid.lower()
            ]
            if models:
                # Reasoning models first (the headline capability), then by name.
                models.sort(key=lambda m: (not m["reasoning"], m["id"]))
                return models
    except Exception:  # noqa: BLE001 - degrade to the configured model
        pass
    mid = settings.local_llm_model
    return [{"id": mid, "label": _model_label(mid), "kind": "local", "reasoning": _is_reasoning(mid)}]


async def _runnable_models() -> list[dict]:
    """Models the agent can actually run: the local models, plus hosted ones if a key is set."""
    out: list[dict] = await _local_models()
    if (settings.openrouter_api_key or "").strip():
        out.extend(
            {"id": m.id, "label": m.label, "kind": "hosted", "reasoning": False}
            for m in MODELS
            if m.provider_id == "openrouter"
        )
    return out


def _default_model(models: list[dict]) -> str:
    """Default the picker to the configured agent model when present, else the
    first reasoning model, else the first available model."""
    ids = [m["id"] for m in models]
    if settings.local_llm_model in ids:
        return settings.local_llm_model
    for m in models:
        if m.get("reasoning"):
            return m["id"]
    return ids[0] if ids else settings.local_llm_model


@router.get("/options")
async def options():
    voices = await _elevenlabs_voices()
    models = await _runnable_models()
    return {
        "scenarios": [
            {
                "id": s.id,
                "title": s.title,
                "pack": pack_for_scenario(s.id).id,
                "packLabel": pack_for_scenario(s.id).label,
                "payer": s.payer,
                "category": s.category,
                "objective": s.objective,
                "requiredFields": s.required_fields,
            }
            for s in all_scenarios()
        ],
        "voices": voices,
        "models": models,
        "defaults": {
            "scenarioId": default_scenario_id(),
            "model": _default_model(models),
            "voiceId": voices[0]["id"] if voices else None,
            "temperature": 0.4,
        },
        "speechProvider": "elevenlabs" if (settings.elevenlabs_api_key or "").strip() else None,
    }


@router.post("/tts")
async def tts(request: Request, _user: str = Depends(require_user)):
    """Synthesize a single line of speech via ElevenLabs so Simulate mode can be
    heard, not just read. Returns audio/mpeg; the SPA plays agent + payer turns in
    distinct voices. Best-effort — a missing key / API hiccup degrades to silence."""
    key = (settings.elevenlabs_api_key or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="ElevenLabs not configured")
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    text = (str(body.get("text") or "")).strip()[:900]
    if not text:
        raise HTTPException(status_code=400, detail="text required")
    voice_id = body.get("voiceId") if isinstance(body.get("voiceId"), str) and body.get("voiceId") else (
        settings.elevenlabs_voice_id or _DEFAULT_VOICES[0]["id"]
    )
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            res = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": key, "accept": "audio/mpeg", "content-type": "application/json"},
                params={"output_format": "mp3_44100_128"},
                json={"text": text, "model_id": "eleven_turbo_v2_5"},
            )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"tts upstream error: {e}") from e
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"tts upstream {res.status_code}: {res.text[:120]}")
    return Response(content=res.content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


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

    scenario = get_scenario(body.get("scenarioId") if isinstance(body.get("scenarioId"), str) else default_scenario_id())
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
