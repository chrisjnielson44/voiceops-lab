"""Provider protocol — every adapter implements the same OpenAI-shaped contract."""
from __future__ import annotations

from typing import Protocol

from app.schemas.providers import ChatCompletionRequest, ChatCompletionResult, ProviderStatus


class LLMProvider(Protocol):
    id: str
    label: str
    kind: str

    def is_configured(self) -> bool: ...

    def status(self) -> ProviderStatus: ...

    async def chat(self, req: ChatCompletionRequest) -> ChatCompletionResult: ...
