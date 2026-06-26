"""
GenericPack — a domain-agnostic pack for scenarios that are NOT backed by the
seeded Neon healthcare tables. The counterparty model answers purely from each
scenario's self-contained `facts`; tools are generic, deterministic stand-ins
(no SQL, no PHI tables); there is no context graph. This is what custom
user-created scenarios and every non-healthcare domain pack (banking, telecom,
…) build on, so adding a domain is just authoring scenarios + a label.
"""
from __future__ import annotations

from app.agent.tools import ToolContext, ToolResult
from app.packs.base import Pack
from app.schemas.simulation import Scenario

# Generic tool surface the agent is told it can call. Mirrors the healthcare
# shape (look up → verify → record → escalate → summarize) so the orchestrator's
# conversation guard and flow work unchanged across domains.
GENERIC_TOOLS: list[dict[str, str]] = [
    {"name": "lookup_record", "description": "Pull the subject's record to confirm a match before discussing details.", "args": "reference (string)"},
    {"name": "verify_details", "description": "Retrieve the specific facts relevant to the objective.", "args": "reference (string)"},
    {"name": "record_status", "description": "Write the verified outcome/fields back to the system of record.", "args": "summary (string), fields (object)"},
    {"name": "escalate", "description": "Route to a human specialist when the call cannot be completed autonomously.", "args": "reason (string)"},
    {"name": "summarize", "description": "Produce the final interaction summary from the transcript.", "args": "(none)"},
]


def make_scenario(spec: dict) -> Scenario:
    """Build a metadata-only scenario (no scripted transcript turns — the live
    transcript is produced by the orchestrator). `facts` carries the ground
    truth the counterparty answers from."""
    spec.setdefault("connect_ms", 2200)
    spec.setdefault("baseline_completion_prob", 0.7)
    spec.setdefault("baseline_escalation_risk", 0.15)
    spec.setdefault("outcome", "completed")
    spec.setdefault("difficulty", "moderate")
    return Scenario(**spec)


