"""Audit-ledger contracts, ported from `src/lib/audit/types.ts`."""
from __future__ import annotations

from typing import Literal

from app.schemas import CamelModel

AuditEventType = Literal[
    "call.session.open",
    "call.start",
    "model.invoke",
    "tool.call",
    "phi.access",
    "context.retrieve",
    "prediction.update",
    "compliance.flag",
    "call.escalate",
    "call.complete",
]
AuditActor = Literal["agent", "payer", "system", "operator"]
Redaction = Literal["none", "redacted", "tokenized"]
ToolStatus = Literal["ok", "warn", "error"]


class AuditEvent(CamelModel):
    seq: int
    id: str
    type: AuditEventType
    at_ms: int
    clock: str
    actor: AuditActor
    summary: str
    model: str | None = None
    prompt_version: str | None = None
    tool: str | None = None
    tool_status: ToolStatus | None = None
    phi: bool
    phi_scope: str | None = None
    redaction: Redaction
    hash: str
    prev_hash: str
