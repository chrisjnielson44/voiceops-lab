"""
The LangGraph turn state.

Deliberately thin: the rich per-call state (message history, audit chain, context
graph, metrics) lives on the `CallEngine` instance passed through
`config["configurable"]["engine"]`. The channels here carry only what routing and
checkpoint/resume need between nodes — all JSON-serializable so the checkpointer
can persist them at an `interrupt()`.
"""
from __future__ import annotations

from typing import TypedDict


class TurnState(TypedDict, total=False):
    # How many agent decisions have been taken (≈ the legacy `for step in
    # range(MAX_STEPS)` index). Gates the loop length.
    step: int
    # The agent's latest parsed decision and the context string it was grounded
    # on — handed from the `decide` node to the `tool` / `speak` nodes.
    decision: dict | None
    ctx_str: str
    agent_text: str
    # Set by `decide`/`payer` so the conditional edge knows where to go next:
    # "tool" | "speak" | "payer" | "decide" | "redecide" | "finalize".
    route: str
    finished: bool
