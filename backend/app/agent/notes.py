"""
Deterministic extraction of conversational facts worth remembering — the rep's
name, a reference/confirmation/ticket/case number — so the context graph captures
what's actually SAID on the call, not just the FK-derived DB records. Pure regex
(no LLM, no PHI inference): high-precision patterns only, so we add a `note:` node
when the conversation clearly surfaces one. The agent's `note_fact` tool covers
judgment-call facts on top of this guaranteed baseline.
"""
from __future__ import annotations

import re

from app.schemas.simulation import Scenario

# "my name is Christopher Nielson", "this is Christopher", "name's Chris"
_NAME_RE = re.compile(
    r"\b(?:my name is|name's|name is|you're speaking (?:with|to)|this is)\s+"
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})",
)
# "reference number is REF-99812", "confirmation #ABC1234", "ticket: T-99", "case 5521".
# Consumes filler words ("number is") and requires the value to contain a digit, so
# we capture the actual id and never the word "number".
_REF_RE = re.compile(
    r"\b(reference|confirmation|ticket|case|call)\b"
    r"(?:\s+(?:number|no\.?|id|is|was|of|the))*"
    r"\s*[:#-]?\s*"
    r"([A-Za-z0-9][A-Za-z0-9-]*\d[A-Za-z0-9-]*)",
    re.IGNORECASE,
)


def extract_notes(text: str, speaker: str, scenario: Scenario) -> list[tuple[str, str]]:
    """Return `(label, value)` facts to record from one turn. Conservative: a name
    only from the counterparty (the rep), and only clearly-numbered references."""
    out: list[tuple[str, str]] = []
    t = (text or "").strip()
    if not t:
        return out

    # The rep introducing themselves (their side only — the agent's "this is
    # <practice>" is the provider, already a node).
    if speaker in ("payer", "ivr"):
        m = _NAME_RE.search(t)
        if m:
            name = m.group(1).strip()
            low = name.lower()
            blocked = {
                scenario.payer.lower(),
                scenario.provider.name.lower(),
                scenario.patient.name.lower(),
            }
            # Skip if it's the payer/provider/patient name (already represented).
            if len(name) >= 3 and not any(low in b or b in low for b in blocked):
                out.append(("Rep name", name))

    for m in _REF_RE.finditer(t):
        out.append((f"{m.group(1).capitalize()} #", m.group(2).strip()))

    return out
