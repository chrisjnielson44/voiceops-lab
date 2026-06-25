import type { AuditEvent } from "@/lib/audit/types";
import type { CallStatus, PredictionSnapshot, Speaker } from "@/lib/simulation/types";

export interface LiveTurn {
  id: string;
  seq: number;
  speaker: Speaker;
  text: string;
  atMs: number;
  latencyMs?: number;
}

export interface LiveTool {
  id: string;
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  status: "ok" | "warn" | "error";
  latencyMs: number;
  phi: boolean;
  atMs: number;
}

export interface RunMetrics {
  inferences: number;
  toolCalls: number;
  phiAccesses: number;
  toolErrors: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
}

/** Discriminated event stream pushed over SSE. */
export type AgentEvent =
  | { kind: "status"; status: CallStatus; phase: number; elapsedMs: number }
  | { kind: "turn"; turn: LiveTurn }
  | { kind: "tool"; tool: LiveTool }
  | { kind: "prediction"; prediction: PredictionSnapshot }
  | { kind: "audit"; event: AuditEvent }
  | { kind: "metrics"; metrics: RunMetrics }
  | { kind: "error"; message: string }
  | { kind: "done"; outcome: "completed" | "escalated" | "stopped" };

export interface AgentDecision {
  action: "tool" | "speak" | "end";
  tool?: string;
  args?: Record<string, unknown>;
  text?: string;
  outcome?: "completed" | "escalated";
  summary?: string;
}

export interface PayerReply {
  text: string;
  ends?: boolean;
  escalate?: boolean;
}
