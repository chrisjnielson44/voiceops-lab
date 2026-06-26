"use client";

import { AnimatePresence, motion } from "framer-motion";
import { GitBranch, Loader2, Zap } from "lucide-react";

import { useCallStore } from "@/state/useCallStore";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import type { PrefetchRecord } from "@/lib/graph/types";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

function prefetchMeta(status: PrefetchRecord["status"]): { tone: Tone; label: string } {
  if (status === "hit") return { tone: "green", label: "cache hit" };
  if (status === "ready") return { tone: "blue", label: "prefetched" };
  if (status === "prefetching") return { tone: "amber", label: "warming" };
  if (status === "evicted") return { tone: "slate", label: "served" };
  return { tone: "slate", label: status };
}

/**
 * Anticipation decomposition tree: the predictor's forecast of the next exchange
 * rendered as a tree — root "next payer turn" decomposes into ranked candidate
 * intents (confidence-weighted), each branching to the read tool it would need
 * and that tool's speculative-prefetch status. Replaces the flat bars.
 */
export function PredictionTree() {
  const predictionSet = useCallStore((s) => s.predictionSet);
  const prefetch = useCallStore((s) => s.prefetch);
  const status = useCallStore((s) => s.status);
  const predictions = (predictionSet?.predictions ?? []).slice(0, 3);
  const prefetchByLabel = new Map(Object.values(prefetch).map((r) => [r.label, r]));

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground"><GitBranch className="h-4 w-4" /></span>
          <div className="min-w-0">
            <CardTitle className="truncate">Anticipation</CardTitle>
            <p className="truncate text-xs text-muted-foreground">Forecast of the next exchange, decomposed</p>
          </div>
        </div>
        {predictionSet && (predictionSet.hitRate > 0 || Object.keys(prefetch).length > 0) && (
          <StatusChip tone="green" dot>{formatPercent(predictionSet.hitRate)} hit</StatusChip>
        )}
      </CardHeader>

      <div className="p-4">
        {predictions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {status === "idle" ? "Start a session — the predictor forecasts each next exchange." : "Awaiting the first forecast…"}
          </p>
        ) : (
          <div>
            {/* root */}
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              </span>
              <span className="text-xs font-semibold text-foreground">Next payer turn</span>
            </div>

            <ul className="mt-1">
              <AnimatePresence initial={false}>
                {predictions.map((p, i) => {
                  const last = i === predictions.length - 1;
                  const pct = Math.round(p.confidence * 100);
                  const pf = p.needsTool ? prefetchByLabel.get(p.needsTool) : undefined;
                  return (
                    <motion.li
                      key={p.intent + i}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="relative pl-6"
                    >
                      {/* tree connectors */}
                      <span className={cn("absolute left-2 top-0 border-l border-border", last ? "h-[18px]" : "h-full")} />
                      <span className="absolute left-2 top-[18px] w-3 border-t border-border" />

                      <div className="py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground">{p.intent}</span>
                          <span className="tabular ml-auto text-[10px] font-medium text-muted-foreground">{pct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <motion.div
                            className={cn("h-full rounded-full", i === 0 ? "bg-brand-500" : "bg-brand-500/60")}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                          />
                        </div>
                        {p.utterance && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={p.utterance}>
                            “{p.utterance}”
                          </p>
                        )}
                        {/* leaf: the tool this turn would need + prefetch status */}
                        {p.needsTool && (
                          <div className="relative mt-1 pl-5">
                            <span className="absolute left-1 top-0 h-[12px] border-l border-border/70" />
                            <span className="absolute left-1 top-[12px] w-3 border-t border-border/70" />
                            <div className="flex items-center gap-1.5 pt-1.5">
                              <span className="font-mono text-[10px] text-muted-foreground">{p.needsTool}</span>
                              {pf ? (
                                <StatusChip tone={prefetchMeta(pf.status).tone} dot={pf.status === "ready" || pf.status === "hit"}>
                                  {pf.status === "prefetching" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                  {pf.status === "hit" && <Zap className="h-2.5 w-2.5" />}
                                  {prefetchMeta(pf.status).label}
                                  {pf.savedMs && pf.status === "hit" ? ` ${pf.savedMs}ms` : ""}
                                </StatusChip>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/60">read tool</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
