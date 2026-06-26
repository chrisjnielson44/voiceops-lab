/**
 * Context-graph + anticipatory-prediction wire contracts. These mirror the
 * Pydantic models in backend/app/schemas/agent.py (camelCase) and stream over the
 * same SSE channel the cockpit already consumes.
 */

export type GraphNodeType =
  | "member"
  | "coverage"
  | "plan"
  | "claim"
  | "auth"
  | "provider"
  | "payer"
  | "carc"
  | "note";

export interface GraphNode {
  id: string; // "type:natural_key"
  type: GraphNodeType | string;
  label: string;
  score: number;
  lit: boolean; // part of the current per-turn retrieved subgraph
  seed: boolean; // was a retrieval seed (mentioned / known)
  hops?: number; // hops from nearest seed
  attrs?: Record<string, string | number | boolean>;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  weight: number;
  lit: boolean;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  seeds: string[];
  context: string;
  hops: number;
}

export interface PredictedEntity {
  type: string;
  id: string;
}

export type PrefetchStatus = "prefetching" | "ready" | "stale" | "evicted" | "hit";

export interface Prediction {
  intent: string;
  utterance: string;
  confidence: number;
  entities: PredictedEntity[];
  needsTool?: string;
  draftWorth: boolean;
  prefetchStatus?: PrefetchStatus;
  savedMs?: number;
  hit: boolean;
  draft?: string;
}

export interface PredictionSet {
  predictions: Prediction[];
  generatedAtMs: number;
  modelMs: number;
  hitRate: number;
  avgSavedMs: number;
  wasted: number;
  predictedCount: number;
}

export interface PrefetchRecord {
  key: string;
  kind: "subgraph" | "tool" | "draft" | string;
  status: PrefetchStatus;
  intent?: string;
  label?: string;
  savedMs?: number;
}
