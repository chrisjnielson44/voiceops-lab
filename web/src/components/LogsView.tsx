"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, ShieldAlert, Wrench } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/cn";

interface CallSummary {
  id: string;
  scenarioId: string | null;
  payer: string | null;
  outcome: string | null;
  status: string | null;
  eventCount: number;
  startedAt: string | null;
}
interface CallEvent {
  seq: number | null;
  type: string | null;
  atMs: number | null;
  actor: string | null;
  summary: string | null;
  tool: string | null;
  phi: boolean;
}
interface CallDetail {
  run: CallSummary;
  events: CallEvent[];
}

type Filter = "all" | "tool" | "phi";

function fmtStarted(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function LogsView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Logs" />
      <EventStream />
    </div>
  );
}

function EventStream() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const { data: calls, isLoading } = useQuery({
    queryKey: ["calls"],
    queryFn: async () => {
      const r = await fetch("/api/calls");
      if (!r.ok) throw new Error(`calls ${r.status}`);
      return (await r.json()) as { hasData: boolean; calls: CallSummary[] };
    },
  });

  const runs = useMemo(() => calls?.calls ?? [], [calls?.calls]);
  // Auto-select the most recent run once the list loads.
  useEffect(() => {
    if (!selected && runs.length) setSelected(runs[0].id);
  }, [runs, selected]);

  const { data: detail, isFetching } = useQuery({
    queryKey: ["call", selected],
    enabled: !!selected,
    queryFn: async () => {
      const r = await fetch(`/api/calls/${selected}`);
      if (!r.ok) throw new Error(`call ${r.status}`);
      return (await r.json()) as CallDetail;
    },
  });

  const events = useMemo(() => {
    const all = detail?.events ?? [];
    if (filter === "tool") return all.filter((e) => e.tool);
    if (filter === "phi") return all.filter((e) => e.phi);
    return all;
  }, [detail, filter]);

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!calls?.hasData) {
    return (
      <Card>
        <CardContent className="flex h-40 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-foreground">No events yet</p>
          <p className="text-xs text-muted-foreground">Run a session in the Playground or Simulator to record events.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      {/* Run picker */}
      <Card className="overflow-hidden">
        <ScrollArea className="max-h-[70vh]">
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-accent",
                    selected === r.id && "bg-accent",
                  )}
                >
                  <span className="truncate text-sm font-medium text-foreground">{r.payer ?? "Call"}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{r.scenarioId ?? ""}</span>
                  <span className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{fmtStarted(r.startedAt)}</span>
                    <span className="tabular">{r.eventCount} events</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Card>

      {/* Timeline */}
      <Card className="flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">
            {detail?.run.payer ?? "Events"}
          </span>
          <div className="flex gap-1">
            {(["all", "tool", "phi"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors",
                  filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="max-h-[64vh] flex-1">
          <div className="p-3">
            {isFetching && !detail ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : events.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                No matching events.
              </div>
            ) : (
              <ol className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {events.map((e, i) => (
                    <motion.li
                      key={`${e.seq}-${i}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="rounded-xl border border-border bg-card/40 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular w-7 shrink-0 font-mono text-[10px] text-muted-foreground">
                          #{e.seq ?? i}
                        </span>
                        <StatusChip tone={e.phi ? "violet" : "slate"}>{e.type ?? "event"}</StatusChip>
                        {e.tool && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Wrench className="h-3 w-3" /> {e.tool}
                          </span>
                        )}
                        {e.phi && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-violet-500">
                            <ShieldAlert className="h-3 w-3" /> PHI
                          </span>
                        )}
                        {e.actor && (
                          <span className="ml-auto text-[10px] text-muted-foreground">{titleCase(e.actor)}</span>
                        )}
                      </div>
                      {e.summary && <p className="mt-1 pl-9 text-xs leading-snug text-foreground/85">{e.summary}</p>}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
