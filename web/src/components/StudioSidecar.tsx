"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, ListChecks, MessageSquareText } from "lucide-react";

import { useCallStore } from "@/state/useCallStore";
import { useScenario } from "@/state/useScenario";
import { ContextGraphView } from "@/components/ContextGraphView";
import { PredictionTree } from "@/components/PredictionTree";
import { Gauge } from "@/components/ui/Meter";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

function riskTone(risk: number): { hex: string; tone: "green" | "amber" | "red"; label: string } {
  if (risk >= 0.6) return { hex: "#f87171", tone: "red", label: "Escalation likely" };
  if (risk >= 0.3) return { hex: "#fbbf24", tone: "amber", label: "Watch closely" };
  return { hex: "#34d399", tone: "green", label: "On track" };
}

/**
 * The "live mind" right rail: the context graph (grows, pan/zoom), the
 * anticipation tree, and compact vitals. Laid out as a height-filling flex
 * column so it all fits on screen without scrolling — the graph flexes to fill
 * the slack while the tree and vitals stay compact.
 */
export function StudioSidecar() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* graph fills the available height (can shrink so the rail never scrolls) */}
      <div className="min-h-[170px] flex-1">
        <ContextGraphView />
      </div>

      {/* anticipation tree (compact) */}
      <div className="shrink-0">
        <PredictionTree />
      </div>

      {/* compact vitals: gauges + next-payer + fields + outlook, one card */}
      <VitalsCard />
    </div>
  );
}

/** Compact vitals: completion/escalation gauges, the predicted next payer line,
 *  required-field capture, and the outlook pill. Reused in the desktop rail and
 *  the mobile Predict tab. */
export function VitalsCard() {
  const scenarioId = useCallStore((s) => s.scenarioId);
  const prediction = useCallStore((s) => s.prediction);
  const { data: scenario } = useScenario(scenarioId);

  const requiredFields = scenario?.requiredFields ?? [];
  const total = requiredFields.length;
  const missing = prediction?.missingFields ?? requiredFields;
  const captured = Math.max(0, total - missing.length);
  const completion = prediction?.completionProbability ?? 0;
  const escalation = prediction?.escalationRisk ?? 0;
  const risk = riskTone(escalation);

  return (
    <div className="glass-card shrink-0 rounded-2xl p-3">
      <div className="flex items-stretch gap-3">
        <Vital label="Completion" value={completion} color="#34d399" />
        <Vital label="Escalation" value={escalation} color={risk.hex} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <div>
            <div className="mb-0.5 flex items-center gap-1.5">
              <MessageSquareText className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Next payer line</span>
            </div>
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={prediction?.nextPayerResponse}>
              “{prediction?.nextPayerResponse ?? "Waiting for the call to begin."}”
            </p>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <ListChecks className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Required fields</span>
              <span className="tabular ml-auto text-[10px] text-muted-foreground">{captured}/{total}</span>
            </div>
            <Progress value={(total ? captured / total : 0) * 100} className="h-1" indicatorClassName="bg-emerald-500" />
          </div>
        </div>
      </div>
      <div
        className={cn(
          "mt-2.5 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold ring-1 ring-inset",
          risk.tone === "red"
            ? "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400"
            : risk.tone === "amber"
              ? "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400"
              : "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400",
        )}
      >
        {missing.length === 0 && total > 0 ? <CircleCheck className="h-3.5 w-3.5" /> : null}
        {missing.length === 0 && total > 0 ? "All fields captured · " : ""}{risk.label}
      </div>
    </div>
  );
}

function Vital({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-xl bg-muted/40 px-2 py-2">
      <Gauge value={value} color={color} size={64}>
        <AnimatePresence mode="popLayout">
          <motion.span
            key={formatPercent(value)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="tabular text-sm font-bold text-foreground"
          >
            {formatPercent(value)}
          </motion.span>
        </AnimatePresence>
      </Gauge>
      <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
