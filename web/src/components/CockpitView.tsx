"use client";

import { useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  Activity,
  Wrench,
  Lock,
  TriangleAlert,
  Coins,
  Cpu,
  AlertCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallStore } from "@/state/useCallStore";
import type { ProviderStatusResponse } from "@/state/useProviderStatus";
import { ModelRouterBar } from "@/components/ModelRouterBar";
import { CallControls } from "@/components/CallControls";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { PredictivePanel } from "@/components/PredictivePanel";
import { AuditLedger } from "@/components/AuditLedger";
import { Segmented } from "@/components/ui/Segmented";
import { MotionItem, MotionStagger } from "@/components/ui/motion";
import { cn } from "@/lib/cn";

function MiniStat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <MotionItem className="liquid-glass flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground ring-1 ring-inset ring-border",
          accent,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="tabular text-base font-semibold leading-tight text-foreground">{value}</div>
        <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      </div>
    </MotionItem>
  );
}

function LiveCallStrip() {
  const metrics = useCallStore((s) => s.metrics);
  const m = metrics ?? {
    inferences: 0,
    toolCalls: 0,
    phiAccesses: 0,
    toolErrors: 0,
    promptTokens: 0,
    completionTokens: 0,
    avgLatencyMs: 0,
  };
  return (
    <MotionStagger className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <MiniStat icon={<Cpu className="h-4 w-4" />} label="Avg model latency" value={m.avgLatencyMs ? `${m.avgLatencyMs}ms` : "—"} />
      <MiniStat icon={<Activity className="h-4 w-4" />} label="Inferences" value={`${m.inferences}`} />
      <MiniStat icon={<Wrench className="h-4 w-4" />} label="Tool calls" value={`${m.toolCalls}`} />
      <MiniStat
        icon={<Lock className="h-4 w-4" />}
        label="PHI access events"
        value={`${m.phiAccesses}`}
        accent="bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20"
      />
      <MiniStat
        icon={<TriangleAlert className="h-4 w-4" />}
        label="Tool errors"
        value={`${m.toolErrors}`}
        accent={m.toolErrors ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20" : undefined}
      />
      <MiniStat icon={<Coins className="h-4 w-4" />} label="Tokens generated" value={m.completionTokens ? `${m.completionTokens}` : "—"} />
    </MotionStagger>
  );
}

export function CockpitView({ providerStatus }: { providerStatus: ProviderStatusResponse | null }) {
  const error = useCallStore((s) => s.error);
  const [sidecar, setSidecar] = useState<"predictive" | "audit">("predictive");

  return (
    <div className="flex flex-col gap-4">
      <ModelRouterBar providerStatus={providerStatus} />

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="glass flex items-center gap-2 rounded-2xl border-amber-500/20 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <CallControls />
        </div>
        <div className="lg:col-span-5">
          <TranscriptPanel />
        </div>
        <div className="flex flex-col gap-3 lg:col-span-4">
          <Segmented
            value={sidecar}
            onChange={setSidecar}
            options={[
              { value: "predictive", label: <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Predictive</span> },
              { value: "audit", label: <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Audit ledger</span> },
            ]}
          />
          <div className="flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={sidecar}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
              >
                {sidecar === "predictive" ? <PredictivePanel /> : <AuditLedger />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <LiveCallStrip />
    </div>
  );
}
