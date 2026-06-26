"""Demo-seed event generation.

The home page's "Load demo data" button inserts these rows so a first-time user
sees a populated cockpit. The events must form a genuine tamper-evident chain —
identical in shape to a real orchestrator run — so the audit ledger verifies and
Analytics' PHI / tool-call aggregates have something to count.
"""
from __future__ import annotations

import random

from app.audit.ledger import verify_ledger
from app.config import settings
from app.packs.registry import all_scenarios
from app.routers.seed import _events_for_run

_COLS = [
    "run_id", "seq", "type", "atMs", "actor", "summary", "model", "tool",
    "phi", "phiScope", "redaction", "hash", "prevHash",
]


def _as_events(rows: list[list]) -> list[dict]:
    events = [dict(zip(_COLS, r, strict=True)) for r in rows]
    for e in events:
        e["promptVersion"] = settings.voiceops_prompt_version if e["model"] else None
    return events


def test_seeded_events_form_a_valid_ledger_chain():
    rng = random.Random(1729)
    scenario = all_scenarios()[0]
    for outcome in ("completed", "escalated", "failed", "abandoned"):
        rows = _events_for_run(
            rng, "demo-1000", "demo/voiceops-sim-1", scenario, outcome, 1_700_000_000_000, 120
        )
        events = _as_events(rows)
        assert events, f"{outcome} produced no events"
        assert verify_ledger(events), f"{outcome} ledger failed to verify"


def test_seeded_events_populate_phi_and_tool_aggregates():
    rng = random.Random(1729)
    scenario = all_scenarios()[0]
    rows = _events_for_run(
        rng, "demo-1000", "demo/voiceops-sim-1", scenario, "completed", 1_700_000_000_000, 120
    )
    types = [r[2] for r in rows]
    assert "phi.access" in types
    assert "tool.call" in types
    # tool.call rows must carry a non-null redaction so analytics doesn't count
    # them as tool errors (redaction IS NULL).
    tool_rows = [r for r in rows if r[2] == "tool.call"]
    assert all(r[10] is not None for r in tool_rows)
