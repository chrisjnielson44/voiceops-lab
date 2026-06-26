"""
The `Pack` contract. A pack makes a domain runnable by the generic orchestrator
without the orchestrator knowing anything domain-specific. Each pack supplies its
scenarios, the three system prompts (agent / counterparty / predictor), a tool
executor, ground-truth loading, the per-scenario entity references threaded into
`ToolContext`, and the redaction scope used for sensitive-data audit events.
"""
from __future__ import annotations

from app.agent.context_graph import ContextGraph
from app.agent.tools import ToolContext, ToolResult
from app.schemas.simulation import Scenario


class Pack:
    """Base class for a domain pack. Subclasses set `id`/`label` and implement
    the methods below. The orchestrator only ever talks to this surface."""

    id: str = "base"
    label: str = "Base"
    description: str = ""

    # --- catalog -----------------------------------------------------------
    def scenarios(self) -> list[Scenario]:
        raise NotImplementedError

    # --- prompts -----------------------------------------------------------
    def agent_system_prompt(self, scenario: Scenario) -> str:
        raise NotImplementedError

    def counterparty_system_prompt(self, scenario: Scenario, ground_truth: str) -> str:
        raise NotImplementedError

    def predictor_system_prompt(self, scenario: Scenario) -> str:
        raise NotImplementedError

    # --- runtime data ------------------------------------------------------
    async def load_ground_truth(self, scenario: Scenario) -> str:
        """Return the authoritative records (as a text block) the counterparty
        model is allowed to use. Empty string if none."""
        raise NotImplementedError

    async def execute_tool(self, tool: str, args: dict, ctx: ToolContext) -> ToolResult:
        raise NotImplementedError

    def tool_context(self, *, run_id: str, scenario: Scenario, transcript: str) -> ToolContext:
        """Build the per-call tool context (entity ids the tools resolve)."""
        raise NotImplementedError

    # --- context graph (GraphRAG-lite) -------------------------------------
    async def build_graph(self, scenario: Scenario) -> ContextGraph | None:
        """Build the per-run context graph for retrieval. None = no graph
        (the orchestrator simply skips graph retrieval)."""
        return None

    # --- speculative prefetch ----------------------------------------------
    async def prefetch(self, tool: str, args: dict, ctx: ToolContext) -> ToolResult:
        """Speculatively run a tool for anticipatory prefetch. Default delegates
        to execute_tool; packs may override to flag it as non-authoritative
        (no PHI audit / metrics side-effects)."""
        return await self.execute_tool(tool, args, ctx)

    def predicted_tool_for(self, intent: str, scenario: Scenario) -> tuple[str, dict] | None:
        """Map a predicted next intent to the (tool, args) the agent will likely
        need, so the result can be prefetched. None = nothing to prefetch."""
        return None

    # --- audit -------------------------------------------------------------
    def sensitive_scope(self, scenario: Scenario) -> str | None:
        """Redaction scope label for sensitive-data audit events (e.g.
        `member:***1234`). None when the domain has no sensitive anchor."""
        return None
