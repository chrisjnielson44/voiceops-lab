"use client";

import { useMemo, useState } from "react";
import { ShieldCheck, Copy, Download, Check, Lock, Hash, Fingerprint } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallStore } from "@/state/useCallStore";
import { getScenario } from "@/lib/simulation/scenarios";
import { verifyLedger } from "@/lib/audit/ledger";
import type { AuditEventType } from "@/lib/audit/types";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";

const TYPE_META: Record<AuditEventType, { tone: Tone; label: string }> = {
  "call.session.open": { tone: "slate", label: "session" },
  "call.start": { tone: "blue", label: "call.start" },
  "model.invoke": { tone: "blue", label: "model" },
  "tool.call": { tone: "violet", label: "tool" },
  "phi.access": { tone: "violet", label: "phi" },
  "prediction.update": { tone: "slate", label: "predict" },
  "compliance.flag": { tone: "amber", label: "compliance" },
  "call.escalate": { tone: "amber", label: "escalate" },
  "call.complete": { tone: "green", label: "complete" },
};

export function AuditLedger() {
  const audit = useCallStore((s) => s.audit);
  const prediction = useCallStore((s) => s.prediction);
  const scenarioId = useCallStore((s) => s.scenarioId);
  const status = useCallStore((s) => s.status);
  const modelLabel = useCallStore((s) => s.modelLabel);
  const [copied, setCopied] = useState(false);

  const scenario = getScenario(scenarioId);
  const verified = useMemo(() => (audit.length ? verifyLedger(audit) : true), [audit]);
  const head = audit.length ? audit[audit.length - 1].hash : "";

  const exportJson = () =>
    JSON.stringify(
      {
        generatedBy: "VoiceOps Lab — live audit export",
        call: { scenarioId: scenario.id, payer: scenario.payer, payerId: scenario.payerId, status, model: modelLabel },
        prediction,
        integrity: {
          algorithm: "cyrb53-chain (demo stand-in for SHA-256)",
          head,
          eventCount: audit.length,
          verified,
        },
        events: audit,
      },
      null,
      2,
    );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportJson());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voiceops-audit-${scenario.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel className="h-full">
      <PanelHeader
        title="Audit ledger"
        icon={<ShieldCheck className="h-4 w-4" />}
        subtitle={`${audit.length} events · append-only · hash-chained`}
        right={
          <StatusChip tone={verified ? "green" : "red"} dot>
            {verified ? "chain verified" : "chain broken"}
          </StatusChip>
        }
      />

      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0">head</span>
          <span className="truncate font-mono text-foreground">{head ? `${head.slice(0, 18)}…` : "—"}</span>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!audit.length}
            className="glass-inset flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!audit.length}
            className="glass-inset flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </button>
        </div>
      </div>

      <div className="scroll-thin min-h-[320px] flex-1 overflow-y-auto px-2 py-2">
        {audit.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-center text-xs text-muted-foreground">
            No events yet. Start a call to record the audit trail.
          </div>
        ) : (
          <ol className="space-y-1">
            <AnimatePresence initial={false}>
              {audit.map((e) => {
                const meta = TYPE_META[e.type];
                return (
                  <motion.li
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    className="rounded-xl px-2 py-1.5 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="tabular w-7 shrink-0 text-right text-[10px] text-muted-foreground">
                        {e.seq.toString().padStart(2, "0")}
                      </span>
                      <span className="tabular shrink-0 font-mono text-[10px] text-muted-foreground">{e.clock}</span>
                      <StatusChip tone={meta?.tone ?? "slate"}>{meta?.label ?? e.type}</StatusChip>
                      {e.phi && (
                        <StatusChip tone="violet">
                          <Lock className="h-3 w-3" /> PHI
                        </StatusChip>
                      )}
                    </div>
                    <div className="mt-1 pl-9 text-xs leading-snug text-foreground/80">{e.summary}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-9 text-[10px] text-muted-foreground">
                      <span>actor: {e.actor}</span>
                      {e.tool && <span>· tool: {e.tool}</span>}
                      {e.phiScope && <span>· scope: {e.phiScope}</span>}
                      <span>· redaction: {e.redaction}</span>
                      <span className="inline-flex items-center gap-0.5">
                        · <Hash className="h-2.5 w-2.5" />
                        <span className="font-mono">{e.hash.slice(0, 10)}</span>
                      </span>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </Panel>
  );
}
