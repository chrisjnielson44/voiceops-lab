import type { RawTurn, Scenario, TranscriptTurn } from "./types";

/**
 * Scenario library. Each scenario is hand-authored dialogue for a simulated
 * healthcare admin call. Turns carry timing, optional tool calls, payer-line
 * forecasts, prediction hints, and which required fields they satisfy. The
 * assembler below turns the authoring shape into absolute timings.
 */

type ScenarioSpec = Omit<Scenario, "turns" | "totalDurationMs"> & {
  rawTurns: RawTurn[];
};

function assemble(spec: ScenarioSpec): Scenario {
  let cursor = spec.connectMs;
  const turns: TranscriptTurn[] = spec.rawTurns.map((raw, index) => {
    const atMs = cursor;
    const endMs = atMs + raw.durationMs;
    cursor = endMs;
    return {
      ...raw,
      id: `${spec.id}-t${index}`,
      index,
      atMs,
      endMs,
    };
  });
  const { rawTurns, ...rest } = spec;
  void rawTurns;
  return { ...rest, turns, totalDurationMs: cursor };
}

// --- Scenario 1: Eligibility verification (routine, completed) --------------

const eligibilityAetna = assemble({
  id: "elig-aetna",
  title: "Eligibility & benefits verification",
  payer: "Aetna",
  payerId: "AET-114",
  category: "eligibility",
  difficulty: "routine",
  outcome: "completed",
  objective:
    "Confirm active coverage and capture copay, deductible, and out-of-pocket accumulators for an office visit.",
  patient: { name: "Maria Alvarez", memberId: "W2049-88147", dob: "1984-03-22" },
  provider: { name: "Cedar Valley Internal Medicine", npi: "1346279805", taxId: "84-2210037" },
  baselineCompletionProb: 0.78,
  baselineEscalationRisk: 0.08,
  requiredFields: ["member_id", "dob", "group_number", "plan_type", "copay", "deductible_met"],
  connectMs: 2200,
  rawTurns: [
    {
      speaker: "ivr",
      text: "Thank you for calling Aetna provider services. Para español, marque nueve. Please say or enter the member ID.",
      durationMs: 5200,
      intent: "ivr-greeting",
    },
    {
      speaker: "agent",
      text: "Provider services, please. Member ID Whiskey-two-zero-four-nine, dash, eight-eight-one-four-seven.",
      durationMs: 4200,
      intent: "ivr-navigate",
    },
    {
      speaker: "agent",
      text: "Looking up the member record before the representative connects.",
      durationMs: 1600,
      tool: {
        tool: "lookup_patient",
        label: "lookup_patient",
        args: { member_id: "W2049-88147", dob: "1984-03-22" },
        result: "1 match — Maria Alvarez, plan active",
        status: "ok",
        latencyMs: 240,
        phi: true,
      },
      satisfies: ["member_id", "dob"],
      phi: true,
      intent: "tool-lookup",
    },
    {
      speaker: "payer",
      text: "This is Denise with Aetna provider services. Who am I speaking with and what's the tax ID on file?",
      durationMs: 4600,
      forecast: "Rep answers and asks to authenticate the provider (tax ID / NPI).",
      forecastConfidence: 0.82,
      predict: { completionProbability: 0.8, escalationRisk: 0.07, rationale: "Standard authentication; member matched cleanly on first pass." },
      intent: "authenticate",
    },
    {
      speaker: "agent",
      text: "This is the automated assistant for Cedar Valley Internal Medicine, NPI 1346279805, tax ID 84-2210037, calling on a verified line.",
      durationMs: 4800,
      satisfies: ["group_number"],
      intent: "authenticate",
    },
    {
      speaker: "payer",
      text: "Thanks, you're verified. The member is active on an Open Access PPO, group 7741-A, effective January first.",
      durationMs: 5200,
      forecast: "Rep confirms active coverage and names the plan type / group number.",
      forecastConfidence: 0.79,
      predict: { completionProbability: 0.86, escalationRisk: 0.05, rationale: "Coverage active; plan type captured. No conflicting other-coverage flags." },
      satisfies: ["plan_type"],
      intent: "coverage",
    },
    {
      speaker: "agent",
      text: "Verifying active eligibility for date of service today and pulling benefit accumulators.",
      durationMs: 1800,
      tool: {
        tool: "verify_eligibility",
        label: "verify_eligibility",
        args: { plan: "Open Access PPO", group: "7741-A", dos: "2026-06-23" },
        result: "Active • PCP copay $25 • deductible $1,500 (met $640)",
        status: "ok",
        latencyMs: 410,
        phi: true,
      },
      satisfies: ["copay"],
      phi: true,
      intent: "tool-eligibility",
    },
    {
      speaker: "agent",
      text: "Can you confirm the specialist copay and how much of the individual deductible has been met year-to-date?",
      durationMs: 4400,
      intent: "benefits",
    },
    {
      speaker: "payer",
      text: "Specialist copay is forty dollars. Individual deductible is fifteen hundred, with six hundred forty applied so far.",
      durationMs: 5400,
      forecast: "Rep reads specialist copay and deductible-met amount.",
      forecastConfidence: 0.84,
      predict: { completionProbability: 0.93, escalationRisk: 0.04, rationale: "All benefit fields obtained; only confirmation and reference number remain." },
      satisfies: ["deductible_met"],
      intent: "benefits",
    },
    {
      speaker: "agent",
      text: "Recording the verified benefits to the patient account.",
      durationMs: 1500,
      tool: {
        tool: "record_status",
        label: "record_status",
        args: { copay_pcp: "$25", copay_spec: "$40", deductible_met: "$640/$1500" },
        result: "Benefits written to EHR encounter",
        status: "ok",
        latencyMs: 300,
        phi: true,
      },
      phi: true,
      intent: "tool-record",
    },
    {
      speaker: "payer",
      text: "Your call reference number is A as in apple, 5-5-2-9-0-3-1.",
      durationMs: 4200,
      forecast: "Rep provides a call reference number for the interaction.",
      forecastConfidence: 0.7,
      intent: "reference",
    },
    {
      speaker: "agent",
      text: "Summarizing the verified eligibility and benefits for the encounter note.",
      durationMs: 1700,
      tool: {
        tool: "summarize",
        label: "summarize",
        args: { ref: "A5529031", outcome: "eligibility_confirmed" },
        result: "Summary drafted • 6/6 required fields captured",
        status: "ok",
        latencyMs: 520,
        phi: false,
      },
      predict: { completionProbability: 0.98, escalationRisk: 0.02, rationale: "All required fields captured and written back; call complete." },
      intent: "tool-summarize",
    },
    {
      speaker: "system",
      text: "Call objective met — eligibility confirmed, benefits recorded, reference A5529031 stored.",
      durationMs: 2600,
      intent: "complete",
    },
  ],
});

