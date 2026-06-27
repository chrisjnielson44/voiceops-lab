"""
Scenario library, ported from `src/lib/simulation/scenarios.ts`. Each scenario
carries the case metadata the live orchestrator needs (payer, patient, claim,
required fields) plus the hand-authored transcript turns the cockpit renders.
The assembler turns the authoring shape into absolute turn timings.
"""
from __future__ import annotations

from typing import Any

from app.schemas.simulation import Scenario, TranscriptTurn


def _assemble(spec: dict[str, Any]) -> Scenario:
    cursor = spec["connect_ms"]
    raw_turns: list[dict[str, Any]] = spec.pop("raw_turns")
    turns: list[TranscriptTurn] = []
    for index, raw in enumerate(raw_turns):
        at_ms = cursor
        end_ms = at_ms + raw["duration_ms"]
        cursor = end_ms
        turns.append(
            TranscriptTurn(
                id=f"{spec['id']}-t{index}",
                index=index,
                at_ms=at_ms,
                end_ms=end_ms,
                **raw,
            )
        )
    return Scenario(**spec, turns=turns, total_duration_ms=cursor)


_ELIGIBILITY_AETNA = _assemble(
    {
        "id": "elig-aetna",
        "title": "Eligibility & benefits verification",
        "payer": "Aetna",
        "payer_id": "AET-114",
        "category": "eligibility",
        "difficulty": "routine",
        "outcome": "completed",
        "objective": "Confirm active coverage and capture copay, deductible, and out-of-pocket accumulators for an office visit.",
        "patient": {"name": "Maria Alvarez", "member_id": "W2049-88147", "dob": "1984-03-22"},
        "provider": {"name": "Cedar Valley Internal Medicine", "npi": "1346279805", "tax_id": "84-2210037"},
        "baseline_completion_prob": 0.78,
        "baseline_escalation_risk": 0.08,
        "required_fields": ["member_id", "dob", "group_number", "plan_type", "copay", "deductible_met"],
        "connect_ms": 2200,
        "raw_turns": [
            {"speaker": "ivr", "text": "Thank you for calling Aetna provider services. Para español, marque nueve. Please say or enter the member ID.", "duration_ms": 5200, "intent": "ivr-greeting"},
            {"speaker": "agent", "text": "Provider services, please. Member ID Whiskey-two-zero-four-nine, dash, eight-eight-one-four-seven.", "duration_ms": 4200, "intent": "ivr-navigate"},
            {"speaker": "agent", "text": "Looking up the member record before the representative connects.", "duration_ms": 1600, "tool": {"tool": "lookup_patient", "label": "lookup_patient", "args": {"member_id": "W2049-88147", "dob": "1984-03-22"}, "result": "1 match — Maria Alvarez, plan active", "status": "ok", "latency_ms": 240, "phi": True}, "satisfies": ["member_id", "dob"], "phi": True, "intent": "tool-lookup"},
            {"speaker": "payer", "text": "This is Denise with Aetna provider services. Who am I speaking with and what's the tax ID on file?", "duration_ms": 4600, "forecast": "Rep answers and asks to authenticate the provider (tax ID / NPI).", "forecast_confidence": 0.82, "predict": {"completion_probability": 0.8, "escalation_risk": 0.07, "rationale": "Standard authentication; member matched cleanly on first pass."}, "intent": "authenticate"},
            {"speaker": "agent", "text": "This is the automated assistant for Cedar Valley Internal Medicine, NPI 1346279805, tax ID 84-2210037, calling on a verified line.", "duration_ms": 4800, "satisfies": ["group_number"], "intent": "authenticate"},
            {"speaker": "payer", "text": "Thanks, you're verified. The member is active on an Open Access PPO, group 7741-A, effective January first.", "duration_ms": 5200, "forecast": "Rep confirms active coverage and names the plan type / group number.", "forecast_confidence": 0.79, "predict": {"completion_probability": 0.86, "escalation_risk": 0.05, "rationale": "Coverage active; plan type captured. No conflicting other-coverage flags."}, "satisfies": ["plan_type"], "intent": "coverage"},
            {"speaker": "agent", "text": "Verifying active eligibility for date of service today and pulling benefit accumulators.", "duration_ms": 1800, "tool": {"tool": "verify_eligibility", "label": "verify_eligibility", "args": {"plan": "Open Access PPO", "group": "7741-A", "dos": "2026-06-23"}, "result": "Active • PCP copay $25 • deductible $1,500 (met $640)", "status": "ok", "latency_ms": 410, "phi": True}, "satisfies": ["copay"], "phi": True, "intent": "tool-eligibility"},
            {"speaker": "agent", "text": "Can you confirm the specialist copay and how much of the individual deductible has been met year-to-date?", "duration_ms": 4400, "intent": "benefits"},
            {"speaker": "payer", "text": "Specialist copay is forty dollars. Individual deductible is fifteen hundred, with six hundred forty applied so far.", "duration_ms": 5400, "forecast": "Rep reads specialist copay and deductible-met amount.", "forecast_confidence": 0.84, "predict": {"completion_probability": 0.93, "escalation_risk": 0.04, "rationale": "All benefit fields obtained; only confirmation and reference number remain."}, "satisfies": ["deductible_met"], "intent": "benefits"},
            {"speaker": "agent", "text": "Recording the verified benefits to the patient account.", "duration_ms": 1500, "tool": {"tool": "record_status", "label": "record_status", "args": {"copay_pcp": "$25", "copay_spec": "$40", "deductible_met": "$640/$1500"}, "result": "Benefits written to EHR encounter", "status": "ok", "latency_ms": 300, "phi": True}, "phi": True, "intent": "tool-record"},
            {"speaker": "payer", "text": "Your call reference number is A as in apple, 5-5-2-9-0-3-1.", "duration_ms": 4200, "forecast": "Rep provides a call reference number for the interaction.", "forecast_confidence": 0.7, "intent": "reference"},
            {"speaker": "agent", "text": "Summarizing the verified eligibility and benefits for the encounter note.", "duration_ms": 1700, "tool": {"tool": "summarize", "label": "summarize", "args": {"ref": "A5529031", "outcome": "eligibility_confirmed"}, "result": "Summary drafted • 6/6 required fields captured", "status": "ok", "latency_ms": 520, "phi": False}, "predict": {"completion_probability": 0.98, "escalation_risk": 0.02, "rationale": "All required fields captured and written back; call complete."}, "intent": "tool-summarize"},
            {"speaker": "system", "text": "Call objective met — eligibility confirmed, benefits recorded, reference A5529031 stored.", "duration_ms": 2600, "intent": "complete"},
        ],
    }
)

