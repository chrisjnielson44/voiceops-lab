"""Unit tests for the FK-derived context graph + k-hop retrieval. Pure: canned
DB rows in, no database needed."""
from __future__ import annotations

from app.agent.context_graph import BUDGET_CHARS, ContextGraph
from app.simulation.scenarios import SCENARIOS


def _scenario(scenario_id: str):
    return next(s for s in SCENARIOS if s.id == scenario_id)


def _denied_claim_rows():
    s = _scenario("claim-uhc")
    mid = s.patient.member_id
    member = {"member_id": mid, "name": "Acme Member", "payer": s.payer, "payer_id": s.payer_id, "plan_type": "PPO", "group_number": "GRP-9"}
    coverage = {"member_id": mid, "active": True, "plan_type": "PPO", "group_number": "GRP-9", "copay_pcp": 25, "copay_spec": 50, "deductible_total": 1500, "deductible_met": 600, "oop_max": 6000, "oop_met": 1200}
    claims = [{
        "claim_id": s.claim.id, "member_id": mid, "status": "DENIED", "dos": "2026-02-01",
        "cpt": "70553", "billed_amount": 4200, "carc_code": "CO-197",
        "denial_reason": "Precert/auth absent", "resubmission_path": "Submit corrected claim with auth",
        "timely_filing_deadline": "2026-08-01",
    }]
    return s, member, coverage, claims


def test_build_creates_fk_edges_for_denied_claim():
    s, member, coverage, claims = _denied_claim_rows()
    g = ContextGraph.build(s, member=member, coverage=coverage, claims=claims, prior_auths=[])
    sub, _ctx = g.retrieve("", intent="claim-status")
    node_ids = {n.id for n in sub.nodes}
    assert f"member:{s.patient.member_id}" in node_ids
    assert f"claim:{s.claim.id}" in node_ids
    assert "carc:CO-197" in node_ids
    edge_labels = {(e.source.split(":")[0], e.label, e.target.split(":")[0]) for e in sub.edges}
    assert ("member", "HAS_CLAIM", "claim") in edge_labels
    assert ("claim", "DENIED_FOR", "carc") in edge_labels


def test_retrieve_lights_claim_and_context_has_facts():
    s, member, coverage, claims = _denied_claim_rows()
    g = ContextGraph.build(s, member=member, coverage=coverage, claims=claims, prior_auths=[])
    sub, ctx = g.retrieve("Why was the claim denied?", missing_fields=["denial_reason", "resubmission_path"], intent="claim-status")
    lit_types = {n.type for n in sub.nodes if n.lit}
    assert "claim" in lit_types and "carc" in lit_types
    assert s.claim.id in ctx and "CO-197" in ctx
    assert "Precert" in ctx  # denial reason surfaced


def test_missing_field_bonus_pulls_coverage_for_eligibility():
    s = _scenario("elig-aetna")
    mid = s.patient.member_id
    member = {"member_id": mid, "name": "E", "payer": s.payer, "payer_id": s.payer_id, "plan_type": "HMO", "group_number": "G1"}
    coverage = {"member_id": mid, "active": True, "plan_type": "HMO", "copay_pcp": 20, "copay_spec": 40, "deductible_total": 1000, "deductible_met": 100, "oop_max": 5000, "oop_met": 200}
    g = ContextGraph.build(s, member=member, coverage=coverage, claims=[], prior_auths=[])
    sub, ctx = g.retrieve("", missing_fields=["copay", "deductible_met"], intent="eligibility")
    cov = next(n for n in sub.nodes if n.type == "coverage")
    assert cov.lit and cov.score > 0
    assert "copay" in ctx.lower()


def test_transcript_id_mention_seeds_node():
    s, member, coverage, claims = _denied_claim_rows()
    g = ContextGraph.build(s, member=member, coverage=coverage, claims=claims, prior_auths=[])
    sub, _ = g.retrieve(f"I'm calling about claim {s.claim.id}.", intent="claim-status")
    claim_node = next(n for n in sub.nodes if n.id == f"claim:{s.claim.id}")
    assert claim_node.seed is True


def test_context_respects_token_budget():
    s, member, coverage, claims = _denied_claim_rows()
    # Many claims to try to overflow the budget.
    claims = claims + [
        {"claim_id": f"C-{i}", "member_id": s.patient.member_id, "status": "PAID", "dos": "2026-01-01", "cpt": "99213", "billed_amount": 100 + i}
        for i in range(40)
    ]
    g = ContextGraph.build(s, member=member, coverage=coverage, claims=claims, prior_auths=[])
    _sub, ctx = g.retrieve("", intent="claim-status")
    assert len(ctx) <= BUDGET_CHARS


def test_no_cross_member_leakage_via_payer_hub():
    """Two members on the same payer must not bleed across the payer hub: the
    graph is built per-member, and payer edges are low-weight so a 2-hop walk
    from one member cannot reach another member with meaningful score."""
    s, member, coverage, claims = _denied_claim_rows()
    g = ContextGraph.build(s, member=member, coverage=coverage, claims=claims, prior_auths=[])
    member_nodes = [n for n in g.retrieve("", intent="claim-status")[0].nodes if n.type == "member"]
    assert len(member_nodes) == 1
