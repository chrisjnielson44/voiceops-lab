"""
In-memory registry of active call runs — the asyncio analogue of
`src/lib/agent/runStore.ts`. A module-level dict holds each run; every run
buffers its full event log so a late-joining SSE client can replay, and fans new
events out to a set of per-subscriber `asyncio.Queue`s.

Single-instance only (a demo/dev server), exactly like the Node original. Pause/
stop are cooperative flags; `abort` is an `asyncio.Event` that in-flight LLM
calls race against so a stop interrupts inference promptly.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from app.core.format import now_ms

# Sentinel pushed into subscriber queues to signal "no more events".
STREAM_END = object()


@dataclass
class RunState:
    id: str
    scenario_id: str
    model: str
    user_id: str | None = None
    status: str = "dialing"
    events: list[dict] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    paused: bool = False
    stopped: bool = False
    done: bool = False
    # True for out-of-process LiveKit voice runs fed via the ingest bridge (no
    # in-process orchestrator task); used so the SSE endpoint can attach to a
    # run it didn't start.
    live: bool = False
    # Text role-play: the agent leads and a human plays the counterparty. The
    # orchestrator awaits `payer_inbox` for the human's reply instead of running
    # the payer model. Fed by POST /api/agent/say.
    human_payer: bool = False
    payer_inbox: asyncio.Queue = field(default_factory=asyncio.Queue)
    # Approvals for sensitive-tool interrupts (langgraph engine HITL). Fed by
    # POST /api/agent/approve; the graph driver resumes the interrupt with the
    # decision. Each item is {"approved": bool, "args": dict | None}.
    approval_inbox: asyncio.Queue = field(default_factory=asyncio.Queue)
    started_at: float = field(default_factory=now_ms)
    abort: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    # Context graph + anticipatory prefetch state (set by the orchestrator).
    graph: Any = None  # app.agent.context_graph.ContextGraph | None
    last_lit_sig: str | None = None
    # Node ids surfaced so far (seeded/lit/widened). The emitted graph grows as
    # the call proceeds — it shows only what the agent has discovered, not the
    # full backdrop up front.
    discovered: set[str] = field(default_factory=set)
    prefetch_cache: dict[str, dict] = field(default_factory=dict)
    pred_task: asyncio.Task | None = None
    # Last anticipatory PredictionSet, kept so the next turn's reasoning trace can
    # narrate which predictions the agent had weighed/prefetched.
    last_pred_set: Any = None
    pred_stats: dict[str, int] = field(default_factory=lambda: {"hits": 0, "misses": 0, "savedMs": 0, "wasted": 0})


_runs: dict[str, RunState] = {}


def create_run(
    *, id: str, scenario_id: str, model: str, user_id: str | None = None, human_payer: bool = False
) -> RunState:
    run = RunState(id=id, scenario_id=scenario_id, model=model, user_id=user_id, human_payer=human_payer)
    _runs[id] = run
    # Evict old finished runs to bound memory.
    if len(_runs) > 50:
        for rid, r in list(_runs.items()):
            if r.done and len(_runs) > 50:
                del _runs[rid]
    return run


def get_run(run_id: str) -> RunState | None:
    return _runs.get(run_id)


def emit(run: RunState, event: dict) -> None:
    run.events.append(event)
    if event.get("kind") == "status":
        run.status = event["status"]
    for q in list(run.subscribers):
        try:
            q.put_nowait(event)
        except Exception:  # noqa: BLE001 - a full/closed subscriber queue is ignorable
            pass


def subscribe(run: RunState) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    run.subscribers.add(q)
    return q


def unsubscribe(run: RunState, q: asyncio.Queue) -> None:
    run.subscribers.discard(q)


def close_subscribers(run: RunState) -> None:
    for q in list(run.subscribers):
        try:
            q.put_nowait(STREAM_END)
        except Exception:  # noqa: BLE001
            pass
