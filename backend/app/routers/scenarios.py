"""
Scenario catalog endpoint (new). Makes the backend the source of truth for the
scenario library the cockpit offers, instead of duplicating it client-side.
  GET /api/scenarios       — list all scenarios
  GET /api/scenarios/{id}  — fetch one
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.packs.registry import all_scenarios, get_scenario
from app.routers._deps import require_internal, require_user

router = APIRouter(
    prefix="/api",
    tags=["scenarios"],
    dependencies=[Depends(require_internal), Depends(require_user)],
)


@router.get("/scenarios")
async def scenarios():
    return {"scenarios": [s.to_wire() for s in all_scenarios()]}


@router.get("/scenarios/{scenario_id}")
async def scenario(scenario_id: str):
    return get_scenario(scenario_id).to_wire()
