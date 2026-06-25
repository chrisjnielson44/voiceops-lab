"use client";

import {
  Sparkles,
  MessageSquareText,
  ListChecks,
  Timer,
  TriangleAlert,
  CircleCheck,
  Brain,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallStore } from "@/state/useCallStore";
import { getScenario } from "@/lib/simulation/scenarios";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Gauge, ProgressBar } from "@/components/ui/Meter";
import { StatusChip } from "@/components/ui/StatusChip";
import { cn } from "@/lib/cn";
import { formatClock, formatPercent } from "@/lib/format";

function riskTone(risk: number): { hex: string; tone: "green" | "amber" | "red" } {
  if (risk >= 0.6) return { hex: "#f87171", tone: "red" };
  if (risk >= 0.3) return { hex: "#fbbf24", tone: "amber" };
  return { hex: "#34d399", tone: "green" };
}

export function PredictivePanel() {
  const scenarioId = useCallStore((s) => s.scenarioId);
  const prediction = useCallStore((s) => s.prediction);
  const modelLabel = useCallStore((s) => s.modelLabel);
  const status = useCallStore((s) => s.status);
  const scenario = getScenario(scenarioId);

  const totalFields = scenario.requiredFields.length;
  const missing = prediction?.missingFields ?? scenario.requiredFields;
  const capturedCount = Math.max(0, totalFields - missing.length);
  const completion = prediction?.completionProbability ?? 0;
  const escalation = prediction?.escalationRisk ?? 0;
  const risk = riskTone(escalation);

  return (
    <Panel className="h-full">
      <PanelHeader
        title="Predictive sidecar"
        icon={<Sparkles className="h-4 w-4" />}
        subtitle="Forecasts inferred live by the local model"
        right={<StatusChip tone="violet">{modelLabel}</StatusChip>}
      />

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!prediction && (
          <div className="glass-inset rounded-2xl px-3 py-2 text-xs text-muted-foreground">
            {status === "idle"
              ? "Start a call — the predictor runs a fresh inference after each payer turn."
              : "Awaiting the first prediction from the model…"}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="glass-inset flex flex-col items-center rounded-2xl py-3">
            <Gauge value={completion} color="#34d399" size={108}>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={formatPercent(completion)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="tabular text-2xl font-bold text-foreground"
                >
                  {formatPercent(completion)}
                </motion.span>
              </AnimatePresence>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">complete</span>
            </Gauge>
            <span className="mt-1 text-xs font-medium text-muted-foreground">Completion probability</span>
          </div>
          <div className="glass-inset flex flex-col items-center rounded-2xl py-3">
            <Gauge value={escalation} color={risk.hex} size={108}>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={formatPercent(escalation)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="tabular text-2xl font-bold text-foreground"
                >
                  {formatPercent(escalation)}
                </motion.span>
              </AnimatePresence>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">risk</span>
            </Gauge>
            <span className="mt-1 text-xs font-medium text-muted-foreground">Escalation risk</span>
          </div>
        </div>

        <div className="glass-inset rounded-2xl p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Next likely payer response</span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            “{prediction?.nextPayerResponse ?? "Waiting for the call to begin."}”
          </p>
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar value={prediction?.nextResponseConfidence ?? 0} color="bg-brand-500" className="h-1.5" />
            <span className="tabular shrink-0 text-[11px] text-muted-foreground">
              {formatPercent(prediction?.nextResponseConfidence ?? 0)} conf.
            </span>
          </div>
        </div>

        <div className="glass-inset rounded-2xl p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Required fields</span>
            <span className="ml-auto tabular text-[11px] text-muted-foreground">
              {capturedCount}/{totalFields} captured
            </span>
          </div>
          <ProgressBar value={totalFields ? capturedCount / totalFields : 0} color="bg-emerald-500" className="mb-2 h-1.5" />
          {missing.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="h-4 w-4" /> All required fields captured
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>
                {missing.map((f) => (
                  <motion.span
                    key={f}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-md bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20"
                  >
                    {f}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="glass-inset rounded-2xl p-3">
            <div className="mb-1 flex items-center gap-1.5">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Est. remaining</span>
            </div>
            <div className="tabular text-xl font-semibold text-foreground">
              {prediction ? formatClock(prediction.estRemainingMs) : "—"}
            </div>
          </div>
          <div
            className={cn(
              "rounded-2xl p-3 ring-1 ring-inset",
              risk.tone === "red"
                ? "bg-red-500/10 ring-red-500/20"
                : risk.tone === "amber"
                  ? "bg-amber-500/10 ring-amber-500/20"
                  : "bg-emerald-500/10 ring-emerald-500/20",
            )}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <TriangleAlert
                className={cn("h-4 w-4", risk.tone === "red" ? "text-red-600 dark:text-red-400" : risk.tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}
              />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Outlook</span>
            </div>
            <div
              className={cn(
                "text-sm font-semibold",
                risk.tone === "red" ? "text-red-600 dark:text-red-400" : risk.tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {risk.tone === "red" ? "Escalation likely" : risk.tone === "amber" ? "Watch closely" : "On track"}
            </div>
          </div>
        </div>

        <div className="glass-inset rounded-2xl p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Model rationale</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {prediction?.rationale ?? "The predictor will explain its reasoning as the call unfolds."}
          </p>
        </div>
      </div>
    </Panel>
  );
}
