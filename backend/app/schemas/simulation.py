"""Scenario + prediction contracts, ported from `src/lib/simulation/types.ts`."""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas import CamelModel

CallStatus = Literal["idle", "dialing", "active", "paused", "completed", "escalated"]
Speaker = Literal["agent", "payer", "ivr", "system"]
ToolName = Literal[
    "lookup_patient",
    "verify_eligibility",
    "verify_claim",
    "verify_auth",
    "record_status",
    "note_fact",
    "escalate",
    "summarize",
    "investigate",
]
ToolStatus = Literal["ok", "warn", "error"]
# Healthcare uses these three; generic/custom domain packs may use any
# kebab-case label (e.g. "card-dispute", "billing"), so this is a free string.
ScenarioCategory = str
ScenarioDifficulty = Literal["routine", "moderate", "complex"]
ScenarioOutcome = Literal["completed", "escalated"]


class Patient(CamelModel):
    name: str
    member_id: str
    dob: str


class Provider(CamelModel):
    name: str
    npi: str
    tax_id: str


class Claim(CamelModel):
    id: str
    dos: str
    amount: float
    cpt: str


class ToolInvocation(CamelModel):
    tool: ToolName
    label: str
    args: dict[str, str]
    result: str
    status: ToolStatus
    latency_ms: int
    phi: bool


class PredictionHint(CamelModel):
    completion_probability: float | None = None
    escalation_risk: float | None = None
    rationale: str | None = None


class TranscriptTurn(CamelModel):
    id: str
    index: int
    at_ms: int
    end_ms: int
    speaker: Speaker
    text: str
    duration_ms: int
    tool: ToolInvocation | None = None
    forecast: str | None = None
    forecast_confidence: float | None = None
    predict: PredictionHint | None = None
    satisfies: list[str] | None = None
    phi: bool | None = None
    compliance: str | None = None
    intent: str | None = None


class Scenario(CamelModel):
    id: str
    title: str
    payer: str
    payer_id: str
    category: ScenarioCategory
    difficulty: ScenarioDifficulty
    outcome: ScenarioOutcome
    objective: str
    patient: Patient
    provider: Provider
    claim: Claim | None = None
    baseline_completion_prob: float
    baseline_escalation_risk: float
    required_fields: list[str]
    connect_ms: int
    # Self-contained ground truth for non-DB-backed scenarios (generic domain
    # packs + user-created custom scenarios). The counterparty model answers
    # ONLY from this text when there are no authoritative DB rows. Healthcare's
    # seeded scenarios leave this null and load ground truth from Neon instead.
    facts: str | None = None
    turns: list[TranscriptTurn] = Field(default_factory=list)
    total_duration_ms: int = 0


class PredictionSnapshot(CamelModel):
    next_payer_response: str
    next_response_confidence: float
    completion_probability: float
    escalation_risk: float
    est_remaining_ms: int
    missing_fields: list[str]
    rationale: str
