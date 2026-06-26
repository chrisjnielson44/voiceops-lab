"""
Pack registry — the single place that knows which packs exist. Everything else
(orchestrator, voice/scenarios routers) resolves scenarios and their owning pack
through here, so adding a domain is just appending a pack to `_PACKS`.

Resolution is dynamic (computed per call) rather than cached at import, because
the CustomPack's scenario list changes at runtime as users create/edit/delete
custom scenarios.
"""
from __future__ import annotations

from app.packs.banking import BankingPack
from app.packs.base import Pack
from app.packs.custom import CustomPack
from app.packs.healthcare import HealthcarePack
from app.packs.telecom import TelecomPack
from app.schemas.simulation import Scenario

# Registered packs, in display order. Custom goes last so user scenarios sit
# beneath the built-in domains. Append new domain packs before CustomPack.
_PACKS: list[Pack] = [HealthcarePack(), BankingPack(), TelecomPack(), CustomPack()]


def all_packs() -> list[Pack]:
    return _PACKS


def all_scenarios() -> list[Scenario]:
    return [s for p in _PACKS for s in p.scenarios()]


def get_scenario(scenario_id: str) -> Scenario:
    scenarios = all_scenarios()
    return next((s for s in scenarios if s.id == scenario_id), scenarios[0])


def pack_for_scenario(scenario_id: str) -> Pack:
    for p in _PACKS:
        if any(s.id == scenario_id for s in p.scenarios()):
            return p
    return _PACKS[0]


def default_scenario_id() -> str:
    return all_scenarios()[0].id
