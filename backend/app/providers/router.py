"""
Provider router, ported from `src/lib/providers/index.ts`. Picks the provider
that owns the requested model; if it is not configured (no key / no local
server) it transparently falls back to the deterministic demo engine so the
platform is never hard-down. The result's `demo`/`fell_back` flags signal which
path was taken.
"""
from __future__ import annotations

from app.providers.demo import demo_provider
from app.providers.mlx import mlx_provider
from app.providers.openrouter import openrouter_provider
from app.providers.registry import get_model
from app.schemas.providers import ChatCompletionRequest, ChatCompletionResult, ProviderStatus

_PROVIDERS = {"demo": demo_provider, "openrouter": openrouter_provider, "mlx": mlx_provider}


def get_provider(provider_id: str):
    return _PROVIDERS[provider_id]


def get_all_provider_statuses() -> list[ProviderStatus]:
    return [p.status() for p in _PROVIDERS.values()]


async def route_chat(req: ChatCompletionRequest) -> ChatCompletionResult:
    model = get_model(req.model)
    target = get_provider(model.provider_id)

    if target.is_configured():
        result = await target.chat(req)
        if result.finish_reason != "error":
            result.routed_to = model.provider_id
            result.fell_back = False
            return result
        fb = await demo_provider.chat(req)
        fb.routed_to = "demo"
        fb.fell_back = True
        fb.error = result.error
        return fb

    fb = await demo_provider.chat(req)
    fb.routed_to = "demo"
    fb.fell_back = True
    return fb
