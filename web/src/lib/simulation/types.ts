/**
 * Types for the deterministic call simulation. The whole call is modeled as an
 * ordered list of timed turns; given an `elapsedMs` the engine can derive the
 * exact transcript, tool events, audit ledger, and predictions as pure
 * functions — which makes the demo reproducible and replayable.
 */

export type CallStatus =
  | "idle"
  | "dialing"
  | "active"
  | "paused"
  | "completed"
  | "escalated";

export type Speaker = "agent" | "payer" | "ivr" | "system";

export type ToolName =
  | "lookup_patient"
  | "verify_eligibility"
  | "verify_claim"
  | "record_status"
  | "escalate"
  | "summarize";

export type ToolStatus = "ok" | "warn" | "error";

export interface ToolInvocation {
  tool: ToolName;
  label: string;
  args: Record<string, string>;
  result: string;
  status: ToolStatus;
  latencyMs: number;
  phi: boolean;
}

export interface PredictionHint {
  completionProbability?: number;
  escalationRisk?: number;
  rationale?: string;
}

/** Authoring shape for a single turn (atMs/index assigned by the assembler). */
export interface RawTurn {
  speaker: Speaker;
  text: string;
  durationMs: number;
  tool?: ToolInvocation;
  /** Paraphrase the model uses to forecast this payer line before it lands. */
  forecast?: string;
  forecastConfidence?: number;
  predict?: PredictionHint;
  /** Which requiredFields this turn satisfies (drives "missing fields"). */
  satisfies?: string[];
  phi?: boolean;
  compliance?: string;
  intent?: string;
}

export interface TranscriptTurn extends RawTurn {
  id: string;
  index: number;
  atMs: number;
  endMs: number;
}

export type ScenarioCategory = "eligibility" | "claim-status" | "prior-auth";
export type ScenarioDifficulty = "routine" | "moderate" | "complex";
export type ScenarioOutcome = "completed" | "escalated";

export interface Scenario {
  id: string;
  title: string;
  payer: string;
  payerId: string;
  category: ScenarioCategory;
  difficulty: ScenarioDifficulty;
  outcome: ScenarioOutcome;
  objective: string;
  patient: { name: string; memberId: string; dob: string };
  provider: { name: string; npi: string; taxId: string };
  claim?: { id: string; dos: string; amount: number; cpt: string };
  baselineCompletionProb: number;
  baselineEscalationRisk: number;
  requiredFields: string[];
  connectMs: number;
  turns: TranscriptTurn[];
  totalDurationMs: number;
}

export interface PredictionSnapshot {
  nextPayerResponse: string;
  nextResponseConfidence: number;
  completionProbability: number;
  escalationRisk: number;
  estRemainingMs: number;
  missingFields: string[];
  rationale: string;
}