_CLAIM_UHC = _assemble(
    {
        "id": "claim-uhc",
        "title": "Denied claim status follow-up",
        "payer": "UnitedHealthcare",
        "payer_id": "UHC-208",
        "category": "claim-status",
        "difficulty": "moderate",
        "outcome": "completed",
        "objective": "Determine why claim 4471-A was denied and capture the corrected-claim resubmission path and timely-filing window.",
        "patient": {"name": "James Whitfield", "member_id": "UHG-553-22019", "dob": "1971-11-09"},
        "provider": {"name": "Cedar Valley Internal Medicine", "npi": "1346279805", "tax_id": "84-2210037"},
        "claim": {"id": "4471-A", "dos": "2026-04-18", "amount": 432.0, "cpt": "99214"},
        "baseline_completion_prob": 0.62,
        "baseline_escalation_risk": 0.22,
        "required_fields": ["claim_id", "dos", "billed_amount", "claim_status", "denial_reason", "resubmission_path"],
        "connect_ms": 2400,
        "raw_turns": [
            {"speaker": "ivr", "text": "UnitedHealthcare provider line. Say 'claims' for claim status, 'eligibility' for benefits.", "duration_ms": 4400, "intent": "ivr-greeting"},
            {"speaker": "agent", "text": "Claims.", "duration_ms": 1400, "intent": "ivr-navigate"},
            {"speaker": "agent", "text": "Pulling the claim and member context before the rep connects.", "duration_ms": 1700, "tool": {"tool": "lookup_patient", "label": "lookup_patient", "args": {"member_id": "UHG-553-22019", "claim_id": "4471-A"}, "result": "Member matched • claim 4471-A found (status: denied)", "status": "ok", "latency_ms": 260, "phi": True}, "satisfies": ["claim_id", "member_id"], "phi": True, "intent": "tool-lookup"},
            {"speaker": "payer", "text": "Claims department, this is Marcus. Can I get the member ID, claim number, and date of service?", "duration_ms": 5000, "forecast": "Rep authenticates and asks for member ID, claim number, and DOS.", "forecast_confidence": 0.85, "predict": {"completion_probability": 0.64, "escalation_risk": 0.2, "rationale": "Denied claim — outcome depends on whether denial reason is correctable."}, "intent": "authenticate"},
            {"speaker": "agent", "text": "Member UHG-553-22019, claim 4471-A, date of service April eighteenth, billed at four thirty-two for a 99214.", "duration_ms": 5200, "satisfies": ["dos", "billed_amount"], "phi": True, "intent": "claim-context"},
            {"speaker": "agent", "text": "Verifying current claim status and adjudication detail.", "duration_ms": 1800, "tool": {"tool": "verify_claim", "label": "verify_claim", "args": {"claim_id": "4471-A", "dos": "2026-04-18"}, "result": "DENIED • CARC 16 — missing/incomplete information", "status": "warn", "latency_ms": 480, "phi": True}, "satisfies": ["claim_status"], "phi": True, "compliance": "Denial reason retrieved; verify against remittance before advising resubmission.", "intent": "tool-claim"},
            {"speaker": "payer", "text": "That one denied April twenty-fifth, reason code 16 — the referring provider NPI was missing in box 17b.", "duration_ms": 5600, "forecast": "Rep explains the denial reason (CARC 16 — missing/incomplete information).", "forecast_confidence": 0.76, "predict": {"completion_probability": 0.78, "escalation_risk": 0.12, "rationale": "Denial is a correctable data omission, not a medical-necessity denial — resolvable as a corrected claim."}, "satisfies": ["denial_reason"], "intent": "denial-reason"},
            {"speaker": "agent", "text": "Understood. Can this be reprocessed as a corrected claim with the referring NPI added, and what's the timely-filing window?", "duration_ms": 5400, "intent": "resolution"},
            {"speaker": "payer", "text": "Yes — submit a corrected claim, frequency code 7, with the referring NPI. You have until October eighteenth, ninety days from denial.", "duration_ms": 6000, "forecast": "Rep confirms corrected-claim path and states the timely-filing deadline.", "forecast_confidence": 0.74, "predict": {"completion_probability": 0.9, "escalation_risk": 0.06, "rationale": "Clear corrected-claim path with an open filing window; no appeal needed."}, "satisfies": ["resubmission_path"], "intent": "resolution"},
            {"speaker": "agent", "text": "Recording the denial detail and resubmission plan to the claim worklist.", "duration_ms": 1600, "tool": {"tool": "record_status", "label": "record_status", "args": {"action": "corrected_claim", "freq_code": "7", "deadline": "2026-10-18"}, "result": "Worklist task created • assigned to billing queue", "status": "ok", "latency_ms": 330, "phi": True}, "phi": True, "intent": "tool-record"},
            {"speaker": "agent", "text": "Summarizing the claim outcome and next steps.", "duration_ms": 1700, "tool": {"tool": "summarize", "label": "summarize", "args": {"claim": "4471-A", "outcome": "corrected_claim_path", "ref": "UHC-99FX2"}, "result": "Summary drafted • 6/6 required fields captured", "status": "ok", "latency_ms": 540, "phi": False}, "predict": {"completion_probability": 0.97, "escalation_risk": 0.03, "rationale": "Resolution path captured and tasked; call complete without escalation."}, "intent": "tool-summarize"},
            {"speaker": "system", "text": "Call objective met — denial reason CARC 16 captured, corrected-claim task created (due 2026-10-18).", "duration_ms": 2600, "intent": "complete"},
        ],
    }
)

