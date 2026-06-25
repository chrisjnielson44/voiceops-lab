"""
Live-call contracts ported from `src/lib/agent/types.ts`. The `AgentEvent`
discriminated union is what streams over SSE; each event serializes to the same
camelCase shape the cockpit already consumes.
"""
from __future__ import annotations

from typing import Any, Literal

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


# --- SSE event envelope helpers ---------------------------------------------
# The TS union is a tagged object keyed by `kind`. We build the wire dicts
# directly in the run store so serialization stays a single, explicit path.

AgentEventKind = Literal[
    "status", "turn", "tool", "prediction", "audit", "metrics", "error", "done"
]


def status_event(status: CallStatus, phase: int, elapsed_ms: int) -> dict:
    return {"kind": "status", "status": status, "phase": phase, "elapsedMs": elapsed_ms}


def turn_event(turn: LiveTurn) -> dict:
    return {"kind": "turn", "turn": turn.to_wire()}


def tool_event(tool: LiveTool) -> dict:
    return {"kind": "tool", "tool": tool.to_wire()}


def prediction_event(prediction: PredictionSnapshot) -> dict:
    return {"kind": "prediction", "prediction": prediction.to_wire()}


def audit_event(event: AuditEvent) -> dict:
    return {"kind": "audit", "event": event.to_wire()}


def metrics_event(metrics: RunMetrics) -> dict:
    return {"kind": "metrics", "metrics": metrics.to_wire()}


def error_event(message: str) -> dict:
    return {"kind": "error", "message": message}


def done_event(outcome: Literal["completed", "escalated", "stopped"]) -> dict:
    return {"kind": "done", "outcome": outcome}
