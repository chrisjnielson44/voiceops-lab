"""
A bounded sub-agent, run as a nested LangGraph subgraph.

This is the "capability" pattern: the main agent can delegate a complex,
multi-step task to a self-contained `plan → gather → verify → synthesize` graph
that has its own state and reuses the real read tools, then returns one
synthesized answer. It's exposed to the agent as the `investigate` tool (see
`tools.TOOL_CATALOG`), so the model invokes it like any other tool — but behind
that single call is a whole sub-graph.

Kept deterministic where it doesn't need a model (the planner is a heuristic over
the task + ToolContext) so it's cheap and testable; only the final synthesis
calls the LLM. Swapping the planner for an LLM call is a one-node change.
"""
from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, StateGraph

from app.agent.tools import ToolContext, ToolResult
from app.llm.local_llm import chat
from app.observability import tracing


class SubAgentState(TypedDict, total=False):
    task: str
    plan: list[dict]
    gathered: list[dict]
    flags: list[str]
    result: str
    phi: bool


def _ctx(config) -> ToolContext:
    return config["configurable"]["ctx"]


async def _plan_node(state: SubAgentState, config) -> dict:
    """Heuristic plan: which idempotent read tools to gather for this task."""
    ctx = _ctx(config)
    task = (state.get("task") or "").lower()
    broad = (not task) or any(k in task for k in ("end to end", "reconcile", "root cause", "root-cause", "why"))
    plan: list[dict] = []
    if ctx.member_id:
        plan.append({"tool": "lookup_patient", "args": {"member_id": ctx.member_id}})
        plan.append({"tool": "verify_eligibility", "args": {"member_id": ctx.member_id}})
    if ctx.claim_id and (broad or any(k in task for k in ("claim", "denial", "deny", "denied"))):
        plan.append({"tool": "verify_claim", "args": {"claim_id": ctx.claim_id}})
    # Cross-check prior auth when the case is auth-related or a broad reconciliation
    # — this is what lets the sub-agent catch "claim denied for absent auth, but the
    # auth is actually approved now" discrepancies.
    if (ctx.auth_id or ctx.member_id) and (
        broad or any(k in task for k in ("auth", "authorization", "precert", "denial", "denied", "appeal"))
    ):
        auth_args = {"auth_id": ctx.auth_id} if ctx.auth_id else {"member_id": ctx.member_id}
        plan.append({"tool": "verify_auth", "args": auth_args})
    return {"plan": plan, "gathered": []}


async def _gather_node(state: SubAgentState, config) -> dict:
    """Run each planned read tool and collect its result. Lazy import of the base
    tool executor avoids a tools ⇄ subagents import cycle."""
    from app.agent.tools import execute_tool as base_execute

    ctx = _ctx(config)
    gathered: list[dict] = []
    phi = False
    for step in state.get("plan", []):
        res = await base_execute(step["tool"], step["args"], ctx)
        phi = phi or res.phi
        gathered.append({"tool": step["tool"], "result": res.result, "status": res.status, "data": res.data})
    return {"gathered": gathered, "phi": phi}


async def _verify_node(state: SubAgentState, config) -> dict:
    """Cross-check the gathered records and raise flags — including the
    claim↔auth reconciliation that decides resubmit vs. appeal/escalate."""
    flags: list[str] = []
    by_tool = {g["tool"]: (g.get("data") or {}) for g in state.get("gathered", [])}

    if (by_tool.get("verify_eligibility") or {}).get("active") is False:
        flags.append("coverage is INACTIVE")

    claim = by_tool.get("verify_claim") or {}
    auth = by_tool.get("verify_auth") or {}
    claim_denied = str(claim.get("status")) == "DENIED"
    denial_reason = str(claim.get("denial_reason") or "")
    auth_related = any(k in denial_reason.lower() for k in ("auth", "precert", "carc 197"))
    auth_status = str(auth.get("status") or "")

    if claim_denied and not auth_related:
        flags.append(f"claim DENIED — {denial_reason or 'see CARC code'}")
    elif claim_denied and auth_related:
        # The denial blames a missing/late authorization — reconcile against the
        # actual auth record to recommend the right action.
        if auth_status == "APPROVED":
            flags.append(
                f"DISCREPANCY: claim denied for absent authorization, but auth {auth.get('auth_id')} "
                f"is now APPROVED → resubmit the claim (do not appeal)"
            )
        elif auth_status in ("PENDING", ""):
            flags.append("auth-related denial with no APPROVED auth on file → authorization still PENDING; resolve auth before resubmitting")
        elif auth_status == "NONE":
            flags.append("auth-related denial and NO prior auth on file → retro-authorization appeal required (escalate)")
        else:
            flags.append(f"auth-related denial; auth status is {auth_status} → review needed")
    return {"flags": flags}


async def _synthesize_node(state: SubAgentState, config) -> dict:
    """Have the model synthesize the gathered facts + flags into one answer."""
    facts = "\n".join(f"- {g['tool']}: {g['result']}" for g in state.get("gathered", []))
    flags = state.get("flags") or []
    flag_line = ("\nRisk flags: " + "; ".join(flags)) if flags else ""
    r = await chat(
        [
            {"role": "system", "content": "You are a verification sub-agent. Synthesize the gathered records into a concise, factual finding (2-3 sentences) for the calling agent. No PHI beyond member id."},
            {"role": "user", "content": f"Task: {state.get('task')}\n\nGathered records:\n{facts}{flag_line}"},
        ],
        temperature=0.2,
        max_tokens=220,
        model=_ctx(config).model,
        name="subagent.synthesize",
    )
    result = r.text.strip() or "Investigation complete."
    if flags:
        result = f"{result} [flags: {'; '.join(flags)}]"
    return {"result": result}


_SUBGRAPH = None


def _subgraph():
    global _SUBGRAPH
    if _SUBGRAPH is None:
        g = StateGraph(SubAgentState)
        g.add_node("plan", _plan_node)
        g.add_node("gather", _gather_node)
        g.add_node("verify", _verify_node)
        g.add_node("synthesize", _synthesize_node)
        g.set_entry_point("plan")
        g.add_edge("plan", "gather")
        g.add_edge("gather", "verify")
        g.add_edge("verify", "synthesize")
        g.add_edge("synthesize", END)
        _SUBGRAPH = g.compile()
    return _SUBGRAPH


async def run_investigation(task: str, ctx: ToolContext) -> ToolResult:
    """Entry point used by the `investigate` tool. Runs the sub-graph and folds its
    finding back into a single ToolResult the calling agent can speak."""
    with tracing.observation("subagent.investigate", as_type="agent", input={"task": task}) as obs:
        state = await _subgraph().ainvoke(
            {"task": task or "Verify the member's records end to end."},
            {"configurable": {"ctx": ctx}},
        )
        result = state.get("result") or "Investigation complete."
        flags = state.get("flags") or []
        obs.update(output=result)
    return ToolResult(
        result=result,
        status="warn" if flags else "ok",
        phi=bool(state.get("phi")),
        data={"gathered": state.get("gathered"), "flags": flags, "subagent": "investigate"},
    )