// --- Scenario 2: Claim status follow-up (moderate, completed) ---------------

const claimUhc = assemble({
  id: "claim-uhc",
  title: "Denied claim status follow-up",
  payer: "UnitedHealthcare",
  payerId: "UHC-208",
  category: "claim-status",
  difficulty: "moderate",
  outcome: "completed",
  objective:
    "Determine why claim 4471-A was denied and capture the corrected-claim resubmission path and timely-filing window.",
  patient: { name: "James Whitfield", memberId: "UHG-553-22019", dob: "1971-11-09" },
  provider: { name: "Cedar Valley Internal Medicine", npi: "1346279805", taxId: "84-2210037" },
  claim: { id: "4471-A", dos: "2026-04-18", amount: 432.0, cpt: "99214" },
  baselineCompletionProb: 0.62,
  baselineEscalationRisk: 0.22,
  requiredFields: ["claim_id", "dos", "billed_amount", "claim_status", "denial_reason", "resubmission_path"],
  connectMs: 2400,
  rawTurns: [
    {
      speaker: "ivr",
      text: "UnitedHealthcare provider line. Say 'claims' for claim status, 'eligibility' for benefits.",
      durationMs: 4400,
      intent: "ivr-greeting",
    },
    { speaker: "agent", text: "Claims.", durationMs: 1400, intent: "ivr-navigate" },
    {
      speaker: "agent",
      text: "Pulling the claim and member context before the rep connects.",
      durationMs: 1700,
      tool: {
        tool: "lookup_patient",
        label: "lookup_patient",
        args: { member_id: "UHG-553-22019", claim_id: "4471-A" },
        result: "Member matched • claim 4471-A found (status: denied)",
        status: "ok",
        latencyMs: 260,
        phi: true,
      },
      satisfies: ["claim_id", "member_id"],
      phi: true,
      intent: "tool-lookup",
    },
    {
      speaker: "payer",
      text: "Claims department, this is Marcus. Can I get the member ID, claim number, and date of service?",
      durationMs: 5000,
      forecast: "Rep authenticates and asks for member ID, claim number, and DOS.",
      forecastConfidence: 0.85,
      predict: { completionProbability: 0.64, escalationRisk: 0.2, rationale: "Denied claim — outcome depends on whether denial reason is correctable." },
      intent: "authenticate",
    },
    {
      speaker: "agent",
      text: "Member UHG-553-22019, claim 4471-A, date of service April eighteenth, billed at four thirty-two for a 99214.",
      durationMs: 5200,
      satisfies: ["dos", "billed_amount"],
      phi: true,
      intent: "claim-context",
    },
    {
      speaker: "agent",
      text: "Verifying current claim status and adjudication detail.",
      durationMs: 1800,
      tool: {
        tool: "verify_claim",
        label: "verify_claim",
        args: { claim_id: "4471-A", dos: "2026-04-18" },
        result: "DENIED • CARC 16 — missing/incomplete information",
        status: "warn",
        latencyMs: 480,
        phi: true,
      },
      satisfies: ["claim_status"],
      phi: true,
      compliance: "Denial reason retrieved; verify against remittance before advising resubmission.",
      intent: "tool-claim",
    },
    {
      speaker: "payer",
      text: "That one denied April twenty-fifth, reason code 16 — the referring provider NPI was missing in box 17b.",
      durationMs: 5600,
      forecast: "Rep explains the denial reason (CARC 16 — missing/incomplete information).",
      forecastConfidence: 0.76,
      predict: { completionProbability: 0.78, escalationRisk: 0.12, rationale: "Denial is a correctable data omission, not a medical-necessity denial — resolvable as a corrected claim." },
      satisfies: ["denial_reason"],
      intent: "denial-reason",
    },
    {
      speaker: "agent",
      text: "Understood. Can this be reprocessed as a corrected claim with the referring NPI added, and what's the timely-filing window?",
      durationMs: 5400,
      intent: "resolution",
    },
    {
      speaker: "payer",
      text: "Yes — submit a corrected claim, frequency code 7, with the referring NPI. You have until October eighteenth, ninety days from denial.",
      durationMs: 6000,
      forecast: "Rep confirms corrected-claim path and states the timely-filing deadline.",
      forecastConfidence: 0.74,
      predict: { completionProbability: 0.9, escalationRisk: 0.06, rationale: "Clear corrected-claim path with an open filing window; no appeal needed." },
      satisfies: ["resubmission_path"],
      intent: "resolution",
    },
    {
      speaker: "agent",
      text: "Recording the denial detail and resubmission plan to the claim worklist.",
      durationMs: 1600,
      tool: {
        tool: "record_status",
        label: "record_status",
        args: { action: "corrected_claim", freq_code: "7", deadline: "2026-10-18" },
        result: "Worklist task created • assigned to billing queue",
        status: "ok",
        latencyMs: 330,
        phi: true,
      },
      phi: true,
      intent: "tool-record",
    },
    {
      speaker: "agent",
      text: "Summarizing the claim outcome and next steps.",
      durationMs: 1700,
      tool: {
        tool: "summarize",
        label: "summarize",
        args: { claim: "4471-A", outcome: "corrected_claim_path", ref: "UHC-99FX2" },
        result: "Summary drafted • 6/6 required fields captured",
        status: "ok",
        latencyMs: 540,
        phi: false,
      },
      predict: { completionProbability: 0.97, escalationRisk: 0.03, rationale: "Resolution path captured and tasked; call complete without escalation." },
      intent: "tool-summarize",
    },
    {
      speaker: "system",
      text: "Call objective met — denial reason CARC 16 captured, corrected-claim task created (due 2026-10-18).",
      durationMs: 2600,
      intent: "complete",
    },
  ],
});

