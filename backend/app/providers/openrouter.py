"""OpenRouter adapter (hosted), ported from `src/lib/providers/openrouter.ts`."""
from __future__ import annotations

from app.config import settings
from app.providers._openai_compatible import openai_chat
from app.schemas.providers import ChatCompletionRequest, ChatCompletionResult, ProviderStatus, TokenUsage


def _api_key() -> str | None:
    return (settings.openrouter_api_key or "").strip() or None


def _base_url() -> str:
    return (settings.openrouter_base_url or "").strip() or "https://openrouter.ai/api/v1"


class OpenRouterProvider:
    id = "openrouter"
    label = "OpenRouter"
    kind = "hosted"

    def is_configured(self) -> bool:
        return bool(_api_key())

    def status(self) -> ProviderStatus:
        configured = self.is_configured()
        return ProviderStatus(
            id=self.id,
            label=self.label,
            kind=self.kind,
            configured=configured,
            base_url=_base_url(),
            missing_env=[] if configured else ["OPENROUTER_API_KEY"],
            detail="Live. Hosted models routed through OpenRouter."
            if configured
            else "Stub. Set OPENROUTER_API_KEY to route real hosted completions.",
        )

    async def chat(self, req: ChatCompletionRequest) -> ChatCompletionResult:
        key = _api_key()
        if not key:
            return ChatCompletionResult(
                text="", model=req.model, provider_id="openrouter", latency_ms=0,
                usage=TokenUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0),
                cost_usd=0, finish_reason="error", demo=False, error="OPENROUTER_API_KEY not configured",
            )
        return await openai_chat(
            req,
            provider_id="openrouter",
            base_url=_base_url(),
            api_key=key,
            extra_headers={
                "HTTP-Referer": settings.openrouter_site_url,
                "X-Title": settings.openrouter_app_name,
            },
        )


openrouter_provider = OpenRouterProvider()
