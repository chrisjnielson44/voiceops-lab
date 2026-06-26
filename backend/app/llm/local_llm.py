"""
OpenAI-compatible client for the LOCAL model server (MLX LM on :8080, or any
compatible server such as Ollama on :11434). This is the real inference path —
every agent / payer / predictor turn goes through here. Ported from
`src/lib/agent/localLLM.ts`.

Cancellation: callers may pass an `asyncio.Event` as `abort`. The HTTP request
races against `abort.wait()`; if the run is stopped mid-inference the request is
cancelled and `LLMAborted` is raised — the orchestrator's analogue of an aborted
`AbortController.signal`.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Any, TypedDict

import httpx

from app.config import settings
from app.providers.registry import get_model


class LLMMessage(TypedDict):
    role: str
    content: str


class LLMAborted(Exception):
    """Raised when an in-flight inference is cancelled because the run was stopped."""


@dataclass
class LLMResult:
    text: str
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    # Chain-of-thought from a reasoning model (qwen3/gemma/deepseek …). Captured
    # from the OpenAI-compatible `reasoning`/`reasoning_content` field, or split
    # from an inline `<think>…</think>` block. Empty for non-reasoning models.
    reasoning: str = ""


@dataclass
class LLMJsonResult:
    value: Any | None
    raw: str
    latency_ms: int
    completion_tokens: int
    reasoning: str = ""


_THINK_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL | re.IGNORECASE)


def _split_think(text: str) -> tuple[str, str]:
    """Split an inline `<think>…</think>` block out of a completion. Returns
    (reasoning, answer). A no-op when the model exposes reasoning out-of-band."""
    if not text or "<think>" not in text.lower():
        return "", text
    m = _THINK_RE.search(text)
    if m:
        return m.group(1).strip(), (text[: m.start()] + text[m.end():]).strip()
    # Unclosed tag (truncated): everything after the open tag is reasoning.
    idx = text.lower().find("<think>")
    return text[idx + len("<think>"):].strip(), text[:idx].strip()


def _base_url() -> str:
    return settings.local_llm_base_url.rstrip("/")


def local_model_id() -> str:
    return settings.local_llm_model


def _api_key() -> str:
    return settings.local_llm_api_key


@dataclass
class _Endpoint:
    base_url: str
    api_key: str
    headers: dict[str, str]


def _resolve_endpoint(model_id: str | None) -> _Endpoint:
    """Pick which OpenAI-compatible server serves `model_id`.

    Hosted models (provider_id == "openrouter" in the registry) route to
    OpenRouter when OPENROUTER_API_KEY is set; everything else — the local MLX /
    Ollama models, and any unknown id — uses the local model server. This is what
    makes a hosted model selected in the cockpit actually run against OpenRouter
    instead of being sent to localhost with the wrong model name.
    """
    info = get_model(model_id) if model_id else None
    if info and info.provider_id == "openrouter":
        key = (settings.openrouter_api_key or "").strip()
        if key:
            base = (settings.openrouter_base_url or "").strip().rstrip("/") or "https://openrouter.ai/api/v1"
            return _Endpoint(
                base_url=base,
                api_key=key,
                headers={
                    "HTTP-Referer": settings.openrouter_site_url,
                    "X-Title": settings.openrouter_app_name,
                },
            )
    return _Endpoint(base_url=_base_url(), api_key=_api_key(), headers={})


async def chat(
    messages: list[LLMMessage],
    *,
    temperature: float = 0.3,
    max_tokens: int = 256,
    model: str | None = None,
    abort: asyncio.Event | None = None,
) -> LLMResult:
    start = time.time()
    resolved_model = model or local_model_id()
    endpoint = _resolve_endpoint(resolved_model)
    payload = {
        "model": resolved_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {endpoint.api_key}",
        **endpoint.headers,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        request = asyncio.create_task(
            client.post(f"{endpoint.base_url}/chat/completions", json=payload, headers=headers)
        )
        if abort is not None:
            abort_wait = asyncio.create_task(abort.wait())
            done, _pending = await asyncio.wait(
                {request, abort_wait}, return_when=asyncio.FIRST_COMPLETED
            )
            if abort_wait in done and request not in done:
                request.cancel()
                raise LLMAborted("run stopped during inference")
            abort_wait.cancel()
        res = await request

    if res.status_code >= 400:
        raise RuntimeError(f"Local LLM {res.status_code}: {res.text[:200]}")
    data = res.json()
    choice = (data.get("choices") or [{}])[0]
    usage = data.get("usage") or {}
    message = choice.get("message") or {}
    content = message.get("content") or ""
    # Reasoning models expose their chain-of-thought either out-of-band (Ollama's
    # OpenAI-compatible `reasoning` field) or inline as <think>…</think>.
    reasoning = (message.get("reasoning") or message.get("reasoning_content") or "").strip()
    if not reasoning:
        reasoning, content = _split_think(content)
    return LLMResult(
        text=content,
        latency_ms=round((time.time() - start) * 1000),
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        reasoning=reasoning,
    )


def extract_json(text: str) -> Any | None:
    """Extract the first balanced JSON object from a model response."""
    if not text:
        return None
    cleaned = text.replace("```json", "```").replace("```", "")
    start = cleaned.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(cleaned)):
        ch = cleaned[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(cleaned[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


async def chat_json(
    messages: list[LLMMessage],
    *,
    temperature: float = 0.3,
    max_tokens: int = 256,
    model: str | None = None,
    abort: asyncio.Event | None = None,
) -> LLMJsonResult:
    """Chat that must return JSON; one repair attempt if the first parse fails."""
    first = await chat(messages, temperature=temperature, max_tokens=max_tokens, model=model, abort=abort)
    value = extract_json(first.text)
    if value is not None:
        return LLMJsonResult(value, first.text, first.latency_ms, first.completion_tokens, first.reasoning)

    repair = await chat(
        [
            *messages,
            {"role": "assistant", "content": first.text},
            {
                "role": "user",
                "content": "Return ONLY valid minified JSON for the request above — no prose, no code fences.",
            },
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        model=model,
        abort=abort,
    )
    value = extract_json(repair.text)
    return LLMJsonResult(
        value,
        repair.text,
        first.latency_ms + repair.latency_ms,
        first.completion_tokens + repair.completion_tokens,
        first.reasoning or repair.reasoning,
    )


async def chat_stream(
    messages: list[LLMMessage],
    *,
    temperature: float = 0.3,
    max_tokens: int = 256,
    model: str | None = None,
    abort: asyncio.Event | None = None,
    on_delta=None,
) -> LLMJsonResult:
    """Streaming chat for the agent turn — surfaces the reasoning model's
    chain-of-thought token-by-token. `on_delta(reasoning_so_far, content_so_far)`
    is awaited as tokens arrive (the caller throttles SSE emits). Returns the
    parsed JSON action once the stream completes."""
    start = time.time()
    resolved_model = model or local_model_id()
    endpoint = _resolve_endpoint(resolved_model)
    payload = {
        "model": resolved_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {endpoint.api_key}", **endpoint.headers}
    reasoning = ""
    content = ""
    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0)) as client:
        async with client.stream("POST", f"{endpoint.base_url}/chat/completions", json=payload, headers=headers) as res:
            if res.status_code >= 400:
                body = await res.aread()
                raise RuntimeError(f"Local LLM {res.status_code}: {body[:200]!r}")
            async for line in res.aiter_lines():
                if abort is not None and abort.is_set():
                    raise LLMAborted("run stopped during inference")
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choice = (obj.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                rc = delta.get("reasoning") or delta.get("reasoning_content")
                c = delta.get("content")
                changed = False
                if rc:
                    reasoning += rc
                    changed = True
                if c:
                    content += c
                    changed = True
                if changed and on_delta is not None:
                    await on_delta(reasoning, content)
    if not reasoning:
        reasoning, content = _split_think(content)
    value = extract_json(content)
    completion_tokens = max(1, (len(content) + len(reasoning)) // 4)
    return LLMJsonResult(value, content, round((time.time() - start) * 1000), completion_tokens, reasoning)


async def local_llm_health() -> dict[str, Any]:
    """Quick reachability probe for the local server."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(2.5)) as client:
            res = await client.get(
                f"{_base_url()}/models",
                headers={"Authorization": f"Bearer {_api_key()}"},
            )
        ok = res.status_code < 400
        return {
            "ok": ok,
            "model": local_model_id(),
            "detail": "reachable" if ok else f"HTTP {res.status_code}",
        }
    except Exception as e:  # noqa: BLE001 - report any reachability failure
        return {"ok": False, "model": local_model_id(), "detail": str(e) or "unreachable"}
