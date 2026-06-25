"""Hash-chain parity with the original TypeScript `src/lib/hash.ts`.

The reference values were produced by running the original JS implementation; the
chain MUST match byte-for-byte because the Next.js frontend re-verifies it.
"""
from __future__ import annotations

from app.audit.ledger import audit_canonical, verify_ledger
from app.core.hash import GENESIS_HASH, chain_hash, cyrb53, digest_hex


def test_cyrb53_matches_reference():
    assert cyrb53("hello") == 4625896200565286
    assert cyrb53("hello", 7) == 5198064567490728


def test_digest_hex_matches_reference():
    assert digest_hex("abc") == "0ff0af160c97e20a64320c9e1b4c1099588f6f15341c596fda06dc3a"
    # Unicode (em dash / ellipsis) must hash identically to the JS UTF-16 path.
    assert digest_hex("turn —…done") == "05726bc774630f146d43f8505f5b1fc1a3a82c016706064d379c97ed"


def test_chain_hash_matches_reference():
    payload = "0|call.start|0|operator|hi||0||none|model|v1"
    assert chain_hash(GENESIS_HASH, payload) == "11dcdfb4d4163215bb6a562cfe3612e01015a1a30a0b9e7d2b427ac4"


def test_audit_canonical_field_order():
    e = {"seq": 2, "type": "tool.call", "atMs": 1500, "actor": "agent", "summary": "x", "tool": "verify_claim", "phi": True, "phiScope": "member:***1234", "redaction": "tokenized", "model": "m", "promptVersion": "v"}
    assert audit_canonical(e) == "2|tool.call|1500|agent|x|verify_claim|1|member:***1234|tokenized|m|v"


def test_verify_ledger_roundtrip():
    events = []
    prev = GENESIS_HASH
    for i, summary in enumerate(["open", "start", "lookup"]):
        base = {"seq": i, "type": "model.invoke", "atMs": i * 100, "actor": "agent", "summary": summary, "tool": None, "phi": False, "phiScope": None, "redaction": "none", "model": None, "promptVersion": None}
        h = chain_hash(prev, audit_canonical(base))
        events.append({**base, "hash": h, "prevHash": prev})
        prev = h
    assert verify_ledger(events) is True
    # Tamper with one summary → chain breaks.
    events[1]["summary"] = "tampered"
    assert verify_ledger(events) is False