_PRIOR_AUTH_CIGNA = _assemble(
    {
        "id": "pa-cigna",
        "title": "Prior authorization status — escalation",
        "payer": "Cigna",
        "payer_id": "CIG-330",
        "category": "prior-auth",
        "difficulty": "complex",
        "outcome": "escalated",
        "objective": "Check status of prior auth for an MRI (CPT 70553); obtain determination or route to clinical review.",
        "patient": {"name": "Priya Nair", "member_id": "CIG-771-40682", "dob": "1990-07-30"},
        "provider": {"name": "Cedar Valley Neurology", "npi": "1588204417", "tax_id": "84-2210037"},
        "claim": {"id": "PA-88210", "dos": "2026-06-30", "amount": 1240.0, "cpt": "70553"},
        "baseline_completion_prob": 0.48,
        "baseline_escalation_risk": 0.41,
        "required_fields": ["auth_id", "cpt", "clinical_criteria", "reviewer", "determination"],
        "connect_ms": 2600,
        "raw_turns": [
            {"speaker": "ivr", "text": "Cigna prior authorization line. Please hold — average wait time is six minutes.", "duration_ms": 4600, "intent": "ivr-greeting"},
            {"speaker": "agent", "text": "Pulling the authorization request and clinical context while on hold.", "duration_ms": 1800, "tool": {"tool": "lookup_patient", "label": "lookup_patient", "args": {"member_id": "CIG-771-40682", "auth_id": "PA-88210"}, "result": "Member matched • auth PA-88210 found (status: pending review)", "status": "ok", "latency_ms": 270, "phi": True}, "satisfies": ["auth_id"], "phi": True, "intent": "tool-lookup"},
            {"speaker": "payer", "text": "Thanks for holding, this is the prior auth team. What's the auth ID and the procedure code?", "duration_ms": 5000, "forecast": "Rep connects and asks for the auth ID and CPT being requested.", "forecast_confidence": 0.83, "predict": {"completion_probability": 0.5, "escalation_risk": 0.38, "rationale": "Advanced imaging auth pending clinical review — meaningful chance of human hand-off."}, "intent": "authenticate"},
            {"speaker": "agent", "text": "Auth ID PA-88210, CPT 70553 — MRI brain with and without contrast, date of service June thirtieth.", "duration_ms": 5200, "satisfies": ["cpt"], "phi": True, "intent": "request-context"},
            {"speaker": "agent", "text": "Verifying authorization status and decision detail.", "duration_ms": 1800, "tool": {"tool": "verify_eligibility", "label": "verify_eligibility", "args": {"auth_id": "PA-88210", "cpt": "70553"}, "result": "Pending — additional clinical documentation requested", "status": "warn", "latency_ms": 520, "phi": True}, "compliance": "Status 'pending docs' — confirm what clinical criteria are unmet before advising provider.", "intent": "tool-status"},
            {"speaker": "payer", "text": "It's pending. The reviewer flagged that conservative treatment history wasn't documented for the headache indication.", "duration_ms": 6000, "forecast": "Rep states the auth is pending and names the missing clinical criterion.", "forecast_confidence": 0.71, "predict": {"completion_probability": 0.42, "escalation_risk": 0.55, "rationale": "Missing clinical criteria require a documentation update or peer-to-peer — outside autonomous scope."}, "satisfies": ["clinical_criteria"], "intent": "clinical-gap"},
            {"speaker": "agent", "text": "Can the ordering neurologist add the conservative-care notes, or does this require a peer-to-peer review?", "duration_ms": 5000, "intent": "resolution-attempt"},
            {"speaker": "payer", "text": "For this indication it needs a peer-to-peer with our medical director. I can't change the determination from here.", "duration_ms": 5800, "forecast": "Rep indicates a clinician peer-to-peer is required; cannot resolve on this call.", "forecast_confidence": 0.68, "predict": {"completion_probability": 0.3, "escalation_risk": 0.86, "rationale": "Payer requires clinician-to-clinician review; agent cannot complete autonomously."}, "satisfies": ["reviewer"], "intent": "escalation-trigger"},
            {"speaker": "agent", "text": "Escalation criteria met — routing to a human specialist with the clinical gap and peer-to-peer requirement.", "duration_ms": 1900, "tool": {"tool": "escalate", "label": "escalate", "args": {"reason": "peer_to_peer_required", "criterion": "conservative_tx_history", "priority": "high"}, "result": "Escalation packet created • routed to clinical review queue", "status": "ok", "latency_ms": 360, "phi": True}, "phi": True, "compliance": "Escalation includes PHI summary — ensure recipient queue is access-controlled.", "predict": {"completion_probability": 0.28, "escalation_risk": 0.9, "rationale": "Hand-off packet created; outcome now depends on scheduled peer-to-peer."}, "intent": "tool-escalate"},
            {"speaker": "agent", "text": "Summarizing the unresolved auth and the documentation needed for the peer-to-peer.", "duration_ms": 1700, "tool": {"tool": "summarize", "label": "summarize", "args": {"auth": "PA-88210", "outcome": "escalated_peer_to_peer", "missing": "conservative_tx_history"}, "result": "Summary drafted • 4/5 required fields captured (determination pending)", "status": "warn", "latency_ms": 560, "phi": False}, "intent": "tool-summarize"},
            {"speaker": "system", "text": "Call escalated — peer-to-peer review required; specialist hand-off packet queued (determination outstanding).", "duration_ms": 2800, "intent": "escalate"},
        ],
    }
)

