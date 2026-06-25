import type { CallStatus, PredictionSnapshot, Scenario } from "../simulation/types";
import { revealedTurns } from "../simulation/engine";
import { chainHash, GENESIS_HASH } from "../hash";
import { formatClock, formatTimeOfDay } from "../format";
import type { AuditEvent, AuditEventType, LedgerContext, Redaction } from "./types";

/**
 * Canonical string used for the hash chain. Excludes wall-clock display so the
 * chain is stable. Shared by the live orchestrator and verifyLedger so
 * server-emitted events remain verifiable on the client.
 */
export function auditCanonical(e: {
  seq: number;
  type: string;
  atMs: number;
  actor: string;
  summary: string;
  tool?: string;
  phi: boolean;
  phiScope?: string;
  redaction: string;
  model?: string;
  promptVersion?: string;
}): string {
  return [
    e.seq,
    e.type,
    e.atMs,
    e.actor,
    e.summary,
    e.tool ?? "",
    e.phi ? "1" : "0",
    e.phiScope ?? "",
    e.redaction,
    e.model ?? "",
    e.promptVersion ?? "",
  ].join("|");
}

/**
 * Builds an append-only, hash-chained audit ledger from a scenario + elapsed
 * time. The chain hash is deterministic and excludes wall-clock display, so the
 * same call always produces the same integrity head — letting the UI show a
 * verifiable, "immutable-looking" record. (Production would chain SHA-256.)
 */

interface Draft {
  type: AuditEventType;
  atMs: number;
  actor: AuditEvent["actor"];
  summary: string;
  model?: string;
  promptVersion?: string;
  tool?: string;
  toolStatus?: AuditEvent["toolStatus"];
  phi: boolean;
  phiScope?: string;
  redaction: Redaction;
}

function phiScopeFrom(args: Record<string, string>): string | undefined {
  const key = args.member_id ?? args.claim_id ?? args.auth_id;
  if (!key) return undefined;
  // Show only a tokenized tail to reflect minimum-necessary access.
  return `member:***${key.slice(-4)}`;
}

