"""
System prompts + ground-truth loading for the real multi-agent call. Ported from
`src/lib/agent/personas.ts`. The PAYER model only knows what the database says
(loaded here), so its answers stay consistent with what the agent's tools can
independently verify.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from app.agent.tools import TOOL_CATALOG
from app.db import query
from app.schemas.simulation import Scenario


@dataclass
class GroundTruth:
    member: dict[str, Any] | None
    coverage: dict[str, Any] | None
    claim: dict[str, Any] | None
    prior_auth: dict[str, Any] | None
    text: str


async def load_ground_truth(scenario: Scenario) -> GroundTruth:
    member_id = scenario.patient.member_id
    member = (await query("SELECT * FROM members WHERE member_id = $1", [member_id]) or [None])[0]
    coverage = (await query("SELECT * FROM coverage WHERE member_id = $1", [member_id]) or [None])[0]

    claim: dict[str, Any] | None = None
    prior_auth: dict[str, Any] | None = None
    if scenario.category == "claim-status" and scenario.claim:
        claim = (await query("SELECT * FROM claims WHERE claim_id = $1", [scenario.claim.id]) or [None])[0]
    if scenario.category == "prior-auth" and scenario.claim:
        prior_auth = (await query("SELECT * FROM prior_auths WHERE auth_id = $1", [scenario.claim.id]) or [None])[0]

    lines: list[str] = []
    if member:
        lines.append(f"MEMBER: {json.dumps(member, default=str)}")
    if coverage:
        lines.append(f"COVERAGE: {json.dumps(coverage, default=str)}")
    if claim:
        lines.append(f"CLAIM: {json.dumps(claim, default=str)}")
    if prior_auth:
        lines.append(f"PRIOR_AUTH: {json.dumps(prior_auth, default=str)}")

    return GroundTruth(member, coverage, claim, prior_auth, "\n".join(lines))


def agent_system_prompt(scenario: Scenario) -> str:
    tools = "\n".join(f"- {t['name']}({t['args']}): {t['description']}" for t in TOOL_CATALOG)
    claim_line = (
        f"- Claim/Auth: {scenario.claim.id}, DOS {scenario.claim.dos}, CPT {scenario.claim.cpt}"
        if scenario.claim
        else ""
    )
    if scenario.category == "claim-status":
        step2 = f'{{"action":"tool","tool":"verify_claim","args":{{"claim_id":"{scenario.claim.id if scenario.claim else ""}"}}}}'
    elif scenario.category == "prior-auth":
        step2 = f'{{"action":"tool","tool":"verify_eligibility","args":{{"auth_id":"{scenario.claim.id if scenario.claim else ""}"}}}}'
    else:
        step2 = f'{{"action":"tool","tool":"verify_eligibility","args":{{"member_id":"{scenario.patient.member_id}"}}}}'

    return f"""You are VoiceOps, an autonomous healthcare administrative voice agent. You are calling {scenario.payer} ({scenario.payer_id}) provider services on behalf of {scenario.provider.name} (NPI {scenario.provider.npi}).

OBJECTIVE: {scenario.objective}

CASE FILE:
- Patient: {scenario.patient.name}, member {scenario.patient.member_id}, DOB {scenario.patient.dob}
{claim_line}
- Required fields to capture: {", ".join(scenario.required_fields)}

TOOLS (you must call tools to obtain facts — never invent coverage, claim, or auth details):
{tools}

PROTOCOL — respond with EXACTLY ONE minified JSON object per turn, nothing else:
- To call a tool:  {{"action":"tool","tool":"<name>","args":{{...}}}}
- To speak to the payer rep:  {{"action":"speak","text":"<what you say>"}}
- To finish the call:  {{"action":"end","outcome":"completed"|"escalated","summary":"<one sentence>"}}

REQUIRED PROCEDURE (follow in order):
1. FIRST action MUST be a tool call: {{"action":"tool","tool":"lookup_patient","args":{{"member_id":"{scenario.patient.member_id}"}}}}
2. Then verify the case with a tool: {step2}
3. Speak with the payer to confirm/obtain remaining required fields. Do NOT accept the payer's claims blindly — your tool results are the source of truth.
4. When required fields are captured: {{"action":"tool","tool":"record_status",...}} then {{"action":"tool","tool":"summarize"}}.
5. End: {{"action":"end","outcome":"completed"}} — or "escalated" if a peer-to-peer/human review is required.

RULES:
- You MUST call lookup_patient and a verify_* tool before speaking any coverage/claim/auth fact.
- Be concise and professional, like a seasoned provider-services caller. One action per turn.
- Output ONLY the JSON object. No prose, no markdown."""


def payer_system_prompt(scenario: Scenario, ground_truth: str) -> str:
    category_words = scenario.category.replace("-", " ")
    return f"""You are a {scenario.payer} provider-services representative on a recorded line. A provider's automated agent is calling about a {category_words} matter.

You may ONLY use the following authoritative records as truth. If asked something not in the records, say you don't have it on file. Do not invent specifics.

RECORDS:
{ground_truth or "(no records found)"}

BEHAVIOR:
- You are the PAYER representative, not the caller. Never claim to be the provider's agent.
- First, require authentication: ask for the provider's tax ID or NPI before sharing any member details.
- Answer ONLY the specific question asked. Do NOT volunteer the denial reason, deadlines, copays, or other specifics unless the caller asks for them directly.
- If a prior auth is PENDING with unmet clinical criteria, explain that a peer-to-peer review with the medical director is required and you cannot change the determination on this call.
- For a denied claim, give the denial reason and corrected-claim path only when asked.
- Keep replies to 1-2 sentences, conversational.

Respond with EXACTLY ONE minified JSON object: {{"text":"<what you say>","ends":<true|false>,"escalate":<true|false>}}
Set "escalate" true only when a human peer-to-peer is required. Set "ends" true once the business is concluded. Output ONLY the JSON."""


def predictor_system_prompt(scenario: Scenario) -> str:
    return f"""You are a predictive operations model observing a live healthcare payer call. Given the transcript so far, forecast the call.

Required fields for this call: {", ".join(scenario.required_fields)}

Respond with EXACTLY ONE minified JSON object:
{{"completionProbability":<0..1>,"escalationRisk":<0..1>,"nextPayerResponse":"<short paraphrase of what the payer will likely say next>","nextResponseConfidence":<0..1>,"missingFields":["<required fields not yet captured>"],"estRemainingSec":<integer>,"rationale":"<one sentence>"}}
Output ONLY the JSON."""
