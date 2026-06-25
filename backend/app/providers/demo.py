"""
Deterministic, offline LLM adapter, ported from `src/lib/providers/demo.ts`.
Given the same request it always returns the same response, latency, and token
usage — reproducible by reusing the ported `cyrb53` seed hash.
"""
from __future__ import annotations

from app.core.hash import cyrb53
from app.providers.registry import get_model
from app.schemas.providers import (
    ChatCompletionRequest,
    ChatCompletionResult,
    ProviderStatus,
    TokenUsage,
)

_CANNED = [
    "Acknowledged. I'll verify the member's active coverage and benefit tier before proceeding.",
    "Recording the reference number and confirming the claim's adjudication status now.",
    "I have the prior authorization on file; routing the remaining benefit details to the summary.",
    "Member eligibility is active. Capturing copay, deductible, and out-of-pocket accumulators.",
    "That field is missing from the payer record — flagging it and requesting clarification.",
    "Escalation criteria met. Preparing a structured hand-off packet for a human specialist.",
]


def _estimate_tokens(text: str) -> int:
    return max(1, round(len(text) / 4))


class DemoProvider:
    id = "demo"
    label = "Demo Engine"
    kind = "demo"

    def is_configured(self) -> bool:
        return True

    def status(self) -> ProviderStatus:
        return ProviderStatus(
            id=self.id,
            label=self.label,
            kind=self.kind,
            configured=True,
            missing_env=[],
            detail="Deterministic on-device engine. Always available, zero cost, no PHI egress.",
        )

    async def chat(self, req: ChatCompletionRequest) -> ChatCompletionResult:
        model = get_model(req.model)
        last_user = next((m for m in reversed(req.messages) if m.role == "user"), None)
        seed = cyrb53(f"{req.model}:{last_user.content if last_user else ''}")

        text = _CANNED[seed % len(_CANNED)]
        jitter = (seed % 140) - 70
        latency_ms = max(60, model.base_latency_ms + jitter)

        prompt_tokens = sum(_estimate_tokens(m.content) for m in req.messages)
        completion_tokens = _estimate_tokens(text)
        total_tokens = prompt_tokens + completion_tokens
        cost_usd = (prompt_tokens / 1000) * model.input_cost_per_1k + (completion_tokens / 1000) * model.output_cost_per_1k

        return ChatCompletionResult(
            text=text,
            model=req.model,
            provider_id="demo",
            latency_ms=latency_ms,
            usage=TokenUsage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, total_tokens=total_tokens),
            cost_usd=cost_usd,
            finish_reason="stop",
            demo=True,
        )


demo_provider = DemoProvider()
