"use client";

import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Square,
  User,
  Building2,
  FileText,
  Check,
  Lock,
  PhoneCall,
} from "lucide-react";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/components/ui/motion";
import { useCallStore } from "@/state/useCallStore";
import { useScenario } from "@/state/useScenario";
import { PHASES } from "@/lib/simulation/engine";
import type { CallStatus } from "@/lib/simulation/types";
import { Card } from "@/components/ui/card";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";

const STATUS_META: Record<CallStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  idle: { tone: "slate", label: "Idle" },
  dialing: { tone: "blue", label: "Connecting…", pulse: true },
  active: { tone: "green", label: "On call", pulse: true },
  paused: { tone: "amber", label: "Paused" },
  completed: { tone: "green", label: "Completed" },
  escalated: { tone: "amber", label: "Escalated" },
};

function useElapsedMs(startedWallMs: number | null, status: CallStatus): number {
  const [now, setNow] = useState(() => Date.now());
  const live = status === "active" || status === "dialing" || status === "paused";
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [live]);
  if (!startedWallMs) return 0;
  return Math.max(0, now - startedWallMs);
}

/** Signature element: a frosted call orb that breathes while the agent talks. */
function CallOrb({ active }: { active: boolean }) {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      <motion.span
        transition={{ duration: 0.4 }}
        className={cn(
          "relative flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-pop",
          active && "ring-2 ring-emerald-500/40",
        )}
      >
        {active ? (
          <span className="flex h-4 items-end gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="eq-bar h-4 animate-bar-bounce" style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </span>
        ) : (
          <PhoneCall className="h-5 w-5" />
        )}
      </motion.span>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-medium text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}

export function CallControls() {
  const scenarioId = useCallStore((s) => s.scenarioId);
  const status = useCallStore((s) => s.status);
  const phase = useCallStore((s) => s.phase);
  const startedWallMs = useCallStore((s) => s.startedWallMs);
  const runId = useCallStore((s) => s.runId);
  const start = useCallStore((s) => s.start);
  const pause = useCallStore((s) => s.pause);
  const resume = useCallStore((s) => s.resume);
  const stop = useCallStore((s) => s.stop);

  const { data: scenario } = useScenario(scenarioId);
  const patient = scenario?.patient;
  const claim = scenario?.claim;
  const provider = scenario?.provider;
  const meta = STATUS_META[status];
  const running = status === "active" || status === "dialing";
  const elapsedMs = useElapsedMs(startedWallMs, status);

  const onPrimary = running ? pause : status === "paused" ? resume : start;
  const primaryLabel = running ? "Pause" : status === "paused" ? "Resume" : "Start call";

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <CallOrb active={status === "active"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{scenario?.payer ?? "—"}</div>
          <div className="text-xs text-muted-foreground">
            {scenario?.payerId ?? "—"} · {(scenario?.category ?? "").replace("-", " ")}
          </div>
        </div>
        <StatusChip tone={meta.tone} dot pulse={meta.pulse}>
          {meta.label}
        </StatusChip>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-end justify-between">
          <div className="tabular text-3xl font-semibold tracking-tight text-foreground">{formatClock(elapsedMs)}</div>
          <div className="text-xs text-muted-foreground">real-time · local model</div>
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            onClick={onPrimary}
            className={cn(
              "flex-1",
              running && "bg-amber-500 text-primary-foreground hover:bg-amber-600",
            )}
          >
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {primaryLabel}
          </Button>
          <Button
            type="button"
            variant="glass"
            onClick={stop}
            disabled={!runId || status === "idle"}
          >
            <Square className="h-4 w-4" />
            End
          </Button>
        </div>
      </div>

      {/* Phase stepper */}
      <div className="border-t border-border px-4 py-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Call phase</div>
        <motion.ol variants={staggerContainer} initial="hidden" animate="show" className="space-y-1.5">
          {PHASES.map((label, i) => {
            const done = i < phase || status === "completed" || status === "escalated";
            const current = i === phase && running;
            return (
              <motion.li key={label} variants={fadeUp} className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors",
                    done
                      ? "bg-emerald-500 text-white"
                      : current
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/60 text-muted-foreground ring-1 ring-inset ring-border",
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-sm transition-colors",
                    done ? "text-foreground" : current ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
                {current && (
                  <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-brand-700 dark:text-brand-300">active</span>
                )}
              </motion.li>
            );
          })}
        </motion.ol>
      </div>

      {/* Member context */}
      <div className="border-t border-border px-4 py-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Member context</span>
          <StatusChip tone="violet" className="ml-auto">
            <Lock className="h-3 w-3" /> PHI
          </StatusChip>
        </div>
        <Field label="Patient" value={patient?.name ?? "—"} />
        <Field label="Member ID" value={patient?.memberId ?? "—"} mono />
        <Field label="DOB" value={patient?.dob ?? "—"} mono />
        {claim && (
          <>
            <Field label="Claim / Auth" value={claim.id} mono />
            <Field label="DOS / CPT" value={`${claim.dos} · ${claim.cpt}`} mono />
          </>
        )}
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Provider</span>
        </div>
        <Field label="Practice" value={provider?.name ?? "—"} />
        <Field label="NPI" value={provider?.npi ?? "—"} mono />
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Objective</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{scenario?.objective ?? "—"}</p>
      </div>
    </Card>
  );
}
