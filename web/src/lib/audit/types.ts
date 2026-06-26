export type AuditEventType =
  | "call.session.open"
  | "call.start"
  | "model.invoke"
  | "tool.call"
  | "phi.access"
  | "context.retrieve"
  | "prediction.update"
  | "compliance.flag"
  | "call.escalate"
  | "call.complete";

export type AuditActor = "agent" | "payer" | "system" | "operator";
export type Redaction = "none" | "redacted" | "tokenized";

export interface AuditEvent {
  seq: number;
  id: string;
  type: AuditEventType;
  /** Offset from call start, ms. */
  atMs: number;
  /** Display clock (wall time when a base is known, else relative T+). */
  clock: string;
  actor: AuditActor;
  summary: string;
  model?: string;
  promptVersion?: string;
  tool?: string;
  toolStatus?: "ok" | "warn" | "error";
  phi: boolean;
  phiScope?: string;
  redaction: Redaction;
  /** Tamper-evident chain. */
  hash: string;
  prevHash: string;
}

export interface LedgerContext {
  modelId: string;
  modelLabel: string;
  promptVersion: string;
  /** Wall-clock ms at call start; when present, events render real times. */
  baseWallMs?: number;
}
