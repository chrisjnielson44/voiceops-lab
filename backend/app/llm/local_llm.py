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
import time
from dataclasses import dataclass
from typing import Any, TypedDict

import httpx

from app.config import settings


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


@dataclass
class LLMJsonResult:
    value: Any | None
    raw: str
    latency_ms: int
    completion_tokens: int


def _base_url() -> str:
    return settings.local_llm_base_url.rstrip("/")


def local_model_id() -> str:
    return settings.local_llm_model


def _api_key() -> str:
    return settings.local_llm_api_key


async def chat(
    messages: list[LLMMessage],
    *,
    temperature: float = 0.3,
    max_tokens: int = 256,
    abort: asyncio.Event | None = None,
) -> LLMResult:
    start = time.time()
    payload = {
        "model": local_model_id(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_api_key()}",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        request = asyncio.create_task(
            client.post(f"{_base_url()}/chat/completions", json=payload, headers=headers)
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
    return LLMResult(
        text=(choice.get("message") or {}).get("content") or "",
        latency_ms=round((time.time() - start) * 1000),
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
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
    abort: asyncio.Event | None = None,
) -> LLMJsonResult:
    """Chat that must return JSON; one repair attempt if the first parse fails."""
    first = await chat(messages, temperature=temperature, max_tokens=max_tokens, abort=abort)
    value = extract_json(first.text)
    if value is not None:
        return LLMJsonResult(value, first.text, first.latency_ms, first.completion_tokens)

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
        abort=abort,
    )
    value = extract_json(repair.text)
    return LLMJsonResult(
        value,
        repair.text,
        first.latency_ms + repair.latency_ms,
        first.completion_tokens + repair.completion_tokens,
    )


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
