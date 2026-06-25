"""MLX LM adapter (local, on-device), ported from `src/lib/providers/mlx.ts`."""
from __future__ import annotations

from app.config import settings
from app.providers._openai_compatible import openai_chat
from app.schemas.providers import ChatCompletionRequest, ChatCompletionResult, ProviderStatus, TokenUsage


def _base_url() -> str | None:
    return (settings.mlx_base_url or "").strip() or None


class MlxProvider:
    id = "mlx"
    label = "MLX LM (local)"
    kind = "local"

    def is_configured(self) -> bool:
        return bool(_base_url())

    def status(self) -> ProviderStatus:
        configured = self.is_configured()
        return ProviderStatus(
            id=self.id,
            label=self.label,
            kind=self.kind,
            configured=configured,
            base_url=_base_url() or "http://localhost:8080/v1",
            missing_env=[] if configured else ["MLX_BASE_URL"],
            detail="Live. Local OpenAI-compatible server; PHI stays on-device."
            if configured
            else "Stub. Set MLX_BASE_URL (e.g. http://localhost:8080/v1) to use a local model.",
        )

    async def chat(self, req: ChatCompletionRequest) -> ChatCompletionResult:
        url = _base_url()
        if not url:
            return ChatCompletionResult(
                text="", model=req.model, provider_id="mlx", latency_ms=0,
                usage=TokenUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0),
                cost_usd=0, finish_reason="error", demo=False, error="MLX_BASE_URL not configured",
            )
        return await openai_chat(req, provider_id="mlx", base_url=url, api_key=(settings.mlx_api_key or "mlx-local").strip())


mlx_provider = MlxProvider()
