"""
Demo-data seeding for the sandbox.

A first-time user lands on an empty cockpit — Analytics, Call History and the Home
dashboard all show honest "no data yet" states. That's correct, but it makes it
hard to *explore* the app before having run anything. This endpoint inserts a
batch of realistic, clearly-tagged call runs (and their audit events) so the whole
cockpit lights up in one click.

Design notes:
- Every seeded row's id is prefixed `demo-`, so the data is identifiable and the
  operation is fully reversible (DELETE removes only those rows, never real runs).
- Rows are attributed to the authenticated user, exactly like a real run.
- Numbers are deterministic (seeded RNG) so the dashboard looks the same each time
  and screenshots are stable.
- Events include `phi.access` and `tool.call` types with a real SHA-256 hash chain,
  so the Logs/Audit ledger verifies and Analytics' PHI / tool-call counts populate.
"""
from __future__ import annotations

import datetime as _dt
import random

from fastapi import APIRouter, Depends

from app.audit.ledger import audit_canonical
from app.config import settings
from app.core.hash import GENESIS_HASH, chain_hash
from app.db import query
from app.packs.registry import all_scenarios
from app.routers._deps import require_internal, require_user

# Same pre-image the live orchestrator stamps into each audit event, so seeded
# rows form a genuine tamper-evident chain that `verify_ledger` accepts.
_PROMPT_VERSION = settings.voiceops_prompt_version

router = APIRouter(
    prefix="/api/demo",
    tags=["demo"],
    dependencies=[Depends(require_internal)],
)

# Plausible model mix for the sandbox: the built-in demo engine, a couple of
# hosted frontier models and the on-device MLX model. Weighted toward the models
# a user would actually run first.
_MODELS = [
    ("demo/voiceops-sim-1", 5),
    ("anthropic/claude-haiku-4.5", 4),
    ("anthropic/claude-sonnet-4.6", 3),
    ("mlx-community/Qwen2.5-7B-Instruct-4bit", 3),
    ("openai/gpt-4o-mini", 2),
]

# Outcome distribution (weight, completion-prob range, escalation-risk range).
_OUTCOMES = [
    ("completed", 64, (0.82, 0.99), (0.02, 0.18)),
    ("escalated", 18, (0.35, 0.7), (0.55, 0.9)),
    ("failed", 9, (0.1, 0.4), (0.4, 0.75)),
    ("abandoned", 9, (0.15, 0.45), (0.3, 0.6)),
]

_DEMO_PREFIX = "demo-"
_DEFAULT_COUNT = 32


def _weighted(rng: random.Random, items):
    """Pick one (value, *rest) row by its integer weight at index 1."""
    total = sum(it[1] for it in items)
    pick = rng.uniform(0, total)
    acc = 0.0
    for it in items:
        acc += it[1]
        if pick <= acc:
            return it
    return items[-1]


def _events_for_run(
    rng: random.Random,
    run_id: str,
    model: str,
    scenario,
    outcome: str,
    started_ms: int,
    duration_sec: int,
) -> list[list]:
    """Build a compact, realistic event timeline with a valid SHA-256 hash chain.

    Mirrors the columns persisted by the live orchestrator so the audit ledger
    verifies and Analytics' phi.access / tool.call aggregates pick these up.
    """
    fields = list(scenario.required_fields) or ["member_id", "dob"]
    rows: list[list] = []
    last_hash = GENESIS_HASH
    seq = 0
    t = started_ms

    def push(etype, actor, summary, *, model_=None, tool=None, phi=False, phi_scope=None, redaction=None):
        nonlocal seq, last_hash, t
        seq += 1
        t += rng.randint(1_500, 9_000)
        canonical = audit_canonical({
            "seq": seq,
            "type": etype,
            "atMs": t,
            "actor": actor,
            "summary": summary,
            "tool": tool,
            "phi": phi,
            "phiScope": phi_scope,
            "redaction": redaction,
            "model": model_,
            "promptVersion": _PROMPT_VERSION if model_ else None,
        })
        new_hash = chain_hash(last_hash, canonical)
        rows.append([
            run_id, seq, etype, t, actor, summary, model_, tool,
            phi, phi_scope, redaction, new_hash, last_hash,
        ])
        last_hash = new_hash

    # Greeting + identity verification (PHI access on the looked-up member).
    push("agent.turn", "agent", "Agent greets the payer IVR and states intent.", model_=model)
    push("payer.turn", "payer", "Payer requests provider NPI and member details.")
    push(
        "phi.access", "agent",
        f"Member record accessed to verify {fields[0]}.",
        phi=True, phi_scope=fields[0], redaction="masked",
    )
    push(
        "tool.call", "agent",
        f"Looked up {scenario.category} record via payer tool.",
        model_=model, tool="payer_lookup", redaction="none",
    )

    if outcome in ("completed", "escalated"):
        push("payer.turn", "payer", "Payer confirms the record and reads back status.")
        push(
            "tool.call", "agent", "Captured determination into the work item.",
            model_=model, tool="record_outcome", redaction="none",
        )

    if outcome == "escalated":
        push("agent.turn", "agent", "Agent requests a live representative for review.", model_=model)
        push("status", "system", "Call escalated to a human reviewer.")
    elif outcome == "completed":
        push("status", "system", "Objective met — call completed cleanly.")
    elif outcome == "failed":
        push("status", "system", "Payer system unavailable — call failed.")
    else:
        push("status", "system", "Caller dropped before completion.")

    return rows