export function buildLedger(
  scenario: Scenario,
  elapsedMs: number,
  status: CallStatus,
  ctx: LedgerContext,
): AuditEvent[] {
  const drafts: Draft[] = [];

  drafts.push({
    type: "call.session.open",
    atMs: 0,
    actor: "operator",
    summary: "Operator opened a secure VoiceOps session (demo mode).",
    phi: false,
    redaction: "none",
  });

  if (status !== "idle") {
    drafts.push({
      type: "call.start",
      atMs: 0,
      actor: "operator",
      summary: `Outbound call initiated to ${scenario.payer} (${scenario.payerId}) — ${scenario.category}.`,
      model: ctx.modelId,
      promptVersion: ctx.promptVersion,
      phi: false,
      redaction: "none",
    });

    for (const turn of revealedTurns(scenario, elapsedMs)) {
      if (turn.tool) {
        const t = turn.tool;
        drafts.push({
          type: "tool.call",
          atMs: turn.atMs,
          actor: "agent",
          summary: `${t.label}(${Object.keys(t.args).join(", ")}) → ${t.result}`,
          model: ctx.modelId,
          promptVersion: ctx.promptVersion,
          tool: t.tool,
          toolStatus: t.status,
          phi: t.phi,
          phiScope: t.phi ? phiScopeFrom(t.args) : undefined,
          redaction: t.phi ? "tokenized" : "none",
        });
        if (t.phi) {
          drafts.push({
            type: "phi.access",
            atMs: turn.atMs,
            actor: "agent",
            summary: `PHI accessed for ${t.label} (minimum-necessary scope).`,
            phi: true,
            phiScope: phiScopeFrom(t.args),
            redaction: "tokenized",
          });
        }
      } else if (turn.speaker === "agent") {
        drafts.push({
          type: "model.invoke",
          atMs: turn.atMs,
          actor: "agent",
          summary: `Agent turn generated: "${turn.text.slice(0, 72)}${turn.text.length > 72 ? "…" : ""}"`,
          model: ctx.modelId,
          promptVersion: ctx.promptVersion,
          phi: Boolean(turn.phi),
          redaction: turn.phi ? "redacted" : "none",
        });
      }

      if (turn.compliance) {
        drafts.push({
          type: "compliance.flag",
          atMs: turn.atMs,
          actor: "system",
          summary: turn.compliance,
          phi: false,
          redaction: "none",
        });
      }
      if (turn.predict?.completionProbability !== undefined) {
        drafts.push({
          type: "prediction.update",
          atMs: turn.atMs,
          actor: "system",
          summary: `Prediction updated — completion ${(turn.predict.completionProbability * 100).toFixed(
            0,
          )}%, escalation ${((turn.predict.escalationRisk ?? scenario.baselineEscalationRisk) * 100).toFixed(0)}%.`,
          phi: false,
          redaction: "none",
        });
      }
    }

    if (status === "completed") {
      drafts.push({
        type: "call.complete",
        atMs: scenario.totalDurationMs,
        actor: "system",
        summary: "Call objective met — record finalized and written back.",
        model: ctx.modelId,
        promptVersion: ctx.promptVersion,
        phi: false,
        redaction: "none",
      });
    } else if (status === "escalated") {
      drafts.push({
        type: "call.escalate",
        atMs: scenario.totalDurationMs,
        actor: "system",
        summary: "Call escalated to a human specialist — hand-off packet queued.",
        model: ctx.modelId,
        promptVersion: ctx.promptVersion,
        phi: true,
        phiScope: "handoff:packet",
        redaction: "tokenized",
      });
    }
  }

  // Seal the chain.
  const events: AuditEvent[] = [];
  let prevHash = GENESIS_HASH;
  drafts.forEach((d, i) => {
    const hash = chainHash(prevHash, auditCanonical({ seq: i, ...d }));
    events.push({
      seq: i,
      id: `evt-${i.toString().padStart(3, "0")}`,
      clock: ctx.baseWallMs ? formatTimeOfDay(ctx.baseWallMs + d.atMs) : `T+${formatClock(d.atMs)}`,
      ...d,
      hash,
      prevHash,
    });
    prevHash = hash;
  });
  return events;
}

/** Recompute the chain to confirm nothing was tampered with. */
export function verifyLedger(events: AuditEvent[]): boolean {
  let prevHash = GENESIS_HASH;
  for (const e of events) {
    const expected = chainHash(prevHash, auditCanonical(e));
    if (expected !== e.hash || e.prevHash !== prevHash) return false;
    prevHash = e.hash;
  }
  return true;
}

export interface AuditExport {
  generatedBy: string;
  exportedAtOffsetMs: number;
  call: {
    scenarioId: string;
    title: string;
    payer: string;
    payerId: string;
    category: string;
    status: CallStatus;
    model: string;
    promptVersion: string;
  };
  prediction: PredictionSnapshot;
  integrity: { algorithm: string; head: string; eventCount: number; verified: boolean };
  events: AuditEvent[];
}

export function buildAuditExport(
  scenario: Scenario,
  elapsedMs: number,
  status: CallStatus,
  prediction: PredictionSnapshot,
  ctx: LedgerContext,
): AuditExport {
  const events = buildLedger(scenario, elapsedMs, status, ctx);
  return {
    generatedBy: "VoiceOps Lab — demo audit export",
    exportedAtOffsetMs: elapsedMs,
    call: {
      scenarioId: scenario.id,
      title: scenario.title,
      payer: scenario.payer,
      payerId: scenario.payerId,
      category: scenario.category,
      status,
      model: ctx.modelLabel,
      promptVersion: ctx.promptVersion,
    },
    prediction,
    integrity: {
      algorithm: "cyrb53-chain (demo stand-in for SHA-256)",
      head: events.length ? events[events.length - 1].hash : "",
      eventCount: events.length,
      verified: verifyLedger(events),
    },
    events,
  };
}