_CLAIM_ANTHEM_RECON = _assemble(
    {
        "id": "claim-anthem-recon",
        "title": "Denied-claim reconciliation — authorization timing",
        "payer": "Anthem",
        "payer_id": "ANT-225",
        "category": "claim-status",
        "difficulty": "complex",
        "outcome": "completed",
        "objective": "Claim ANT-7741 (MRI brain, CPT 70553) denied for 'authorization not on file'. Reconcile the denial against the member's prior-auth record and set the correct resubmission path — the records may disagree.",
        "patient": {"name": "Sofia Mendoza", "member_id": "ANT-883-50127", "dob": "1988-12-03"},
        "provider": {"name": "Cedar Valley Neurology", "npi": "1588204417", "tax_id": "84-2210037"},
        "claim": {"id": "ANT-7741", "dos": "2026-05-20", "amount": 2890.0, "cpt": "70553"},
        "baseline_completion_prob": 0.55,
        "baseline_escalation_risk": 0.24,
        "required_fields": ["claim_id", "claim_status", "denial_reason", "auth_status", "resubmission_path"],
        "connect_ms": 2400,
        "raw_turns": [
            {"speaker": "ivr", "text": "Anthem provider services. Say 'claims' or 'authorizations'.", "duration_ms": 4200, "intent": "ivr-greeting"},
            {"speaker": "agent", "text": "Claims.", "duration_ms": 1200, "intent": "ivr-navigate"},
            {"speaker": "agent", "text": "Running an end-to-end check on the member, this claim, and any related authorization before the rep connects.", "duration_ms": 2000, "tool": {"tool": "investigate", "label": "investigate", "args": {"task": "reconcile denied claim ANT-7741 against prior auth"}, "result": "Member active • claim ANT-7741 DENIED (CARC 197, auth not on file) • auth PA-90233 APPROVED — DISCREPANCY: resubmit, do not appeal", "status": "warn", "latency_ms": 720, "phi": True}, "satisfies": ["claim_id", "claim_status", "auth_status"], "phi": True, "compliance": "Sub-agent cross-checked claim vs. authorization; resubmission recommended over appeal.", "intent": "tool-investigate"},
            {"speaker": "payer", "text": "Claims, this is Reggie. Member ID, claim number, and date of service?", "duration_ms": 4800, "forecast": "Rep authenticates and asks for claim identifiers.", "forecast_confidence": 0.84, "predict": {"completion_probability": 0.58, "escalation_risk": 0.2, "rationale": "Auth-timing denial — resolvable as a corrected claim if the PA is now approved."}, "intent": "authenticate"},
            {"speaker": "agent", "text": "Member ANT-883-50127, claim ANT-7741, date of service May twentieth, MRI 70553 billed at twenty-eight ninety.", "duration_ms": 5200, "phi": True, "intent": "claim-context"},
            {"speaker": "payer", "text": "I see it — denied April, reason code 197, no authorization on file when it adjudicated.", "duration_ms": 5400, "forecast": "Rep confirms the CARC 197 auth denial.", "forecast_confidence": 0.8, "satisfies": ["denial_reason"], "intent": "denial-reason"},
            {"speaker": "agent", "text": "I show prior auth PA-90233 for that same MRI was approved on May twenty-eighth — eight days after this claim processed. Can it be reprocessed as a corrected claim citing that PA rather than appealed?", "duration_ms": 6400, "intent": "reconcile"},
            {"speaker": "payer", "text": "Good catch. Yes — submit a corrected claim, frequency 7, with PA-90233 in the auth field. No appeal needed; you're inside timely filing through November twentieth.", "duration_ms": 6200, "forecast": "Rep confirms corrected-claim resubmission citing the approved PA.", "forecast_confidence": 0.78, "predict": {"completion_probability": 0.93, "escalation_risk": 0.05, "rationale": "Discrepancy resolved: approved PA exists; corrected claim is the clean path."}, "satisfies": ["resubmission_path"], "intent": "resolution"},
            {"speaker": "agent", "text": "Recording the reconciliation and the corrected-claim plan to the billing worklist.", "duration_ms": 1700, "tool": {"tool": "record_status", "label": "record_status", "args": {"action": "corrected_claim", "freq_code": "7", "auth_ref": "PA-90233", "deadline": "2026-11-20"}, "result": "Worklist task created • corrected claim queued with PA-90233", "status": "ok", "latency_ms": 320, "phi": True}, "phi": True, "intent": "tool-record"},
            {"speaker": "agent", "text": "Summarizing the auth-timing reconciliation and resubmission for the encounter note.", "duration_ms": 1700, "tool": {"tool": "summarize", "label": "summarize", "args": {"claim": "ANT-7741", "outcome": "corrected_claim_with_pa"}, "result": "Summary drafted • 5/5 required fields captured", "status": "ok", "latency_ms": 510, "phi": False}, "predict": {"completion_probability": 0.97, "escalation_risk": 0.03, "rationale": "Reconciliation complete; corrected claim tasked. No escalation."}, "intent": "tool-summarize"},
            {"speaker": "system", "text": "Call objective met — denial reconciled against approved PA-90233; corrected claim queued (due 2026-11-20).", "duration_ms": 2600, "intent": "complete"},
        ],
    }
)

