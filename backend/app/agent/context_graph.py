"""
ContextGraph — a deterministic, FK-derived knowledge graph for grounded
retrieval (GraphRAG-lite, local-search only; no LLM extraction, no community
summaries).

The graph is built ONCE per run from the SAME Neon tables the tools read
(members / coverage / claims / prior_auths), so any context injected into the
agent prompt can never disagree with a tool result. Each turn we retrieve a
relevant SUBGRAPH by seeding from entities known/mentioned in the conversation,
expanding a weighted k-hop neighborhood, and scoring by call intent + still-
missing required fields. Retrieval is pure Python (sub-millisecond) and works
even when the local models are offline — only the agent/predictor need a model.

Everything here is plain data + arithmetic so it is unit-testable without a DB
(pass canned rows to `ContextGraph.build`).
"""
from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.schemas.agent import GraphEdge, GraphNode, Subgraph
from app.schemas.simulation import Scenario

# --- tuning constants (the whole game lives here) ---------------------------

# Edge weights encode how "load-bearing" a relationship is for retrieval. Hub
# edges (payer/plan/provider, which fan out to many members) are deliberately
# low so a shared hub cannot leak a *different* member's PHI into context.
EDGE_WEIGHTS: dict[str, float] = {
    "HAS_COVERAGE": 1.0,
    "HAS_CLAIM": 1.0,
    "HAS_AUTH": 1.0,
    "DENIED_FOR": 0.9,
    "COVERED_BY": 0.6,   # member -> payer (hub)
    "ON_PLAN": 0.55,     # coverage -> plan (hub)
    "SUBMITTED": 0.6,    # provider -> claim
    "SEEN_BY": 0.5,      # member -> provider (hub)
    "FOR_PROCEDURE": 0.7,
    "NOTED": 1.0,        # member -> a fact the agent recorded on the call
}

# Per-intent multiplier so retrieval chases the node types that matter for the
# current call category.
TYPE_PRIORITY: dict[str, dict[str, float]] = {
    "eligibility": {"coverage": 1.6, "plan": 1.4, "member": 1.2, "payer": 1.1},
    "claim-status": {"claim": 1.7, "carc": 1.5, "member": 1.1},
    "prior-auth": {"auth": 1.7, "member": 1.1, "provider": 1.1},
}

# Which node types satisfy which required-field keywords (drives the
# missing-field bonus, so retrieval pulls toward unfilled slots).
FIELD_NODE_HINTS: list[tuple[tuple[str, ...], str]] = [
    (("copay", "deductible", "oop", "coverage", "eligib", "effective", "active"), "coverage"),
    (("plan",), "plan"),
    (("denial", "carc", "resubmission", "claim", "billed", "timely"), "claim"),
    (("auth", "determination", "criteria", "peer", "review"), "auth"),
    (("payer",), "payer"),
]

DECAY = 0.6          # score multiplier per hop
DEFAULT_HOPS = 2
DENIAL_HOPS = 3      # claim-status walks one hop further (claim -> carc -> ...)
BUDGET_CHARS = 3200  # ~800 tokens of serialized context
MIN_SCORE = 0.05


# --- internal node/edge model -----------------------------------------------


@dataclass
class _Node:
    id: str
    type: str
    label: str
    attrs: dict[str, Any] = field(default_factory=dict)
    # search tokens (ids/codes/names) used for transcript seeding
    tokens: tuple[str, ...] = ()


@dataclass
class _Edge:
    source: str
    target: str
    label: str


def _jsonsafe(v: Any) -> Any:
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10]
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _row(d: dict[str, Any] | None) -> dict[str, Any]:
    return {k: _jsonsafe(v) for k, v in (d or {}).items()}


# --- the graph ---------------------------------------------------------------


