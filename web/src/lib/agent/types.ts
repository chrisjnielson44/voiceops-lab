import type { AuditEvent } from "@/lib/audit/types";
import type { CallStatus, PredictionSnapshot, Speaker } from "@/lib/simulation/types";
import type { PredictionSet, PrefetchRecord, Subgraph } from "@/lib/graph/types";

export interface LiveTurn {
  id: string;
  seq: number;
  speaker: Speaker;
  text: string;
  atMs: number;
  latencyMs?: number;
  /** Verified records the context graph fed into this (agent) turn. */
  grounded?: number | null;
  /** Of those, how many were pre-loaded by anticipation. */
  anticipated?: number | null;
  /** True while this same-id turn is still streaming from the model. */
  streaming?: boolean;
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
  /** Set when this tool's result was served from the speculative prefetch cache. */
  prefetchHit?: boolean;
  savedMs?: number;
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

/** One phase of an agent turn's reasoning trace. */
export interface ReasoningSegment {
  phase: "retrieve" | "think" | "anticipate";
  title: string;
  text: string;
  /** retrieve: the lit context-graph nodes walked, ordered by hops. */
  nodes?: { id: string; type: string; label: string; hops: number; seed: boolean }[];
  /** anticipate: the weighed prediction candidates. */
  predictions?: { intent: string; utterance: string; confidence: number; needsTool?: string | null; warmed: boolean }[];
}

/** The reasoning trace shown inline above an agent turn. Streamed: upsert by id. */
export interface LiveReasoning {
  id: string;
  seq: number;
  atMs: number;
  model?: string | null;
  segments: ReasoningSegment[];
  streaming?: boolean;
  durationMs?: number | null;
}

/** Discriminated event stream pushed over SSE. */
export type AgentEvent =
  | { kind: "status"; status: CallStatus; phase: number; elapsedMs: number }
  | { kind: "turn"; turn: LiveTurn }
  | { kind: "tool"; tool: LiveTool }
  | { kind: "reasoning"; reasoning: LiveReasoning }
  | { kind: "prediction"; prediction: PredictionSnapshot }
  | { kind: "predictionSet"; predictionSet: PredictionSet }
  | { kind: "prefetch"; record: PrefetchRecord }
  | { kind: "graph"; subgraph: Subgraph }
  | { kind: "audit"; event: AuditEvent }
  | { kind: "metrics"; metrics: RunMetrics }
  | { kind: "error"; message: string }
  | { kind: "await"; awaiting: boolean; role: string }
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