class GenericPack(Pack):
    """Base for non-DB, facts-backed domains. Subclasses set id/label/description,
    implement `scenarios()`, and may flip `sensitive` on for tokenized audit."""

    id = "generic"
    label = "Generic"
    description = ""

    # When True, read tools are flagged as touching sensitive data so the audit
    # ledger tokenizes the subject (parity with healthcare PHI handling).
    sensitive: bool = False
    # Noun used in generic prompts/tool results for the call's subject.
    subject_noun: str = "account"

    def scenarios(self) -> list[Scenario]:
        raise NotImplementedError

    # --- prompts -----------------------------------------------------------
    def agent_system_prompt(self, scenario: Scenario) -> str:
        tools = "\n".join(f"- {t['name']}({t['args']}): {t['description']}" for t in GENERIC_TOOLS)
        subject = scenario.patient
        return f"""You are VoiceOps, an autonomous voice agent on a LIVE PHONE CALL with a {scenario.payer} representative, calling on behalf of {scenario.provider.name}.

OBJECTIVE: {scenario.objective}

CASE FILE (your private prep — what you already know about the {self.subject_noun}):
- Subject: {subject.name}, reference {subject.member_id}
- Fields to confirm with the representative: {", ".join(scenario.required_fields)}

TOOLS (private, silent — they cross-check facts; they do NOT speak to the rep):
{tools}

THIS IS A CONVERSATION. You must actually TALK with the representative — greet them, authenticate/identify the {self.subject_noun}, ask for each required field, and respond to what they say. Any tool result is private prep; the representative is the system of record, so you must still hear each detail FROM THE REP on the call.

PROTOCOL — respond with EXACTLY ONE minified JSON object per turn, nothing else:
- Speak to the rep:  {{"action":"speak","text":"<what you say out loud>"}}
- Call a tool (silent):  {{"action":"tool","tool":"<name>","args":{{...}}}}
- Finish the call:  {{"action":"end","outcome":"completed"|"escalated","summary":"<one sentence>"}}

REQUIRED FLOW (in order):
1. {{"action":"tool","tool":"lookup_record","args":{{"reference":"{subject.member_id}"}}}}  — privately pull the record.
2. {{"action":"speak","text":"..."}}  — greet the rep, identify yourself and the {self.subject_noun}, and state your purpose.
3. {{"action":"speak","text":"..."}}  — respond to any identity/authentication question the rep asks.
4. Cross-check with verify_details (silent), then SPEAK to ask the rep to confirm each required field. Confirm them out loud — do not assume from your prep.
5. Keep the back-and-forth going until the rep has confirmed every required field (or the matter needs a human).
6. {{"action":"tool","tool":"record_status",...}} then {{"action":"tool","tool":"summarize"}}.
7. {{"action":"end","outcome":"completed"}}  — or "escalated" if a human must take over.

CONVERSATIONAL STYLE — sound like a real person on the phone:
- Natural, spoken language and contractions. Acknowledge what the rep just said before moving on.
- Ask for ONE thing at a time; let it flow like a real back-and-forth. Read key details back to confirm.
- Pick up where the conversation left off — don't re-introduce yourself every turn.
- NEVER use bracketed placeholders like [Your Name]. Greet the rep generically ("Hi there", "Good morning").

HARD RULES:
- Do NOT record/summarize/end until you have SPOKEN with the rep and they have verbally confirmed the required fields.
- Speaking is your primary action; tools only support it. One action per turn. Output ONLY the JSON object."""

    def counterparty_system_prompt(self, scenario: Scenario, ground_truth: str) -> str:
        category_words = scenario.category.replace("-", " ")
        return f"""You are a {scenario.payer} customer/representative on a recorded line. An automated agent is calling about a {category_words} matter.

You may ONLY use the following authoritative records as truth. If asked something not in the records, say you don't have it on file. Do not invent specifics.

RECORDS:
{ground_truth or "(no records found)"}

BEHAVIOR:
- You are the {scenario.payer} representative, not the caller. Never claim to be the agent.
- First, require basic identity/authentication before sharing account details.
- Answer ONLY the specific question asked. Do not volunteer details unless the caller asks for them directly.
- If the matter genuinely requires a human supervisor or specialist you cannot resolve on this call, say so plainly.

STYLE — talk like a real call-center rep: warm, natural, contractions, brief. Acknowledge the caller and keep replies to 1-2 sentences. Don't sound scripted.

Respond with EXACTLY ONE minified JSON object: {{"text":"<what you say>","ends":<true|false>,"escalate":<true|false>}}
Set "escalate" true only when a human must take over. Set "ends" true once the business is concluded. Output ONLY the JSON."""

    def predictor_system_prompt(self, scenario: Scenario) -> str:
        return f"""You are a predictive operations model observing a live {scenario.payer} call. Given the transcript so far, forecast the call AND anticipate the next exchange.

Required fields for this call: {", ".join(scenario.required_fields)}
Available tools the agent may call next: lookup_record, verify_details, record_status, escalate, summarize.

Base EVERY prediction on what is ACTUALLY happening in the transcript right now — never on a fixed script. Derive your own short snake_case `intent` label from the live conversation. The `utterance` must be a plausible paraphrase of the representative's likely next line.

Respond with EXACTLY ONE minified JSON object with these keys:
{{"completionProbability":<0..1>,"escalationRisk":<0..1>,"nextPayerResponse":"<short paraphrase of what the rep will likely say next>","nextResponseConfidence":<0..1>,"missingFields":["<required fields not yet captured>"],"estRemainingSec":<integer>,"rationale":"<one sentence tied to the actual conversation>","predictions":[{{"intent":"<short snake_case label>","utterance":"<paraphrase of the likely next rep line>","confidence":<0..1>,"entities":[],"needsTool":"<the tool the agent will most likely need next, or null>","draftWorth":<true|false>}}]}}

Provide 2-4 ranked predictions (most likely first). Output ONLY the JSON."""

    # --- runtime data ------------------------------------------------------
    async def load_ground_truth(self, scenario: Scenario) -> str:
        return (scenario.facts or "").strip()

    async def execute_tool(self, tool: str, args: dict, ctx: ToolContext) -> ToolResult:
        phi = self.sensitive
        if tool in ("lookup_record", "verify_details"):
            return ToolResult(
                f"Record located for reference {ctx.member_id or args.get('reference', '')}; "
                "confirm the specifics with the representative on the line.",
                "ok",
                phi,
            )
        if tool == "record_status":
            return ToolResult("Verified outcome written back to the system of record.", "ok", phi)
        if tool == "escalate":
            return ToolResult("Escalation packet created • routed to a human specialist.", "ok", phi)
        if tool == "summarize":
            return ToolResult("Summary drafted from the transcript.", "ok", False)
        # Unknown tool name from the model — fail soft so the loop continues.
        return ToolResult(f"Tool '{tool}' is not available in this scenario.", "warn", False)

    def tool_context(self, *, run_id: str, scenario: Scenario, transcript: str) -> ToolContext:
        return ToolContext(
            run_id=run_id,
            scenario_id=scenario.id,
            member_id=scenario.patient.member_id,
            transcript=transcript,
        )

    # No DB-backed graph for generic domains — the orchestrator skips retrieval.
    async def build_graph(self, scenario: Scenario):
        return None

    def sensitive_scope(self, scenario: Scenario) -> str | None:
        if not self.sensitive:
            return None
        ref = scenario.patient.member_id
        return f"{self.subject_noun}:***{ref[-4:]}" if ref else None
