"""
Pack registry — the single place that knows which packs exist. Everything else
(orchestrator, voice/scenarios routers) resolves scenarios and their owning pack
through here, so adding a domain is just appending a pack to `_PACKS`.
"""
from __future__ import annotations

from app.packs.base import Pack
from app.packs.healthcare import HealthcarePack
from app.schemas.simulation import Scenario

# Registered packs, in display order. Append new domain packs here.
_PACKS: list[Pack] = [HealthcarePack()]

# scenario id -> owning pack
_PACK_BY_SCENARIO: dict[str, Pack] = {s.id: p for p in _PACKS for s in p.scenarios()}


def all_packs() -> list[Pack]:
    return _PACKS


def all_scenarios() -> list[Scenario]:
    return [s for p in _PACKS for s in p.scenarios()]


def get_scenario(scenario_id: str) -> Scenario:
    scenarios = all_scenarios()
    return next((s for s in scenarios if s.id == scenario_id), scenarios[0])


def pack_for_scenario(scenario_id: str) -> Pack:
    return _PACK_BY_SCENARIO.get(scenario_id) or _PACKS[0]


def default_scenario_id() -> str:
    return all_scenarios()[0].id
