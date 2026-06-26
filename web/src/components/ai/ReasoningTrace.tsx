"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Brain, ChevronRight, Database, Network, Target, Zap } from "lucide-react";

import type { LiveReasoning, ReasoningSegment } from "@/lib/agent/types";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { Shimmer } from "@/components/ai/Shimmer";
import { cn } from "@/lib/cn";

const NODE_COLOR: Record<string, string> = {
  member: "#6366f1",
  coverage: "#10b981",
  plan: "#14b8a6",
  claim: "#f59e0b",
  carc: "#ef4444",
  auth: "#8b5cf6",
  provider: "#64748b",
  payer: "#3b82f6",
};

const PHASE_META: Record<ReasoningSegment["phase"], { icon: typeof Brain; tint: string; ring: string }> = {
  retrieve: { icon: Network, tint: "text-indigo-600 dark:text-indigo-300", ring: "bg-indigo-500/10" },
  think: { icon: Brain, tint: "text-amber-600 dark:text-amber-300", ring: "bg-amber-500/10" },
  anticipate: { icon: Target, tint: "text-emerald-600 dark:text-emerald-300", ring: "bg-emerald-500/10" },
};

/**
 * The agent thinking out loud, inline above its turn — Vercel AI Elements style.
 * Auto-opens while the reasoning model streams (shimmer "Thinking…"), then settles
 * to "Thought for Ns" and auto-collapses. Renders the trace as a timeline: the
 * context-graph walk (sources), the streamed chain-of-thought, and the weighed
 * predictions (task list).
 */
export function ReasoningTrace({ reasoning }: { reasoning: LiveReasoning }) {
  const streaming = !!reasoning.streaming;
  const [open, setOpen] = useState(streaming);
  const userToggled = useRef(false);

  useEffect(() => {
    if (userToggled.current) return;
    if (streaming) {
      setOpen(true);
      return;
    }
    // Auto-collapse shortly after the stream settles (AI-Elements behavior).
    const id = setTimeout(() => {
      if (!userToggled.current) setOpen(false);
    }, 1400);
    return () => clearTimeout(id);
  }, [streaming]);

  const seconds = reasoning.durationMs != null ? Math.max(1, Math.round(reasoning.durationMs / 1000)) : null;
  const headline = streaming ? (
    <Shimmer className="text-xs font-medium">Thinking…</Shimmer>
  ) : (
    <span className="text-xs font-medium text-foreground">{seconds != null ? `Thought for ${seconds}s` : "Reasoning"}</span>
  );

  return (
    <div className="ml-10 rounded-2xl border border-dashed border-border bg-card/30">
      <button
        type="button"
        onClick={() => {
          userToggled.current = true;
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Brain className={cn("h-3.5 w-3.5 shrink-0 text-brand-500", streaming && "animate-pulse")} />
        {headline}
        {reasoning.model && (
          <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {reasoning.model.split("/").pop()}
          </span>
        )}
      </button>

      <CollapsibleContent open={open}>
        <div className="space-y-3 border-t border-border px-3 py-3">
          {reasoning.segments.map((seg, i) => (
            <Segment key={i} seg={seg} last={i === reasoning.segments.length - 1} streaming={streaming} />
          ))}
        </div>
      </CollapsibleContent>
    </div>
  );
}

function Segment({ seg, last, streaming }: { seg: ReasoningSegment; last: boolean; streaming: boolean }) {
  const meta = PHASE_META[seg.phase];
  const Icon = meta.icon;
  const thinkStreaming = streaming && seg.phase === "think";
  return (
    <div className="relative flex gap-2.5">
      <div className="flex flex-col items-center">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg", meta.ring, meta.tint)}>
          <Icon className={cn("h-3.5 w-3.5", thinkStreaming && "animate-pulse")} />
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-0.5">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {thinkStreaming ? <Shimmer>{seg.title}</Shimmer> : seg.title}
        </div>
        {seg.text && (
          <p
            className={cn(
              "text-xs leading-relaxed text-muted-foreground",
              seg.phase === "think" && "max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-foreground/80 scroll-thin",
            )}
          >
            {seg.text}
            {thinkStreaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-amber-500/70 align-middle" />}
          </p>
        )}

        {seg.phase === "retrieve" && seg.nodes && seg.nodes.length > 0 && <NodePath nodes={seg.nodes} />}
        {seg.phase === "anticipate" && seg.predictions && seg.predictions.length > 0 && <PredictionRows items={seg.predictions} />}
      </div>
    </div>
  );
}

function NodePath({ nodes }: { nodes: NonNullable<ReasoningSegment["nodes"]> }) {
  return (
    <div className="mt-1.5">
      <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground/70">
        <Database className="h-3 w-3" /> grounded on {nodes.length} record{nodes.length === 1 ? "" : "s"}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {nodes.map((n, i) => {
          const color = NODE_COLOR[n.type] ?? "#64748b";
          return (
            <span key={n.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/40">→</span>}
              <motion.span
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.22, delay: Math.min(i * 0.05, 0.4) }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-foreground",
                  n.seed ? "border-current/40" : "border-border",
                )}
                style={n.seed ? { boxShadow: `0 0 0 1px ${color}55`, color } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-foreground">{n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}</span>
                {n.seed && <span className="text-[9px] uppercase tracking-wide" style={{ color }}>seed</span>}
              </motion.span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PredictionRows({ items }: { items: NonNullable<ReasoningSegment["predictions"]> }) {
  return (
    <div className="mt-1.5 space-y-1.5">
      {items.map((p, i) => (
        <div key={p.intent + i} className="rounded-lg border border-border bg-card/40 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground">{p.intent}</span>
            {p.warmed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[9px] font-medium text-brand-600 dark:text-brand-300">
                <Zap className="h-2.5 w-2.5" /> prefetched
              </span>
            )}
            <span className="tabular ml-auto text-[10px] text-muted-foreground">{Math.round(p.confidence * 100)}%</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-brand-500"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(p.confidence * 100)}%` }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
