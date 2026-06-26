"""
CustomPack — surfaces user-authored scenarios (from custom_store) through the
generic, facts-backed pack seam. Its scenario list is dynamic: it reflects
whatever is currently in the store cache.
"""
from __future__ import annotations

from app.packs import custom_store
from app.packs.generic import GenericPack
from app.schemas.simulation import Scenario


class CustomPack(GenericPack):
    id = "custom"
    label = "Custom (yours)"
    description = "Scenarios you create — runnable in simulate and live, just like the built-ins."
    sensitive = False
    subject_noun = "record"

    def scenarios(self) -> list[Scenario]:
        return custom_store.list_scenarios()