class ContextGraph:
    def __init__(self, scenario_category: str, focus: dict[str, str | None]):
        self.category = scenario_category
        self.focus = focus  # {"member": id, "claim": id, "auth": id, "provider": npi}
        self._nodes: dict[str, _Node] = {}
        self._edges: list[_Edge] = []
        self._adj: dict[str, list[tuple[str, str]]] = {}  # node -> [(neighbor, edge_label)]
        self._note_seq = 0  # counter for conversational `note:` nodes

    # -- construction --------------------------------------------------------

    def _add_node(self, node_id: str, type_: str, label: str, attrs: dict[str, Any], tokens: list[str]) -> None:
        toks = tuple(str(t).lower() for t in tokens if t)
        if node_id in self._nodes:
            return
        self._nodes[node_id] = _Node(node_id, type_, label, attrs, toks)
        self._adj.setdefault(node_id, [])

    def _add_edge(self, source: str, target: str, label: str) -> None:
        if source not in self._nodes or target not in self._nodes:
            return
        self._edges.append(_Edge(source, target, label))
        self._adj.setdefault(source, []).append((target, label))
        self._adj.setdefault(target, []).append((source, label))

    @classmethod
    def build(
        cls,
        scenario: Scenario,
        *,
        member: dict[str, Any] | None,
        coverage: dict[str, Any] | None,
        claims: list[dict[str, Any]] | None,
        prior_auths: list[dict[str, Any]] | None,
    ) -> ContextGraph:
        """Pure builder — DB rows in, graph out (unit-testable, no I/O)."""
        focus = {
            "member": scenario.patient.member_id,
            "claim": scenario.claim.id if (scenario.category == "claim-status" and scenario.claim) else None,
            "auth": scenario.claim.id if (scenario.category == "prior-auth" and scenario.claim) else None,
            "provider": scenario.provider.npi,
        }
        g = cls(scenario.category, focus)

        m = _row(member) or {
            "member_id": scenario.patient.member_id,
            "name": scenario.patient.name,
            "payer": scenario.payer,
            "payer_id": scenario.payer_id,
        }
        mid = str(m.get("member_id") or scenario.patient.member_id)
        member_node = f"member:{mid}"
        g._add_node(
            member_node, "member", str(m.get("name") or scenario.patient.name),
            m, [mid, m.get("name"), m.get("group_number")],
        )

        payer_id = str(m.get("payer_id") or scenario.payer_id)
        payer_node = f"payer:{payer_id}"
        g._add_node(payer_node, "payer", str(m.get("payer") or scenario.payer), {"payer_id": payer_id}, [payer_id, m.get("payer")])
        g._add_edge(member_node, payer_node, "COVERED_BY")

        # provider (from scenario; not a DB table here)
        prov = scenario.provider
        prov_node = f"provider:{prov.npi}"
        g._add_node(prov_node, "provider", prov.name, {"npi": prov.npi, "tax_id": prov.tax_id}, [prov.npi, prov.tax_id, prov.name])
        g._add_edge(member_node, prov_node, "SEEN_BY")

        if coverage:
            c = _row(coverage)
            cov_node = f"coverage:{mid}"
            label = f"{'Active' if c.get('active') else 'Inactive'} {c.get('plan_type') or m.get('plan_type') or ''}".strip()
            g._add_node(cov_node, "coverage", label or "Coverage", c, [c.get("group_number")])
            g._add_edge(member_node, cov_node, "HAS_COVERAGE")
            plan_type = c.get("plan_type") or m.get("plan_type")
            if plan_type:
                plan_node = f"plan:{plan_type}"
                g._add_node(plan_node, "plan", str(plan_type), {"plan_type": str(plan_type)}, [plan_type])
                g._add_edge(cov_node, plan_node, "ON_PLAN")

        for cl in claims or []:
            c = _row(cl)
            cid = str(c.get("claim_id"))
            claim_node = f"claim:{cid}"
            status = str(c.get("status") or "")
            label = f"Claim {cid} · {status}".strip()
            g._add_node(claim_node, "claim", label, c, [cid, c.get("cpt")])
            g._add_edge(member_node, claim_node, "HAS_CLAIM")
            g._add_edge(prov_node, claim_node, "SUBMITTED")
            carc = c.get("carc_code")
            if status == "DENIED" and carc:
                carc_node = f"carc:{carc}"
                g._add_node(carc_node, "carc", str(carc), {"carc_code": str(carc), "reason": c.get("denial_reason")}, [carc])
                g._add_edge(claim_node, carc_node, "DENIED_FOR")

        for au in prior_auths or []:
            a = _row(au)
            aid = str(a.get("auth_id"))
            auth_node = f"auth:{aid}"
            label = f"Auth {aid} · {a.get('status') or ''}".strip()
            g._add_node(auth_node, "auth", label, a, [aid, a.get("cpt")])
            g._add_edge(member_node, auth_node, "HAS_AUTH")

        return g

    @classmethod
    async def from_scenario(cls, scenario: Scenario) -> ContextGraph | None:
        """Build from the live DB, reusing the exact tables the tools read.
        Degrades to a scenario-only graph if the DB is unavailable."""
        from app.db import query  # local import keeps the module DB-free for tests

        mid = scenario.patient.member_id
        try:
            member = (await query("SELECT * FROM members WHERE member_id = $1", [mid]) or [None])[0]
            coverage = (await query("SELECT * FROM coverage WHERE member_id = $1", [mid]) or [None])[0]
            claims = await query("SELECT * FROM claims WHERE member_id = $1", [mid])
            prior_auths = await query("SELECT * FROM prior_auths WHERE member_id = $1", [mid])
        except Exception:  # noqa: BLE001 - degrade to a scenario-only graph when DB is down
            member = coverage = None
            claims = prior_auths = []
        return cls.build(scenario, member=member, coverage=coverage, claims=claims, prior_auths=prior_auths)

    def widen(self, type_: str, rows: list[dict[str, Any]]) -> None:
        """Fold rows surfaced by a tool mid-call into the graph (best-effort)."""
        for r in rows:
            c = _row(r)
            if type_ == "claim" and c.get("claim_id"):
                cid = str(c["claim_id"])
                node = f"claim:{cid}"
                self._add_node(node, "claim", f"Claim {cid} · {c.get('status') or ''}".strip(), c, [cid, c.get("cpt")])
                member_node = f"member:{self.focus.get('member')}"
                self._add_edge(member_node, node, "HAS_CLAIM")

    def note(self, label: str, value: str = "", *, kind: str = "note", relates_to: str | None = None) -> str | None:
        """Record a fact the agent learned ON THE CALL as a conversational node —
        the rep's name, a reference/confirmation number, a verbal determination, a
        callback. Unlike the FK-derived record nodes, these are written live by the
        agent (via the `note_fact` tool); they're anchored to the member (or an
        explicit node), surfaced back in later grounding so the agent can refer to
        them, and rendered distinctly in the viz. Returns the new node id."""
        label = (label or "").strip()
        value = (value or "").strip()
        if not label and not value:
            return None
        self._note_seq += 1
        nid = f"note:{self._note_seq}"
        disp = f"{label}: {value}" if (label and value) else (value or label)
        self._add_node(
            nid, "note", disp[:60], {"label": label, "value": value, "kind": kind}, [value, label]
        )
        anchor = relates_to if (relates_to and relates_to in self._nodes) else f"member:{self.focus.get('member')}"
        if anchor in self._nodes:
            self._add_edge(anchor, nid, "NOTED")
        return nid

    # -- retrieval -----------------------------------------------------------

    def _seed(self, transcript: str) -> dict[str, float]:
        """Pick seed nodes: always-known focus entities + any node whose id/code/
        name token appears in the recent transcript. Exact-token only (never a
        loose name match) so we cannot seed the wrong member's PHI."""
        seeds: dict[str, float] = {}
        # always-known focus
        for key, weight in (("member", 1.0), ("claim", 1.0), ("auth", 1.0), ("provider", 0.7)):
            fid = self.focus.get(key)
            if not fid:
                continue
            node_id = f"{key}:{fid}"
            if node_id in self._nodes:
                seeds[node_id] = max(seeds.get(node_id, 0), weight)

        text = (transcript or "").lower()
        if text:
            for node_id, node in self._nodes.items():
                for tok in node.tokens:
                    if len(tok) >= 3 and re.search(r"(?<![a-z0-9])" + re.escape(tok) + r"(?![a-z0-9])", text):
                        seeds[node_id] = max(seeds.get(node_id, 0), 0.95)
                        break
        if not seeds and self._nodes:
            # fall back to the focal member so we always return something
            mn = f"member:{self.focus.get('member')}"
            if mn in self._nodes:
                seeds[mn] = 1.0
        return seeds

    def _field_bonus_types(self, missing_fields: list[str]) -> set[str]:
        types: set[str] = set()
        for f in missing_fields or []:
            fl = f.lower()
            for keywords, node_type in FIELD_NODE_HINTS:
                if any(k in fl for k in keywords):
                    types.add(node_type)
        return types

    def retrieve(
        self,
        transcript: str,
        *,
        missing_fields: list[str] | None = None,
        intent: str | None = None,
    ) -> tuple[Subgraph, str]:
        """Return the full graph (as a Subgraph backdrop, lit where retrieved)
        plus the serialized context string to inject into the agent prompt."""
        intent = intent or self.category
        max_hops = DENIAL_HOPS if intent == "claim-status" else DEFAULT_HOPS
        priority = TYPE_PRIORITY.get(intent, {})
        bonus_types = self._field_bonus_types(missing_fields or [])

        seeds = self._seed(transcript)
        # weighted BFS — best score per node by path product * decay^hops
        best: dict[str, float] = dict(seeds)
        hop_of: dict[str, int] = {s: 0 for s in seeds}
        q: deque[str] = deque(seeds.keys())
        while q:
            cur = q.popleft()
            h = hop_of[cur]
            if h >= max_hops:
                continue
            for neighbor, label in self._adj.get(cur, []):
                w = EDGE_WEIGHTS.get(label, 0.5)
                cand = best[cur] * w * DECAY
                if cand > best.get(neighbor, 0) + 1e-9:
                    best[neighbor] = cand
                    hop_of[neighbor] = h + 1
                    q.append(neighbor)

        # apply intent priority + missing-field bonus
        scored: dict[str, float] = {}
        for node_id, base in best.items():
            node = self._nodes[node_id]
            s = base * priority.get(node.type, 1.0)
            if node.type in bonus_types:
                s += 0.3
            scored[node_id] = s

        # force-include focus nodes even if scored low
        for key in ("member", "claim", "auth"):
            fid = self.focus.get(key)
            if fid:
                nid = f"{key}:{fid}"
                if nid in self._nodes:
                    scored.setdefault(nid, 0.2)
                    scored[nid] = max(scored[nid], 0.2)

        # ALWAYS surface what the agent recorded on the call — these conversational
        # notes are the agent's working memory, ranked above ordinary records so the
        # budget never drops them ("record + look back").
        for node_id, node in self._nodes.items():
            if node.type == "note":
                scored[node_id] = max(scored.get(node_id, 0.0), 0.85)

        lit = {nid for nid, s in scored.items() if s >= MIN_SCORE}

        # budget the serialized context by score (force focus first)
        ordered = sorted(lit, key=lambda n: (-scored[n], n))
        context = self._serialize(ordered)

        subgraph = self._to_subgraph(scored, hop_of, seeds, lit, context, max_hops)
        return subgraph, context

    def _serialize(self, ordered_node_ids: list[str]) -> str:
        lines: list[str] = []
        used = 0
        for nid in ordered_node_ids:
            line = self._fact_line(self._nodes[nid])
            if not line:
                continue
            if used + len(line) > BUDGET_CHARS:
                break
            lines.append(line)
            used += len(line)
        return "\n".join(lines)

    def _fact_line(self, node: _Node) -> str:
        a = node.attrs
        if node.type == "member":
            return f"MEMBER {a.get('member_id')} — {a.get('name')}, {a.get('payer')} {a.get('plan_type') or ''} (group {a.get('group_number') or 'n/a'})."
        if node.type == "coverage":
            return (
                f"COVERAGE — {'active' if a.get('active') else 'inactive'}; PCP copay ${a.get('copay_pcp')}, "
                f"specialist ${a.get('copay_spec')}; deductible ${a.get('deductible_met')}/${a.get('deductible_total')} met; "
                f"OOP ${a.get('oop_met')}/${a.get('oop_max')}."
            )
        if node.type == "plan":
            return f"PLAN — {a.get('plan_type')}."
        if node.type == "claim":
            base = f"CLAIM {a.get('claim_id')} — {a.get('status')}, DOS {a.get('dos')}, CPT {a.get('cpt')}, billed ${a.get('billed_amount')}."
            if a.get("status") == "DENIED":
                base += f" {a.get('carc_code')}: {a.get('denial_reason')} Resubmission: {a.get('resubmission_path')} (timely filing {a.get('timely_filing_deadline')})."
            return base
        if node.type == "carc":
            return f"DENIAL CODE {a.get('carc_code')} — {a.get('reason')}."
        if node.type == "auth":
            return (
                f"PRIOR AUTH {a.get('auth_id')} — {a.get('status')}, CPT {a.get('cpt')}; "
                f"criteria {'unmet' if a.get('clinical_criteria_unmet') else 'met'}; determination: {a.get('determination') or 'pending'}."
            )
        if node.type == "provider":
            return f"PROVIDER {a.get('npi')} — {node.label} (tax id {a.get('tax_id')})."
        if node.type == "payer":
            return f"PAYER {a.get('payer_id')} — {node.label}."
        if node.type == "note":
            lbl = a.get("label") or "note"
            val = a.get("value")
            return f"NOTED ON CALL — {lbl}: {val}." if val else f"NOTED ON CALL — {lbl}."
        return ""

    def _to_subgraph(
        self,
        scored: dict[str, float],
        hop_of: dict[str, int],
        seeds: dict[str, float],
        lit: set[str],
        context: str,
        max_hops: int,
    ) -> Subgraph:
        nodes = [
            GraphNode(
                id=n.id,
                type=n.type,
                label=n.label,
                score=round(scored.get(n.id, 0.0), 4),
                lit=n.id in lit,
                seed=n.id in seeds,
                hops=hop_of.get(n.id),
                attrs=n.attrs,
            )
            for n in self._nodes.values()
        ]
        edges = [
            GraphEdge(
                source=e.source,
                target=e.target,
                label=e.label,
                weight=EDGE_WEIGHTS.get(e.label, 0.5),
                lit=(e.source in lit and e.target in lit),
            )
            for e in self._edges
        ]
        return Subgraph(nodes=nodes, edges=edges, seeds=list(seeds.keys()), context=context, hops=max_hops)

    def all_facts(self) -> list[str]:
        """Every node's fact line — a human-readable cheat sheet of what's on file.
        Used to build the payer rep's role card in text role-play."""
        return [line for n in self._nodes.values() if (line := self._fact_line(n))]

    def fact_for(self, node_id: str) -> str:
        """Serialized fact line for a single node id ("" if unknown). Lets the
        live bridge fold an *anticipated* record into the agent's grounding even
        when ordinary retrieval hasn't lit it yet."""
        node = self._nodes.get(node_id)
        return self._fact_line(node) if node else ""

    def signature(self) -> str:
        """Stable id list for delta-detection of the lit subgraph."""
        return ",".join(sorted(self._nodes.keys()))
