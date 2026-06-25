"""Balanced-brace JSON extraction, ported from `extractJson` in localLLM.ts."""
from __future__ import annotations

from app.llm.local_llm import extract_json


def test_extracts_plain_object():
    assert extract_json('{"action":"speak","text":"hi"}') == {"action": "speak", "text": "hi"}


def test_strips_code_fences():
    assert extract_json('```json\n{"a":1}\n```') == {"a": 1}


def test_finds_first_object_amid_prose():
    assert extract_json('Sure! Here you go: {"x": 2} done') == {"x": 2}


def test_handles_nested_and_strings_with_braces():
    raw = '{"outer":{"inner":1},"note":"a } in a string"}'
    assert extract_json(raw) == {"outer": {"inner": 1}, "note": "a } in a string"}


def test_returns_none_on_garbage():
    assert extract_json("no json here") is None
    assert extract_json("") is None


def test_returns_none_on_unbalanced():
    assert extract_json('{"a": 1') is None