_CLAIM_HUMANA_APPEAL = _assemble(
    {
        "id": "claim-humana-appeal",
        "title": "Denied claim — retro-auth appeal (escalation)",
        "payer": "Humana",
        "payer_id": "HUM-410",
        "category": "claim-status",
        "difficulty": "complex",
        "outcome": "escalated",
        "objective": "Claim HUM-9920 (knee arthroscopy, CPT 29881) denied for absent precertification. Establish whether any authorization exists; if none, route a retro-authorization appeal with the operative note.",
        "patient": {"name": "Alicia Romero", "member_id": "HUM-664-10298", "dob": "1965-09-05"},
        "provider": {"name": "Cedar Valley Orthopedics", "npi": "1730284511", "tax_id": "84-2210037"},
        "claim": {"id": "HUM-9920", "dos": "2026-03-02", "amount": 1875.5, "cpt": "29881"},
        "baseline_completion_prob": 0.4,
        "baseline_escalation_risk": 0.46,
        "required_fields": ["claim_id", "claim_status", "denial_reason", "auth_status", "appeal_path"],
        "connect_ms": 2600,
        "raw_turns": [
            {"speaker": "ivr", "text": "Humana provider line. Please hold for the next available representative.", "duration_ms": 4400, "intent": "ivr-greeting"},
            {"speaker": "agent", "text": "Investigating the denial root cause — member coverage, the claim, and any authorization on file.", "duration_ms": 2000, "tool": {"tool": "investigate", "label": "investigate", "args": {"task": "root cause of HUM-9920 precert denial; is any auth on file?"}, "result": "Member active • claim HUM-9920 DENIED (CARC 197, precert absent) • NO prior auth on file → retro-authorization appeal required", "status": "warn", "latency_ms": 690, "phi": True}, "satisfies": ["claim_id", "claim_status", "auth_status"], "phi": True, "compliance": "Sub-agent confirmed no authorization exists; appeal path indicated.", "intent": "tool-investigate"},
            {"speaker": "payer", "text": "Provider claims, this is Tara. What claim are we looking at?", "duration_ms": 4400, "forecast": "Rep connects and asks for the claim.", "forecast_confidence": 0.83, "predict": {"completion_probability": 0.42, "escalation_risk": 0.44, "rationale": "Absent-precert denial with no auth on file — likely a retro-auth appeal beyond autonomous scope."}, "intent": "authenticate"},
            {"speaker": "agent", "text": "Claim HUM-9920 for member HUM-664-10298, knee arthroscopy 29881, date of service March second, denied reason code 197.", "duration_ms": 5400, "phi": True, "satisfies": ["denial_reason"], "intent": "claim-context"},
            {"speaker": "payer", "text": "Correct — denied for no precertification. There's no auth on file for that procedure. This one needs a retro-auth appeal with the op note; I can't reverse it here.", "duration_ms": 6400, "forecast": "Rep confirms no auth and that a retro-auth appeal is required.", "forecast_confidence": 0.74, "predict": {"completion_probability": 0.3, "escalation_risk": 0.82, "rationale": "Requires a retro-authorization appeal with clinical documentation — human review."}, "satisfies": ["appeal_path"], "intent": "escalation-trigger"},
            {"speaker": "agent", "text": "Understood — escalation criteria met. Routing a retro-authorization appeal packet with the operative note to the specialist queue.", "duration_ms": 2000, "tool": {"tool": "escalate", "label": "escalate", "args": {"reason": "retro_auth_appeal", "claim": "HUM-9920", "needs": "operative_note", "priority": "high"}, "result": "Escalation packet created • routed to appeals queue", "status": "ok", "latency_ms": 360, "phi": True}, "phi": True, "compliance": "Escalation includes PHI summary — recipient queue must be access-controlled.", "predict": {"completion_probability": 0.28, "escalation_risk": 0.9, "rationale": "Hand-off created; outcome depends on the appeal review."}, "intent": "tool-escalate"},
            {"speaker": "agent", "text": "Summarizing the denial and the retro-auth appeal hand-off.", "duration_ms": 1700, "tool": {"tool": "summarize", "label": "summarize", "args": {"claim": "HUM-9920", "outcome": "escalated_retro_auth_appeal"}, "result": "Summary drafted • 5/5 required fields captured (appeal pending)", "status": "warn", "latency_ms": 540, "phi": False}, "intent": "tool-summarize"},
            {"speaker": "system", "text": "Call escalated — no auth on file; retro-authorization appeal packet queued with operative-note request.", "duration_ms": 2800, "intent": "escalate"},
        ],
    }
)

SCENARIOS: list[Scenario] = [
    _ELIGIBILITY_AETNA,
    _CLAIM_UHC,
    _PRIOR_AUTH_CIGNA,
    _CLAIM_ANTHEM_RECON,
    _CLAIM_HUMANA_APPEAL,
]
DEFAULT_SCENARIO_ID = _ELIGIBILITY_AETNA.id


def get_scenario(scenario_id: str) -> Scenario:
    return next((s for s in SCENARIOS if s.id == scenario_id), SCENARIOS[0])
