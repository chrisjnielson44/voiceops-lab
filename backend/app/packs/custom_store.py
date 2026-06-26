"""
Custom-scenario store — user-authored scenarios persisted in Neon
(`custom_scenarios`) with a write-through in-memory cache so the synchronous
pack registry can resolve them without an await. Loaded once on startup; every
create/update/delete writes the DB and updates the cache together.

Custom scenarios run on the generic, facts-backed pack seam (see CustomPack),
so they need no seeded ground-truth tables.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from app.db import query
from app.packs.generic import make_scenario
from app.schemas.simulation import Scenario

# Insertion-ordered cache: id -> Scenario. Mirrors created_at order on load.
_CACHE: dict[str, Scenario] = {}


def new_id(title: str) -> str:
    slug = "".join(c if c.isalnum() else "-" for c in (title or "scenario").lower()).strip("-")[:24] or "scenario"
    return f"custom-{slug}-{uuid.uuid4().hex[:6]}"


def build_scenario(
    *,
    scenario_id: str,
    title: str,
    payer: str,
    category: str,
    difficulty: str,
    objective: str,
    subject_name: str,
    subject_id: str,
    caller_name: str,
    required_fields: list[str],
    facts: str,
    outcome: str = "completed",
) -> Scenario:
    """Map editor input onto the (healthcare-shaped) Scenario schema. The
    subject becomes `patient`, the caller becomes `provider`; the generic pack
    reads these generically."""
    return make_scenario(
        {
            "id": scenario_id,
            "title": title.strip() or "Untitled scenario",
            "payer": payer.strip() or "Counterparty",
            "payer_id": (scenario_id[:16]).upper(),
            "category": (category.strip() or "general"),
            "difficulty": difficulty if difficulty in ("routine", "moderate", "complex") else "moderate",
            "outcome": "escalated" if outcome == "escalated" else "completed",
            "objective": objective.strip(),
            "patient": {"name": subject_name.strip() or "Subject", "member_id": subject_id.strip(), "dob": ""},
            "provider": {"name": caller_name.strip() or "Caller", "npi": "", "tax_id": ""},
            "required_fields": [f.strip() for f in required_fields if f and f.strip()],
            "facts": facts.strip() or None,
        }
    )


def list_scenarios() -> list[Scenario]:
    return list(_CACHE.values())


def get(scenario_id: str) -> Scenario | None:
    return _CACHE.get(scenario_id)


def exists(scenario_id: str) -> bool:
    return scenario_id in _CACHE


async def load_all() -> None:
    """Populate the cache from Neon. Best-effort: a missing/unreachable DB just
    leaves the cache empty (the app still serves built-in packs)."""
    _CACHE.clear()
    try:
        rows = await query("SELECT id, payload FROM custom_scenarios ORDER BY created_at ASC")
    except Exception:  # noqa: BLE001 - DB optional; degrade to no custom scenarios
        return
    for row in rows:
        payload = row.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                continue
        if not isinstance(payload, dict):
            continue
        try:
            _CACHE[row["id"]] = Scenario.model_validate(payload)
        except Exception:  # noqa: BLE001 - skip a corrupt row rather than fail boot
            continue


async def create(scenario: Scenario, user_id: str | None) -> Scenario:
    await _persist(scenario, user_id, insert=True)
    _CACHE[scenario.id] = scenario
    return scenario


async def update(scenario: Scenario, user_id: str | None) -> Scenario:
    await _persist(scenario, user_id, insert=False)
    _CACHE[scenario.id] = scenario
    return scenario


async def delete(scenario_id: str) -> bool:
    existed = scenario_id in _CACHE
    await query("DELETE FROM custom_scenarios WHERE id = $1", [scenario_id])
    _CACHE.pop(scenario_id, None)
    return existed


async def _persist(scenario: Scenario, user_id: str | None, *, insert: bool) -> None:
    payload: dict[str, Any] = scenario.to_wire()
    if insert:
        await query(
            """INSERT INTO custom_scenarios(id, user_id, title, payer, category, payload)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)""",
            [scenario.id, user_id, scenario.title, scenario.payer, scenario.category, json.dumps(payload)],
        )
    else:
        await query(
            """UPDATE custom_scenarios
               SET title = $2, payer = $3, category = $4, payload = $5::jsonb, updated_at = now()
               WHERE id = $1""",
            [scenario.id, scenario.title, scenario.payer, scenario.category, json.dumps(payload)],
        )
