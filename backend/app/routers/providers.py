"""
Provider endpoints, ported from the Next.js `/api/providers` and `/api/llm` routes:
  GET  /api/providers — health + status of LLM/voice/telephony providers
  POST /api/llm       — model-agnostic chat routing (falls back to demo engine)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.llm.local_llm import local_llm_health
from app.providers.router import get_all_provider_statuses, route_chat
from app.routers._deps import require_internal
from app.schemas.providers import ChatCompletionRequest, ChatMessage
from app.voice.registry import get_telephony_statuses, get_voice_statuses
from app.voice.types import is_demo_mode

router = APIRouter(prefix="/api", tags=["providers"], dependencies=[Depends(require_internal)])


@router.get("/providers")
async def providers():
    health = await local_llm_health()
    return {
        "demoMode": is_demo_mode(),
        "promptVersion": settings.voiceops_prompt_version,
        "localLLM": {
            "ok": health["ok"],
            "model": health["model"],
            "baseUrl": settings.local_llm_base_url,
            "detail": health["detail"],
        },
        "llm": [s.to_wire() for s in get_all_provider_statuses()],
        "voice": [s.to_wire() for s in get_voice_statuses()],
        "telephony": [s.to_wire() for s in get_telephony_statuses()],
    }


@router.post("/llm")
async def llm(request: Request):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}

    model = body.get("model") if isinstance(body.get("model"), str) else "demo/voiceops-sim-1"
    raw_messages = body.get("messages")
    if isinstance(raw_messages, list) and raw_messages:
        messages = [ChatMessage(**m) for m in raw_messages]
    else:
        messages = [
            ChatMessage(role="system", content="You are a healthcare payer-operations voice agent. Be concise and accurate."),
            ChatMessage(role="user", content="Give a one-line status of the current payer call."),
        ]

    result = await route_chat(
        ChatCompletionRequest(
            model=model,
            messages=messages,
            temperature=body.get("temperature") if isinstance(body.get("temperature"), (int, float)) else None,
            max_tokens=body.get("maxTokens") if isinstance(body.get("maxTokens"), int) else None,
        )
    )
    return result.to_wire()
