"""Provider routing + deterministic demo adapter."""
from __future__ import annotations

import pytest

from app.providers.demo import demo_provider
from app.providers.router import route_chat
from app.schemas.providers import ChatCompletionRequest, ChatMessage

pytestmark = pytest.mark.asyncio


def _req(model: str) -> ChatCompletionRequest:
    return ChatCompletionRequest(model=model, messages=[ChatMessage(role="user", content="status?")])


async def test_demo_is_deterministic():
    a = await demo_provider.chat(_req("demo/voiceops-sim-1"))
    b = await demo_provider.chat(_req("demo/voiceops-sim-1"))
    assert a.text == b.text
    assert a.latency_ms == b.latency_ms
    assert a.demo is True


async def test_route_falls_back_to_demo_when_unconfigured(monkeypatch):
    # An OpenRouter model with no API key configured should fall back to demo.
    from app.config import settings

    monkeypatch.setattr(settings, "openrouter_api_key", "", raising=False)
    result = await route_chat(_req("anthropic/claude-sonnet-4.6"))
    assert result.routed_to == "demo"
    assert result.fell_back is True
    assert result.demo is True


async def test_demo_model_routes_to_demo_without_fallback():
    result = await route_chat(_req("demo/voiceops-sim-1"))
    assert result.routed_to == "demo"
    assert result.fell_back is False


async def test_voice_options_expose_vercel_runtime(monkeypatch):
    from app.config import settings
    from app.routers.voice import _runtime_options

    monkeypatch.setattr(settings, "vercel_oidc_token", "", raising=False)
    monkeypatch.setattr(settings, "ai_gateway_api_key", "", raising=False)
    runtimes = {r.id: r for r in _runtime_options()}

    assert runtimes["livekit"].default is True
    assert runtimes["vercel"].label == "Vercel Voice"
    assert runtimes["vercel"].configured is False
    assert "VERCEL_OIDC_TOKEN or AI_GATEWAY_API_KEY" in runtimes["vercel"].missing_env
