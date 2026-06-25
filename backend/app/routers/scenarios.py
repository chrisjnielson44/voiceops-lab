"""
Scenario catalog endpoint (new). Makes the backend the source of truth for the
scenario library the cockpit offers, instead of duplicating it client-side.
  GET /api/scenarios       — list all scenarios
  GET /api/scenarios/{id}  — fetch one
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.routers._deps import require_internal
from app.simulation.scenarios import SCENARIOS, get_scenario

router = APIRouter(prefix="/api", tags=["scenarios"], dependencies=[Depends(require_internal)])


@router.get("/scenarios")
async def scenarios():
    return {"scenarios": [s.to_wire() for s in SCENARIOS]}


@router.get("/scenarios/{scenario_id}")
async def scenario(scenario_id: str):
    return get_scenario(scenario_id).to_wire()
