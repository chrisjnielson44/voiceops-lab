"""Unit tests for the reasoning-trace narration assembler (pure, no DB/model)."""
from __future__ import annotations

from app.agent.reasoning import build_reasoning, narrate_graph, narrate_predictions, narrate_think
from app.llm.local_llm import _split_think
from app.schemas.agent import GraphNode, Prediction, PredictionSet, Subgraph


def _subgraph() -> Subgraph:
    return Subgraph(
        nodes=[
            GraphNode(id="member:W1", type="member", label="Maria Alvarez", score=1.0, lit=True, seed=True, hops=0),
            GraphNode(id="coverage:W1", type="coverage", label="Aetna PPO", score=0.7, lit=True, seed=False, hops=1),
            GraphNode(id="plan:W1", type="plan", label="PPO Plan", score=0.4, lit=True, seed=False, hops=2),
            GraphNode(id="payer:aetna", type="payer", label="Aetna", score=0.1, lit=False, seed=False, hops=3),
        ],
        seeds=["member:W1"],
        hops=2,
    )


def test_narrate_graph_describes_seed_and_walk():
    seg = narrate_graph(_subgraph())
    assert seg is not None
    assert seg.phase == "retrieve"
    assert "Maria Alvarez" in seg.text
    assert "2 hops" in seg.text
    # only lit nodes are carried, ordered by hops
    assert [n["id"] for n in seg.nodes] == ["member:W1", "coverage:W1", "plan:W1"]
    assert seg.nodes[0]["seed"] is True


def test_narrate_graph_none_when_nothing_lit():
    sg = _subgraph()
    for n in sg.nodes:
        n.lit = False
    assert narrate_graph(sg) is None
    assert narrate_graph(None) is None


def test_narrate_predictions_ranks_and_flags_warmed():
    ps = PredictionSet(
        predictions=[
            Prediction(intent="request_authentication", utterance="Provide the group number?", confidence=0.85, needs_tool="verify_eligibility"),
            Prediction(intent="provide_eligibility", utterance="Coverage is active.", confidence=0.6),
        ]
    )
    seg = narrate_predictions(ps, warmed_intents={"request_authentication"})
    assert seg is not None
    assert seg.phase == "anticipate"
    assert "request_authentication 85%" in seg.text
    assert "Warmed the cache" in seg.text
    assert seg.predictions[0]["warmed"] is True
    assert seg.predictions[1]["warmed"] is False


def test_narrate_predictions_none_when_empty():
    assert narrate_predictions(None) is None
    assert narrate_predictions(PredictionSet(predictions=[])) is None


def test_narrate_think_clamps_and_skips_empty():
    assert narrate_think("") is None
    assert narrate_think("   ") is None
    long = "x" * 5000
    seg = narrate_think(long)
    assert seg is not None and seg.phase == "think"
    assert len(seg.text) < 1500 and seg.text.endswith("…")


def test_build_reasoning_orders_segments_retrieve_anticipate_think():
    ps = PredictionSet(predictions=[Prediction(intent="ask", utterance="?", confidence=0.5)])
    trace = build_reasoning(
        id="r-3", seq=3, at_ms=1200, model="qwen3:14b",
        subgraph=_subgraph(), reasoning_text="The payer needs the group number.",
        pred_set=ps, warmed_intents=set(),
    )
    assert trace is not None
    assert trace.id == "r-3" and trace.seq == 3 and trace.model == "qwen3:14b"
    assert [s.phase for s in trace.segments] == ["retrieve", "anticipate", "think"]


def test_build_reasoning_none_when_no_signal():
    assert build_reasoning(
        id="r-0", seq=0, at_ms=0, model="m",
        subgraph=None, reasoning_text="", pred_set=None,
    ) is None


def test_split_think_handles_inline_and_unclosed():
    think, ans = _split_think("<think>weighing options</think>{\"action\":\"speak\"}")
    assert think == "weighing options"
    assert ans == '{"action":"speak"}'
    # out-of-band reasoning (no tag) passes content through untouched
    assert _split_think('{"action":"speak"}') == ("", '{"action":"speak"}')
    # unclosed (truncated) tag: everything after the tag is reasoning
    think2, ans2 = _split_think("answer <think>still thinking")
    assert think2 == "still thinking" and ans2 == "answer"
