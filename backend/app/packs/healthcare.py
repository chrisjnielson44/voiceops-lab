"""
Healthcare pack — payer/provider administrative calls (eligibility, claim status,
prior auth). Wraps the existing real-SQL tools, persona prompts, and scenarios so
they run through the generic pack seam. This is the reference pack: it backs its
calls with real Neon tables (members/coverage/claims/prior_auths).
"""
from __future__ import annotations

from app.agent.context_graph import ContextGraph
from app.agent.personas import (
    agent_system_prompt,
    load_ground_truth,
    payer_system_prompt,
    predictor_system_prompt,
)
from app.agent.tools import ToolContext, ToolResult, execute_tool
from app.packs.base import Pack
from app.schemas.simulation import Scenario
from app.simulation.scenarios import SCENARIOS


class HealthcarePack(Pack):
    id = "healthcare"
    label = "Healthcare payer ops"
    description = "Provider-services calls: eligibility, claim status, and prior authorization."

    def scenarios(self) -> list[Scenario]:
        return SCENARIOS

    def agent_system_prompt(self, scenario: Scenario) -> str:
        return agent_system_prompt(scenario)

    def counterparty_system_prompt(self, scenario: Scenario, ground_truth: str) -> str:
        return payer_system_prompt(scenario, ground_truth)

    def predictor_system_prompt(self, scenario: Scenario) -> str:
        return predictor_system_prompt(scenario)

    async def load_ground_truth(self, scenario: Scenario) -> str:
        gt = await load_ground_truth(scenario)
        return gt.text

    async def execute_tool(self, tool: str, args: dict, ctx: ToolContext) -> ToolResult:
        return await execute_tool(tool, args, ctx)

    def tool_context(self, *, run_id: str, scenario: Scenario, transcript: str) -> ToolContext:
        return ToolContext(
            run_id=run_id,
            scenario_id=scenario.id,
            member_id=scenario.patient.member_id,
            claim_id=scenario.claim.id if (scenario.category == "claim-status" and scenario.claim) else None,
            auth_id=scenario.claim.id if (scenario.category == "prior-auth" and scenario.claim) else None,
            transcript=transcript,
        )

    async def build_graph(self, scenario: Scenario) -> ContextGraph | None:
        return await ContextGraph.from_scenario(scenario)

    def predicted_tool_for(self, intent: str, scenario: Scenario) -> tuple[str, dict] | None:
        """Map an anticipated next intent to the tool whose result we can warm.
        These are deterministic, idempotent reads — safe to run speculatively."""
        mid = scenario.patient.member_id
        i = (intent or "").lower()
        if any(k in i for k in ("elig", "coverage", "copay", "deductible", "benefit", "member", "auth_member")):
            return ("verify_eligibility", {"member_id": mid})
        if any(k in i for k in ("claim", "denial", "carc", "resubmission")) and scenario.claim:
            return ("verify_claim", {"claim_id": scenario.claim.id})
        if any(k in i for k in ("lookup", "identify", "authenticate", "verify_member")):
            return ("lookup_patient", {"member_id": mid})
        return None

    def sensitive_scope(self, scenario: Scenario) -> str | None:
        mid = scenario.patient.member_id
        return f"member:***{mid[-4:]}" if mid else None
