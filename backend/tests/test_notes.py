"""Deterministic conversational-fact extraction → graph notes."""
from __future__ import annotations

from app.agent.notes import extract_notes
from app.simulation.scenarios import SCENARIOS


def _scn(sid: str):
    return next(s for s in SCENARIOS if s.id == sid)


def test_captures_rep_name_from_payer_turn():
    s = _scn("elig-aetna")
    notes = extract_notes("Hi, my name is Christopher Nielson. How can I help?", "payer", s)
    assert ("Rep name", "Christopher Nielson") in notes


def test_does_not_capture_name_from_agent_turn():
    s = _scn("elig-aetna")
    # The agent's "this is <practice>" is the provider, not a rep — never a note.
    assert extract_notes("Hi, this is Cedar Valley Internal Medicine.", "agent", s) == []


def test_skips_payer_and_provider_names():
    s = _scn("elig-aetna")
    assert extract_notes(f"This is {s.payer}, how can I help?", "payer", s) == []


def test_captures_reference_numbers_either_side():
    s = _scn("claim-uhc")
    notes = extract_notes("Your reference number is REF-99812 for this call.", "payer", s)
    assert ("Reference #", "REF-99812") in notes
    # Agent side can surface a confirmation too.
    agent = extract_notes("Got it — confirmation #ABC1234.", "agent", s)
    assert ("Confirmation #", "ABC1234") in agent


def test_empty_and_plain_turns_yield_nothing():
    s = _scn("elig-aetna")
    assert extract_notes("", "payer", s) == []
    assert extract_notes("Sure, let me pull that up for you.", "payer", s) == []