// --- Scenario 3: Prior authorization status (complex, escalated) ------------

const priorAuthCigna = assemble({
  id: "pa-cigna",
  title: "Prior authorization status — escalation",
  payer: "Cigna",
  payerId: "CIG-330",
  category: "prior-auth",
  difficulty: "complex",
  outcome: "escalated",
  objective:
    "Check status of prior auth for an MRI (CPT 70553); obtain determination or route to clinical review.",
  patient: { name: "Priya Nair", memberId: "CIG-771-40682", dob: "1990-07-30" },
  provider: { name: "Cedar Valley Neurology", npi: "1588204417", taxId: "84-2210037" },
  claim: { id: "PA-88210", dos: "2026-06-30", amount: 1240.0, cpt: "70553" },
  baselineCompletionProb: 0.48,
  baselineEscalationRisk: 0.41,
  requiredFields: ["auth_id", "cpt", "clinical_criteria", "reviewer", "determination"],
  connectMs: 2600,
  rawTurns: [
    {
      speaker: "ivr",
      text: "Cigna prior authorization line. Please hold — average wait time is six minutes.",
      durationMs: 4600,
      intent: "ivr-greeting",
    },
    {
      speaker: "agent",
      text: "Pulling the authorization request and clinical context while on hold.",
      durationMs: 1800,
      tool: {
        tool: "lookup_patient",
        label: "lookup_patient",
        args: { member_id: "CIG-771-40682", auth_id: "PA-88210" },
        result: "Member matched • auth PA-88210 found (status: pending review)",
        status: "ok",
        latencyMs: 270,
        phi: true,
      },
      satisfies: ["auth_id"],
      phi: true,
      intent: "tool-lookup",
    },
    {
      speaker: "payer",
      text: "Thanks for holding, this is the prior auth team. What's the auth ID and the procedure code?",
      durationMs: 5000,
      forecast: "Rep connects and asks for the auth ID and CPT being requested.",
      forecastConfidence: 0.83,
      predict: { completionProbability: 0.5, escalationRisk: 0.38, rationale: "Advanced imaging auth pending clinical review — meaningful chance of human hand-off." },
      intent: "authenticate",
    },
    {
      speaker: "agent",
      text: "Auth ID PA-88210, CPT 70553 — MRI brain with and without contrast, date of service June thirtieth.",
      durationMs: 5200,
      satisfies: ["cpt"],
      phi: true,
      intent: "request-context",
    },
    {
      speaker: "agent",
      text: "Verifying authorization status and decision detail.",
      durationMs: 1800,
      tool: {
        tool: "verify_eligibility",
        label: "verify_eligibility",
        args: { auth_id: "PA-88210", cpt: "70553" },
        result: "Pending — additional clinical documentation requested",
        status: "warn",
        latencyMs: 520,
        phi: true,
      },
      compliance: "Status 'pending docs' — confirm what clinical criteria are unmet before advising provider.",
      intent: "tool-status",
    },
    {
      speaker: "payer",
      text: "It's pending. The reviewer flagged that conservative treatment history wasn't documented for the headache indication.",
      durationMs: 6000,
      forecast: "Rep states the auth is pending and names the missing clinical criterion.",
      forecastConfidence: 0.71,
      predict: { completionProbability: 0.42, escalationRisk: 0.55, rationale: "Missing clinical criteria require a documentation update or peer-to-peer — outside autonomous scope." },
      satisfies: ["clinical_criteria"],
      intent: "clinical-gap",
    },
    {
      speaker: "agent",
      text: "Can the ordering neurologist add the conservative-care notes, or does this require a peer-to-peer review?",
      durationMs: 5000,
      intent: "resolution-attempt",
    },
    {
      speaker: "payer",
      text: "For this indication it needs a peer-to-peer with our medical director. I can't change the determination from here.",
      durationMs: 5800,
      forecast: "Rep indicates a clinician peer-to-peer is required; cannot resolve on this call.",
      forecastConfidence: 0.68,
      predict: { completionProbability: 0.3, escalationRisk: 0.86, rationale: "Payer requires clinician-to-clinician review; agent cannot complete autonomously." },
      satisfies: ["reviewer"],
      intent: "escalation-trigger",
    },
    {
      speaker: "agent",
      text: "Escalation criteria met — routing to a human specialist with the clinical gap and peer-to-peer requirement.",
      durationMs: 1900,
      tool: {
        tool: "escalate",
        label: "escalate",
        args: { reason: "peer_to_peer_required", criterion: "conservative_tx_history", priority: "high" },
        result: "Escalation packet created • routed to clinical review queue",
        status: "ok",
        latencyMs: 360,
        phi: true,
      },
      phi: true,
      compliance: "Escalation includes PHI summary — ensure recipient queue is access-controlled.",
      predict: { completionProbability: 0.28, escalationRisk: 0.9, rationale: "Hand-off packet created; outcome now depends on scheduled peer-to-peer." },
      intent: "tool-escalate",
    },
    {
      speaker: "agent",
      text: "Summarizing the unresolved auth and the documentation needed for the peer-to-peer.",
      durationMs: 1700,
      tool: {
        tool: "summarize",
        label: "summarize",
        args: { auth: "PA-88210", outcome: "escalated_peer_to_peer", missing: "conservative_tx_history" },
        result: "Summary drafted • 4/5 required fields captured (determination pending)",
        status: "warn",
        latencyMs: 560,
        phi: false,
      },
      intent: "tool-summarize",
    },
    {
      speaker: "system",
      text: "Call escalated — peer-to-peer review required; specialist hand-off packet queued (determination outstanding).",
      durationMs: 2800,
      intent: "escalate",
    },
  ],
});

export const SCENARIOS: Scenario[] = [eligibilityAetna, claimUhc, priorAuthCigna];
export const DEFAULT_SCENARIO_ID = eligibilityAetna.id;

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
