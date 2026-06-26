"""
Live-call contracts ported from `src/lib/agent/types.ts`. The `AgentEvent`
discriminated union is what streams over SSE; each event serializes to the same
camelCase shape the cockpit already consumes.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas import CamelModel
from app.schemas.audit import AuditEvent
from app.schemas.simulation import CallStatus, PredictionSnapshot, Speaker, ToolStatus


class LiveTurn(CamelModel):
    id: str
    seq: int
    speaker: Speaker
    text: str
    at_ms: int
    latency_ms: int | None = None
    # How many verified records the context graph fed into this turn, and how many
    # of those were pre-loaded by anticipation (folded/warmed for the likely next
    # ask). Surfaced as chips on the agent turn. None on payer/ungrounded turns.
    grounded: int | None = None
    anticipated: int | None = None


class LiveTool(CamelModel):
    id: str
    seq: int
    tool: str
    args: dict[str, Any]
    result: str
    status: ToolStatus
    latency_ms: int
    phi: bool
    at_ms: int
    # Anticipatory prefetch: set when this tool's result was served from the
    # speculative cache instead of run live, with the latency it avoided.
    prefetch_hit: bool = False
    saved_ms: int | None = None


class RunMetrics(CamelModel):
    inferences: int = 0
    tool_calls: int = 0
    phi_accesses: int = 0
    tool_errors: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    avg_latency_ms: int = 0


# --- Model decision shapes (parsed from LLM JSON) ---------------------------


class AgentDecision(CamelModel):
    action: Literal["tool", "speak", "end"]
    tool: str | None = None
    args: dict[str, Any] | None = None
    text: str | None = None
    outcome: Literal["completed", "escalated"] | None = None
    summary: str | None = None


class PayerReply(CamelModel):
    text: str
    ends: bool | None = False
    escalate: bool | None = False


# --- Context graph (GraphRAG-lite) ------------------------------------------


class GraphNode(CamelModel):
    """A node in the context graph. `id` is "type:natural_key". `attrs` MUST be
    JSON-safe (strings/numbers/bools only) since events are json.dumps'd to SSE."""

    id: str
    type: str  # member | coverage | plan | claim | auth | provider | payer | carc
    label: str
    score: float = 0.0
    lit: bool = False  # part of the current per-turn retrieved subgraph
    seed: bool = False  # was a retrieval seed (directly mentioned / known)
    hops: int | None = None  # hops from the nearest seed (None on the full backdrop)
    attrs: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(CamelModel):
    source: str
    target: str
    label: str
    weight: float = 1.0
    lit: bool = False


class Subgraph(CamelModel):
    """Full graph backdrop + the lit per-turn retrieval. `context` is the
    serialized fact block injected into the agent prompt (for inspection)."""

    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    seeds: list[str] = Field(default_factory=list)
    context: str = ""
    hops: int = 2


# --- Anticipatory prediction + prefetch -------------------------------------


class PredictedEntity(CamelModel):
    type: str
    id: str


class Prediction(CamelModel):
    """One forecast of the next exchange. `needs_tool` (when a known tool) drives
    speculative prefetch; runtime fields below are filled as prefetch resolves."""

    intent: str
    utterance: str
    confidence: float
    entities: list[PredictedEntity] = Field(default_factory=list)
    needs_tool: str | None = None
    draft_worth: bool = False
    # runtime-filled
    prefetch_status: str | None = None  # prefetching | ready | stale | evicted
    saved_ms: int | None = None
    hit: bool = False
    draft: str | None = None


class PredictionSet(CamelModel):
    predictions: list[Prediction] = Field(default_factory=list)
    generated_at_ms: int = 0
    model_ms: int = 0
    hit_rate: float = 0.0
    avg_saved_ms: int = 0
    wasted: int = 0
    predicted_count: int = 0


class PrefetchRecord(CamelModel):
    key: str
    kind: str  # subgraph | tool | draft
    status: str  # prefetching | ready | stale | evicted | hit
    intent: str | None = None
    label: str | None = None
    saved_ms: int | None = None


# --- Reasoning trace (the agent thinking out loud, per turn) -----------------


class ReasoningSegment(CamelModel):
    """One phase of an agent turn's reasoning. `retrieve` narrates the context-
    graph walk, `think` carries the reasoning model's chain-of-thought, and
    `anticipate` narrates which predictions were weighed / prefetched."""

    phase: Literal["retrieve", "think", "anticipate"]
    title: str
    text: str = ""
    # retrieve: the lit nodes walked (id/type/label/hops/seed)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    # anticipate: the weighed candidates (intent/utterance/confidence/warmed)
    predictions: list[dict[str, Any]] = Field(default_factory=list)


class LiveReasoning(CamelModel):
    """The reasoning trace shown inline above an agent turn. `seq` matches the
    turn/tool seq it precedes so an append-only client can group it correctly.
    Streamed: the client upserts by `id`, growing the trace live; `streaming`
    flips false on completion and `duration_ms` records the think time."""

    id: str
    seq: int
    at_ms: int
    model: str | None = None
    segments: list[ReasoningSegment] = Field(default_factory=list)
    streaming: bool = False
    duration_ms: int | None = None


# --- SSE event envelope helpers ---------------------------------------------
# The TS union is a tagged object keyed by `kind`. We build the wire dicts
# directly in the run store so serialization stays a single, explicit path.

AgentEventKind = Literal[
    "status",
    "turn",
    "tool",
    "reasoning",
    "prediction",
    "predictionSet",
    "prefetch",
    "graph",
    "audit",
    "metrics",
    "error",
    "done",
]


def status_event(status: CallStatus, phase: int, elapsed_ms: int) -> dict:
    return {"kind": "status", "status": status, "phase": phase, "elapsedMs": elapsed_ms}


def turn_event(turn: LiveTurn) -> dict:
    return {"kind": "turn", "turn": turn.to_wire()}


def tool_event(tool: LiveTool) -> dict:
    return {"kind": "tool", "tool": tool.to_wire()}


def reasoning_event(reasoning: LiveReasoning) -> dict:
    return {"kind": "reasoning", "reasoning": reasoning.to_wire()}


def prediction_event(prediction: PredictionSnapshot) -> dict:
    return {"kind": "prediction", "prediction": prediction.to_wire()}


def graph_event(subgraph: Subgraph) -> dict:
    return {"kind": "graph", "subgraph": subgraph.to_wire()}


def prediction_set_event(prediction_set: PredictionSet) -> dict:
    return {"kind": "predictionSet", "predictionSet": prediction_set.to_wire()}


def prefetch_event(record: PrefetchRecord) -> dict:
    return {"kind": "prefetch", "record": record.to_wire()}


def audit_event(event: AuditEvent) -> dict:
    return {"kind": "audit", "event": event.to_wire()}


def metrics_event(metrics: RunMetrics) -> dict:
    return {"kind": "metrics", "metrics": metrics.to_wire()}


def error_event(message: str) -> dict:
    return {"kind": "error", "message": message}


def await_event(awaiting: bool, role: str = "payer") -> dict:
    """Signals the UI that the loop is paused for a human turn (text role-play:
    the agent leads, the human plays the counterparty)."""
    return {"kind": "await", "awaiting": awaiting, "role": role}


def done_event(outcome: Literal["completed", "escalated", "stopped"]) -> dict:
    return {"kind": "done", "outcome": outcome}