@router.post("/seed")
async def seed_demo(count: int = _DEFAULT_COUNT, user: str = Depends(require_user)):
    """Replace this user's demo data with a fresh deterministic batch.

    Idempotent: existing `demo-` rows for the user are cleared first so repeated
    clicks don't pile up. Returns the number of runs inserted.
    """
    count = max(1, min(int(count), 200))
    scenarios = all_scenarios()
    if not scenarios:
        return {"ok": False, "inserted": 0, "error": "no scenarios available"}

    # Deterministic so the dashboard is stable across reseeds / screenshots.
    rng = random.Random(1729)
    now = _dt.datetime.now(_dt.UTC)

    try:
        # Clear prior demo rows (events cascade via FK ON DELETE CASCADE).
        await query(
            "DELETE FROM call_runs WHERE user_id = $1 AND id LIKE $2",
            [user, f"{_DEMO_PREFIX}%"],
        )

        inserted = 0
        for i in range(count):
            scenario = scenarios[i % len(scenarios)]
            model = _weighted(rng, _MODELS)[0]
            outcome, _, comp_range, esc_range = _weighted(rng, _OUTCOMES)

            duration_sec = rng.randint(38, 360)
            # Spread across the last ~3 days and across the working hours of the
            # day so Analytics' volume-by-hour chart has shape.
            hours_ago = rng.uniform(0, 72)
            started_at = now - _dt.timedelta(hours=hours_ago)
            # Nudge into 7:00–19:00 local-ish band for a believable volume curve.
            started_at = started_at.replace(hour=rng.randint(7, 19))
            ended_at = started_at + _dt.timedelta(seconds=duration_sec)
            run_id = f"{_DEMO_PREFIX}{1000 + i}"
            completion_prob = round(rng.uniform(*comp_range), 4)
            escalation_risk = round(rng.uniform(*esc_range), 4)
            status = "stopped" if outcome == "abandoned" else outcome

            await query(
                """INSERT INTO call_runs
                     (id,user_id,scenario_id,payer,model,status,outcome,
                      completion_prob,escalation_risk,started_at,ended_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                [
                    run_id, user, scenario.id, scenario.payer, model, status, outcome,
                    completion_prob, escalation_risk, started_at, ended_at,
                ],
            )

            started_ms = int(started_at.timestamp() * 1000)
            for row in _events_for_run(
                rng, run_id, model, scenario, outcome, started_ms, duration_sec
            ):
                await query(
                    """INSERT INTO call_events
                         (run_id,seq,type,at_ms,actor,summary,model,tool,
                          phi,phi_scope,redaction,hash,prev_hash)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                    row,
                )
            inserted += 1

        return {"ok": True, "inserted": inserted}
    except Exception as e:  # noqa: BLE001 - degrade gracefully like the read routes
        return {"ok": False, "inserted": 0, "error": str(e) or "seed failed"}


@router.delete("/seed")
async def clear_demo(user: str = Depends(require_user)):
    """Remove only this user's seeded demo runs (events cascade)."""
    try:
        rows = await query(
            "DELETE FROM call_runs WHERE user_id = $1 AND id LIKE $2 RETURNING id",
            [user, f"{_DEMO_PREFIX}%"],
        )
        return {"ok": True, "removed": len(rows)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "removed": 0, "error": str(e) or "clear failed"}
