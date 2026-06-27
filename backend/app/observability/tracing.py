"""
Langfuse tracing facade.

The rest of the codebase never imports `langfuse` directly — it calls the helpers
here. That keeps two promises:

  * **No-op when unconfigured.** Without LANGFUSE_PUBLIC_KEY / SECRET_KEY the
    helpers yield inert handles and never import or hit Langfuse, so the
    local-first runtime still works fully offline. (Langfuse is self-hostable, so
    "configured" can still mean a box on your LAN.)
  * **Version churn is contained here.** Langfuse's SDK surface moves between
    majors (v3 → v4 renamed span/generation creation to a unified
    `start_as_current_observation`); only this file tracks it.

Nesting is automatic: Langfuse v4 is OpenTelemetry-based, so any observation
created while a `run_trace()` / `observation()` block is active on the same task
becomes its child via context propagation — we never thread a parent handle
around. A run is one trace; each inference is a `generation`; each tool call and
graph node is a `span`.
"""
from __future__ import annotations

import contextlib
import logging
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)

# Lazily-initialised singleton. `False` once we've decided tracing is off so we
# never re-attempt; the real client otherwise.
_client: Any = None
_init_done = False


def _get_client():
    global _client, _init_done
    if _init_done:
        return _client
    _init_done = True
    if not settings.langfuse_enabled:
        _client = None
        return None
    try:
        from langfuse import Langfuse, get_client

        # Construct once with our settings; get_client() then returns the same
        # singleton for any auto-instrumentation that looks it up.
        Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
        _client = get_client()
        log.info("langfuse tracing enabled (host=%s)", settings.langfuse_host)
    except Exception as err:  # noqa: BLE001 - tracing must never break the app
        log.warning("langfuse init failed, tracing disabled: %s", err)
        _client = None
    return _client


def is_enabled() -> bool:
    return _get_client() is not None


class _NullObs:
    """Inert observation handle used when tracing is disabled or errored — so
    callers can unconditionally `obs.update(...)` / `obs.score(...)`."""

    def update(self, **_kw: Any) -> None:  # noqa: D401
        pass

    def score(self, **_kw: Any) -> None:
        pass


_NULL = _NullObs()


@contextlib.contextmanager
def run_trace(*, run_id: str, scenario_id: str, model: str, user_id: str | None, engine: str):
    """Open the per-call root span (one Langfuse trace per run). Session id is the
    run id so the whole call groups together; tags carry scenario + engine so runs
    are filterable in the Langfuse UI."""
    client = _get_client()
    if client is None:
        yield _NULL
        return
    try:
        from langfuse import propagate_attributes

        attrs = propagate_attributes(
            trace_name="voiceops.call",
            session_id=run_id,
            user_id=user_id or "anonymous",
            tags=[f"scenario:{scenario_id}", f"engine:{engine}"],
            metadata={"model": model, "prompt_version": settings.voiceops_prompt_version},
        )
    except Exception:  # noqa: BLE001 - older/newer SDKs may lack it
        attrs = contextlib.nullcontext()
    try:
        with attrs:
            with client.start_as_current_observation(
                name="voiceops.call",
                as_type="span",
                input={"scenario_id": scenario_id, "model": model},
            ) as root:
                yield root
    except Exception as err:  # noqa: BLE001
        log.debug("langfuse run_trace error: %s", err)
        yield _NULL


@contextlib.contextmanager
def observation(name: str, *, as_type: str = "span", **kwargs: Any):
    """Open a child observation (span / generation / tool / agent). Yields the
    handle so the caller can `.update(output=..., usage_details=...)`. Inert and
    exception-safe when tracing is off."""
    client = _get_client()
    if client is None:
        yield _NULL
        return
    try:
        with client.start_as_current_observation(name=name, as_type=as_type, **kwargs) as obs:
            yield obs
    except Exception as err:  # noqa: BLE001 - never let tracing break a call
        log.debug("langfuse observation(%s) error: %s", name, err)
        yield _NULL


def score_current_trace(*, name: str, value: float, comment: str | None = None) -> None:
    """Attach a numeric score (prediction hit-rate, completion prob, …) to the
    current run trace. No-op when disabled."""
    client = _get_client()
    if client is None:
        return
    try:
        client.score_current_trace(name=name, value=value, comment=comment)
    except Exception as err:  # noqa: BLE001
        log.debug("langfuse score error: %s", err)


def flush() -> None:
    """Force-export buffered spans. Call at the end of a run — Langfuse batches in
    the background and a short-lived task could otherwise drop its tail."""
    client = _get_client()
    if client is None:
        return
    try:
        client.flush()
    except Exception as err:  # noqa: BLE001
        log.debug("langfuse flush error: %s", err)
