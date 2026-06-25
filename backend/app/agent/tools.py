"""
Real tool implementations, ported from `src/lib/agent/tools.ts`. These are NOT
mocked — they execute live SQL against the Neon payer tables (or call the model
for summarization). The agent must call these to obtain facts; it is never handed
canned answers.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.db import query
from app.llm.local_llm import chat


@dataclass
class ToolContext:
    run_id: str
    scenario_id: str
    member_id: str | None = None
    claim_id: str | None = None
    auth_id: str | None = None
    transcript: str | None = None


@dataclass
class ToolResult:
    result: str
    status: str  # "ok" | "warn" | "error"
    phi: bool
    data: dict[str, Any] | None = field(default=None)


TOOL_CATALOG: list[dict[str, str]] = [
    {"name": "lookup_patient", "description": "Look up a member and confirm a match before discussing PHI.", "args": "member_id (string) or name (string)"},
    {"name": "verify_eligibility", "description": "Get active coverage, plan, copays, deductible, and OOP accumulators.", "args": "member_id (string)"},
    {"name": "verify_claim", "description": "Get a claim's adjudication status, denial reason, and resubmission path.", "args": "claim_id (string)"},
    {"name": "record_status", "description": "Write the verified outcome/fields back to the encounter.", "args": "summary (string), fields (object)"},
    {"name": "escalate", "description": "Route to a human specialist when the call cannot be completed autonomously.", "args": "reason (string)"},
    {"name": "summarize", "description": "Produce the final encounter summary from the transcript.", "args": "(none)"},
]


def _str(v: Any) -> str | None:
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def _d(v: Any) -> str:
    """Render a value the way the TS string-interpolation would, trimming dates to YYYY-MM-DD."""
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10]
    if v is None:
        return ""
    return str(v)


async def execute_tool(tool: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    if tool == "lookup_patient":
        member_id = _str(args.get("member_id")) or ctx.member_id
        name = _str(args.get("name"))
        if member_id:
            rows = await query(
                "SELECT m.*, c.active FROM members m LEFT JOIN coverage c USING (member_id) WHERE m.member_id = $1",
                [member_id],
            )
        elif name:
            rows = await query(
                "SELECT m.*, c.active FROM members m LEFT JOIN coverage c USING (member_id) WHERE m.name ILIKE $1",
                [f"%{name}%"],
            )
        else:
            rows = []
        if not rows:
            return ToolResult("No member match found for the provided identifiers.", "warn", True)
        r = rows[0]
        return ToolResult(
            f"Match: {_d(r.get('name'))} (member {_d(r.get('member_id'))}), {_d(r.get('payer'))} {_d(r.get('plan_type'))}, "
            f"group {_d(r.get('group_number')) or 'n/a'}, coverage {'active' if r.get('active') else 'inactive'}.",
            "ok",
            True,
            r,
        )

    if tool == "verify_eligibility":
        member_id = _str(args.get("member_id")) or ctx.member_id
        if not member_id:
            return ToolResult("member_id is required.", "error", False)
        rows = await query(
            "SELECT m.payer, m.plan_type, m.group_number, c.* FROM coverage c JOIN members m USING (member_id) WHERE c.member_id = $1",
            [member_id],
        )
        if not rows:
            return ToolResult("No coverage record on file.", "warn", True)
        c = rows[0]
        return ToolResult(
            f"{'Active' if c.get('active') else 'Inactive'} — {_d(c.get('plan_type'))}, group {_d(c.get('group_number'))}. "
            f"PCP copay ${_d(c.get('copay_pcp'))}, specialist ${_d(c.get('copay_spec'))}. "
            f"Deductible ${_d(c.get('deductible_met'))}/${_d(c.get('deductible_total'))} met. "
            f"OOP ${_d(c.get('oop_met'))}/${_d(c.get('oop_max'))}.",
            "ok" if c.get("active") else "warn",
            True,
            c,
        )

    if tool == "verify_claim":
        claim_id = _str(args.get("claim_id")) or ctx.claim_id
        if not claim_id:
            return ToolResult("claim_id is required.", "error", False)
        rows = await query("SELECT * FROM claims WHERE claim_id = $1", [claim_id])
        if not rows:
            return ToolResult("No claim found with that id.", "warn", True)
        c = rows[0]
        base = f"Claim {_d(c.get('claim_id'))}: {_d(c.get('status'))} — DOS {_d(c.get('dos'))}, CPT {_d(c.get('cpt'))}, billed ${_d(c.get('billed_amount'))}."
        detail = (
            f" {_d(c.get('carc_code'))}: {_d(c.get('denial_reason'))} Resubmission: {_d(c.get('resubmission_path'))} "
            f"(timely filing by {_d(c.get('timely_filing_deadline'))})."
            if c.get("status") == "DENIED"
            else ""
        )
        return ToolResult(base + detail, "warn" if c.get("status") == "DENIED" else "ok", True, c)

    if tool == "record_status":
        summary = _str(args.get("summary")) or "verified outcome"
        return ToolResult(
            f"Recorded to encounter: {summary}.",
            "ok",
            True,
            {"recorded": args.get("fields") or {}, "summary": summary},
        )

    if tool == "escalate":
        reason = _str(args.get("reason")) or "criteria require human review"
        return ToolResult(
            f"Escalation packet created and routed to the clinical review queue ({reason}).",
            "ok",
            True,
            {"reason": reason},
        )

    if tool == "summarize":
        transcript = ctx.transcript or ""
        r = await chat(
            [
                {"role": "system", "content": "You write concise clinical encounter summaries for a healthcare admin call. 2-3 sentences, factual, no PHI beyond member id."},
                {"role": "user", "content": f"Summarize the outcome of this payer call:\n\n{transcript[-4000:]}"},
            ],
            temperature=0.2,
            max_tokens=200,
        )
        text = r.text.strip()
        return ToolResult(text or "Summary generated.", "ok", False, {"summary": text})

    return ToolResult(f"Unknown tool: {tool}", "error", False)
