"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { History, Loader2, PlayCircle, ShieldAlert, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusChip } from "@/components/ui/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent, titleCase } from "@/lib/format";

interface CallSummary {
  id: string;
  scenarioId: string | null;
  payer: string | null;
  model: string | null;
  status: string | null;
  outcome: string | null;
  completionProb: number | null;
  escalationRisk: number | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  eventCount: number;
}

interface CallEvent {
  seq: number | null;
  type: string | null;
  atMs: number | null;
  actor: string | null;
  summary: string | null;
  model: string | null;
  tool: string | null;
  phi: boolean;
  phiScope: string | null;
  payload: unknown;
}

interface CallDetail {
  run: CallSummary;
  events: CallEvent[];
}

function outcomeVariant(outcome: string | null): "success" | "warning" | "destructive" | "secondary" {
  if (outcome === "completed") return "success";
  if (outcome === "escalated") return "warning";
  if (outcome === "failed" || outcome === "abandoned") return "destructive";
  return "secondary";
}

function modelLabel(id?: string | null): string {
  if (!id) return "—";
  return (id.split("/").pop() ?? id).replace(/-4bit$/i, "").replace(/-Instruct/i, "");
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function fmtStarted(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CallHistoryView() {
  const [openId, setOpenId] = useState<string | null>(null);
  const navigate = useNavigate();
  const openInStudio = (runId: string) => navigate({ to: "/studio", search: { runId } });
  const { data, isLoading } = useQuery({
    queryKey: ["calls"],
    queryFn: async () => {
      const r = await fetch("/api/calls");
      if (!r.ok) throw new Error(`calls ${r.status}`);
      return (await r.json()) as { hasData: boolean; calls: CallSummary[] };
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Call History</h1>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <History className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col gap-2 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-9 w-24" />
                  <Skeleton className="h-9 w-16" />
                </div>
              ))}
            </div>
          ) : !data?.hasData ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
              <p className="text-sm font-medium text-foreground">No calls yet</p>
              <p className="text-xs text-muted-foreground">Runs from the Playground and Simulator appear here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Payer / Scenario</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                  <TableHead className="text-right">Replay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.calls.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                    <TableCell>
                      <div className="font-medium text-foreground">{c.payer ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{c.scenarioId ?? ""}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{modelLabel(c.model)}</TableCell>
                    <TableCell>
                      <Badge variant={outcomeVariant(c.outcome)}>{c.outcome ?? c.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{fmtDuration(c.durationSec)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{c.eventCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtStarted(c.startedAt)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openInStudio(c.id)} title="Replay in Studio">
                        <PlayCircle className="h-4 w-4" /> Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CallDetailSheet runId={openId} onClose={() => setOpenId(null)} onOpenStudio={openInStudio} />
    </div>
  );
}

function CallDetailSheet({ runId, onClose, onOpenStudio }: { runId: string | null; onClose: () => void; onOpenStudio: (id: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["call", runId],
    enabled: !!runId,
    queryFn: async () => {
      const r = await fetch(`/api/calls/${runId}`);
      if (!r.ok) throw new Error(`call ${r.status}`);
      return (await r.json()) as CallDetail;
    },
  });

  const run = data?.run;

  return (
    <Sheet open={!!runId} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="right" className="w-full overflow-hidden sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{run?.payer ?? "Call run"}</SheetTitle>
          <SheetDescription className="font-mono text-[11px]">{runId}</SheetDescription>
        </SheetHeader>
        {runId && (
          <Button className="mt-3 w-full" onClick={() => onOpenStudio(runId)}>
            <PlayCircle className="h-4 w-4" /> Open in Studio
          </Button>
        )}

        {isLoading || !run ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-5 flex h-[calc(100%-5rem)] flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Outcome" value={run.outcome ?? run.status ?? "—"} />
              <Stat label="Duration" value={fmtDuration(run.durationSec)} />
              <Stat label="Completion" value={run.completionProb != null ? formatPercent(run.completionProb) : "—"} />
              <Stat label="Escalation" value={run.escalationRisk != null ? formatPercent(run.escalationRisk) : "—"} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Event timeline
              </span>
              <span className="text-xs text-muted-foreground">{data.events.length} events</span>
            </div>

            <ScrollArea className="-mr-4 flex-1 pr-4">
              <ol className="space-y-2">
                {data.events.map((e, i) => (
                  <li key={i} className="rounded-lg border border-border bg-card/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">#{e.seq ?? i}</span>
                      <StatusChip tone={e.phi ? "violet" : "slate"}>{e.type ?? "event"}</StatusChip>
                      {e.tool && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Wrench className="h-3 w-3" />
                          {e.tool}
                        </span>
                      )}
                      {e.phi && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-violet-500">
                          <ShieldAlert className="h-3 w-3" />
                          PHI
                        </span>
                      )}
                    </div>
                    {e.summary && <p className="mt-1 text-xs text-foreground/85">{e.summary}</p>}
                    {e.actor && <p className="mt-0.5 text-[10px] text-muted-foreground">{titleCase(e.actor)}</p>}
                  </li>
                ))}
              </ol>
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
