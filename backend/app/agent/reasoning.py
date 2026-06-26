"""
Reasoning-trace narration — pure helpers that turn the real per-turn signals
(the context-graph walk and the anticipatory prediction set) into human-readable
trace segments shown inline above each agent turn. Kept dependency-light and
deterministic so they unit-test without a DB or a model, like `prediction.py`.

Nothing here invents data: every segment is derived from the actual retrieved
subgraph, the model's own chain-of-thought, or the ranked prediction set.
"""
from __future__ import annotations

from app.schemas.agent import LiveReasoning, PredictionSet, ReasoningSegment, Subgraph

# Keep the streamed thinking tidy — reasoning models can emit several thousand
# characters; the UI clamps height but we also cap to avoid bloating the SSE.
THINK_CHAR_BUDGET = 1400


def narrate_graph(subgraph: Subgraph | None) -> ReasoningSegment | None:
    """Narrate the context-graph traversal: seeds → k-hop walk → lit records."""
    if subgraph is None:
        return None
    lit = [n for n in subgraph.nodes if n.lit]
    if not lit:
        return None
    seeds = [n for n in lit if n.seed]
    by_hop = sorted(lit, key=lambda n: (n.hops if n.hops is not None else 99, -n.score, n.id))
    seed_labels = ", ".join(n.label for n in seeds[:3]) or "the focal member"
    max_hop = max((n.hops or 0) for n in lit)
    types = sorted({n.type for n in lit})
    hop_word = "hop" if max_hop == 1 else "hops"
    rec_word = "record" if len(lit) == 1 else "records"
    text = (
        f"Seeded retrieval from {seed_labels}, then walked the knowledge graph up to "
        f"{max_hop} {hop_word} — lighting {len(lit)} linked {rec_word} "
        f"({', '.join(types)}) to ground this turn."
    )
    nodes = [
        {
            "id": n.id,
            "type": n.type,
            "label": n.label,
            "hops": int(n.hops or 0),
            "seed": bool(n.seed),
        }
        for n in by_hop
    ]
    return ReasoningSegment(phase="retrieve", title="Traversed context graph", text=text, nodes=nodes)


def narrate_predictions(
    pred_set: PredictionSet | None,
    warmed_intents: set[str] | None = None,
) -> ReasoningSegment | None:
    """Narrate prediction weighing: the ranked candidates the agent anticipated
    last exchange and which had their record pre-loaded for the next exchange —
    via the speculative tool cache (simulate) or folded into the agent's grounding
    (live). Either way the agent can answer the anticipated request without a
    fresh lookup; `warmed_intents` marks which candidates were pre-loaded."""
    if pred_set is None or not pred_set.predictions:
        return None
    warmed_intents = warmed_intents or set()
    preds = pred_set.predictions[:3]
    parts: list[str] = []
    items: list[dict] = []
    for p in preds:
        pct = round(p.confidence * 100)
        warmed = p.intent in warmed_intents
        parts.append(f"{p.intent} {pct}%")
        items.append(
            {
                "intent": p.intent,
                "utterance": p.utterance,
                "confidence": round(p.confidence, 3),
                "needsTool": p.needs_tool,
                "warmed": warmed,
            }
        )
    text = "Anticipated the next exchange — weighed " + "; ".join(parts) + "."
    if any(i["warmed"] for i in items):
        text += " Pre-loaded the most likely record so the agent can answer that request without a fresh lookup."
    return ReasoningSegment(phase="anticipate", title="Weighed predictions", text=text, predictions=items)


def narrate_think(reasoning: str | None) -> ReasoningSegment | None:
    """Carry the reasoning model's own chain-of-thought, lightly clamped."""
    t = (reasoning or "").strip()
    if not t:
        return None
    if len(t) > THINK_CHAR_BUDGET:
        t = t[:THINK_CHAR_BUDGET].rstrip() + " …"
    return ReasoningSegment(phase="think", title="Reasoned over the call", text=t)


def build_reasoning(
    *,
    id: str,
    seq: int,
    at_ms: int,
    model: str | None,
    subgraph: Subgraph | None,
    reasoning_text: str | None,
    pred_set: PredictionSet | None,
    warmed_intents: set[str] | None = None,
) -> LiveReasoning | None:
    """Assemble the ordered per-turn trace: retrieve → anticipate → think.
    Returns None when there is nothing to show (so the orchestrator can skip)."""
    segments: list[ReasoningSegment] = []
    g = narrate_graph(subgraph)
    if g:
        segments.append(g)
    a = narrate_predictions(pred_set, warmed_intents)
    if a:
        segments.append(a)
    t = narrate_think(reasoning_text)
    if t:
        segments.append(t)
    if not segments:
        return None
    return LiveReasoning(id=id, seq=seq, at_ms=at_ms, model=model, segments=segments)
