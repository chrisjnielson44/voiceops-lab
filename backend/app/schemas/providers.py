"""Provider-routing contracts ported from `src/lib/providers/types.ts`."""
from __future__ import annotations

from typing import Any, Literal

from app.schemas import CamelModel

ProviderId = Literal["openrouter", "mlx", "demo"]
ProviderKind = Literal["hosted", "local", "demo"]
ChatRole = Literal["system", "user", "assistant", "tool"]
FinishReason = Literal["stop", "length", "tool_calls", "error"]


class ChatMessage(CamelModel):
    role: ChatRole
    content: str
    name: str | None = None


class ChatCompletionRequest(CamelModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = None
    tools: list[dict[str, Any]] | None = None


class TokenUsage(CamelModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResult(CamelModel):
    text: str
    model: str
    provider_id: ProviderId
    latency_ms: int
    usage: TokenUsage
    cost_usd: float
    finish_reason: FinishReason
    demo: bool
    error: str | None = None
    # set by the router
    routed_to: ProviderId | None = None
    fell_back: bool | None = None


class ProviderStatus(CamelModel):
    id: ProviderId
    label: str
    kind: ProviderKind
    configured: bool
    base_url: str | None = None
    missing_env: list[str]
    detail: str
