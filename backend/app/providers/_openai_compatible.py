"""
Shared OpenAI-compatible chat helper for the MLX (local) and OpenRouter (hosted)
adapters — both expose the same `/chat/completions` shape, so a single client
function backs both, exactly as the TS adapters mirror each other.
"""
from __future__ import annotations

import time

import httpx

from app.providers.registry import get_model
from app.schemas.providers import ChatCompletionRequest, ChatCompletionResult, TokenUsage


def _error(model: str, provider_id: str, latency_ms: int, message: str) -> ChatCompletionResult:
    return ChatCompletionResult(
        text="",
        model=model,
        provider_id=provider_id,
        latency_ms=latency_ms,
        usage=TokenUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0),
        cost_usd=0,
        finish_reason="error",
        demo=False,
        error=message,
    )


async def openai_chat(
    req: ChatCompletionRequest,
    *,
    provider_id: str,
    base_url: str,
    api_key: str,
    extra_headers: dict[str, str] | None = None,
) -> ChatCompletionResult:
    model = get_model(req.model)
    started = time.time()
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}", **(extra_headers or {})}
    payload = {
        "model": req.model,
        "messages": [m.model_dump(exclude_none=True) for m in req.messages],
        "temperature": req.temperature if req.temperature is not None else 0.2,
        "max_tokens": req.max_tokens if req.max_tokens is not None else 512,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            res = await client.post(f"{base_url.rstrip('/')}/chat/completions", json=payload, headers=headers)
        latency_ms = round((time.time() - started) * 1000)
        if res.status_code >= 400:
            return _error(req.model, provider_id, latency_ms, f"{provider_id} {res.status_code}: {res.text[:280]}")
        data = res.json()
        choice = (data.get("choices") or [{}])[0]
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        total_tokens = usage.get("total_tokens", prompt_tokens + completion_tokens)
        cost_usd = (prompt_tokens / 1000) * model.input_cost_per_1k + (completion_tokens / 1000) * model.output_cost_per_1k
        return ChatCompletionResult(
            text=(choice.get("message") or {}).get("content") or "",
            model=req.model,
            provider_id=provider_id,
            latency_ms=latency_ms,
            usage=TokenUsage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, total_tokens=total_tokens),
            cost_usd=cost_usd,
            finish_reason="stop",
            demo=False,
        )
    except Exception as err:  # noqa: BLE001
        return _error(req.model, provider_id, round((time.time() - started) * 1000), str(err) or f"Unknown {provider_id} error")
