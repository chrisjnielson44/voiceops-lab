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


async def test_route_falls_back_to_demo_when_unconfigured():
    # An OpenRouter model with no API key configured should fall back to demo.
    result = await route_chat(_req("anthropic/claude-sonnet-4.6"))
    assert result.routed_to == "demo"
    assert result.fell_back is True
    assert result.demo is True


async def test_demo_model_routes_to_demo_without_fallback():
    result = await route_chat(_req("demo/voiceops-sim-1"))
    assert result.routed_to == "demo"
    assert result.fell_back is False
