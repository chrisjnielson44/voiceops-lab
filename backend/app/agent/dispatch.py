"""
Engine dispatch + run-level tracing.

One entry point the router fires for every run. It (a) opens the Langfuse run
trace that every downstream inference / tool / node nests under, and (b) selects
the call engine from `settings.agent_engine`:

  * "legacy"    → the hand-rolled loop in `orchestrator.run_orchestrator`
  * "langgraph" → the StateGraph engine in `app/agent/graph`

Both engines emit the identical SSE event stream and audit-hash chain, so the
cockpit can't tell which ran. The flag lets us migrate (and instantly roll back)
without touching the working loop.
"""
from __future__ import annotations

from app.agent.run_store import RunState
from app.config import settings
from app.llm.local_llm import local_model_id
from app.observability import tracing


async def run_call(run: RunState) -> None:
    engine = "langgraph" if settings.use_langgraph else "legacy"
    model = run.model or local_model_id()
    with tracing.run_trace(
        run_id=run.id,
        scenario_id=run.scenario_id,
        model=model,
        user_id=run.user_id,
        engine=engine,
    ):
        try:
            if settings.use_langgraph:
                # Lazy import so a deployment that never flips the flag doesn't pay
                # the langgraph import cost (and so legacy keeps working even if the
                # graph package has an issue mid-migration).
                from app.agent.graph.engine import run_orchestrator_lg

                await run_orchestrator_lg(run)
            else:
                from app.agent.orchestrator import run_orchestrator

                await run_orchestrator(run)
        finally:
            # Force-export the trace tail — the run task is short-lived and
            # Langfuse batches in the background.
            tracing.flush()
