"use client";

import { useQuery } from "@tanstack/react-query";
import { Table2, PieChart as PieIcon, BarChart3, Cpu, Download, Inbox, Loader2 } from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Progress } from "@/components/ui/progress";
import { MotionStagger, MotionItem } from "@/components/ui/motion";
import { cn } from "@/lib/cn";
import { formatCount, formatPercent } from "@/lib/format";
import { OutcomeDonut, type OutcomeSlice } from "@/components/analytics/OutcomeDonut";
import { CallVolumeChart } from "@/components/analytics/CallVolumeChart";

interface Totals {
  totalCalls: number;
  completionRate: number;
  escalationRate: number;
  avgHandleTimeSec: number;
  phiAccessEvents: number;
  toolCalls: number;
}
interface PayerRow {
  payer: string;
  calls: number;
  completionRate: number;
  escalationRate: number;
  ahtSec: number;
}
interface ModelRow {
  model: string;
  calls: number;
  completionRate: number;
  escalationRate: number;
  ahtSec: number;
}
interface AnalyticsResponse {
  hasData: boolean;
  totals?: Totals;
  payers?: PayerRow[];
  models?: ModelRow[];
  volumeByHour?: { hour: string; calls: number }[];
}

function ahtLabel(sec: number): string {
  if (!sec) return "—";
  return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

function shortModel(id: string): string {
  return (id.split("/").pop() ?? id).replace(/-4bit$/i, "").replace(/-Instruct/i, "");
}

export function AnalyticsView() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const r = await fetch("/api/analytics");
      if (!r.ok) throw new Error(`analytics ${r.status}`);
      return r.json() as Promise<AnalyticsResponse>;
    },
  });

  const totals = data?.totals;
  const payers = data?.payers ?? [];
  const models = data?.models ?? [];
  const volume = data?.volumeByHour ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operations analytics"
        actions={
          data?.hasData && (
            <Button variant="outline" size="sm" onClick={() => exportCsv(payers, models)}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          )
        }
      />

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Inbox className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No calls recorded yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Run a session in the Playground or Simulator. Every run persists to Neon and these
              analytics populate from real data — nothing here is simulated.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Real KPI tiles */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <MotionStagger className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: "Calls run", value: formatCount(totals!.totalCalls) },
                  { label: "Completion", value: formatPercent(totals!.completionRate) },
                  { label: "Escalation", value: formatPercent(totals!.escalationRate) },
                  { label: "Avg handle time", value: ahtLabel(totals!.avgHandleTimeSec) },
                  { label: "PHI access events", value: formatCount(totals!.phiAccessEvents) },
                  { label: "Tool calls", value: formatCount(totals!.toolCalls) },
                ].map((c) => (
                  <MotionItem key={c.label} className="bg-card px-4 py-3.5">
                    <div className="tabular text-xl font-bold tracking-tight text-foreground">{c.value}</div>
                    <div className="text-[11px] text-muted-foreground">{c.label}</div>
                  </MotionItem>
                ))}
              </MotionStagger>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
                  <Table2 className="h-4 w-4" />
                </span>
                <CardTitle className="text-sm">Payer performance</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <PerfTable rows={payers} firstCol="Payer" keyOf={(r) => (r as PayerRow).payer} labelOf={(r) => (r as PayerRow).payer} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
                  <PieIcon className="h-4 w-4" />
                </span>
                <CardTitle className="text-sm">Outcome mix</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <OutcomeDonut data={outcomeSlices(totals!)} />
                <ul className="flex-1 space-y-2">
                  {outcomeSlices(totals!).map((s) => (
                    <li key={s.label} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="tabular ml-auto font-medium text-foreground">{s.value}%</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {models.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
                  <Cpu className="h-4 w-4" />
                </span>
                <CardTitle className="text-sm">Model performance (measured from runs)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <PerfTable rows={models} firstCol="Model" keyOf={(r) => (r as ModelRow).model} labelOf={(r) => shortModel((r as ModelRow).model)} mono />
              </CardContent>
            </Card>
          )}

          {volume.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
                  <BarChart3 className="h-4 w-4" />
                </span>
                <CardTitle className="text-sm">Call volume by hour</CardTitle>
              </CardHeader>
              <CardContent>
                <CallVolumeChart data={volume} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function exportCsv(payers: PayerRow[], models: ModelRow[]): void {
  const lines: string[] = ["section,name,calls,completion_rate,escalation_rate,aht_sec"];
  for (const p of payers) lines.push(`payer,${csv(p.payer)},${p.calls},${p.completionRate},${p.escalationRate},${p.ahtSec}`);
  for (const m of models) lines.push(`model,${csv(m.model)},${m.calls},${m.completionRate},${m.escalationRate},${m.ahtSec}`);
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "voicelabs-analytics.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function outcomeSlices(t: Totals): OutcomeSlice[] {
  const resolved = Math.round(t.completionRate * 100);
  const escalated = Math.round(t.escalationRate * 100);
  const other = Math.max(0, 100 - resolved - escalated);
  return [
    { label: "Resolved", value: resolved, color: "hsl(var(--chart-2))" },
    { label: "Escalated", value: escalated, color: "hsl(var(--chart-5))" },
    { label: "Other", value: other, color: "hsl(var(--muted-foreground))" },
  ];
}

interface Row {
  calls: number;
  completionRate: number;
  escalationRate: number;
  ahtSec: number;
}

function PerfTable<T extends Row>({
  rows,
  firstCol,
  keyOf,
  labelOf,
  mono,
}: {
  rows: T[];
  firstCol: string;
  keyOf: (r: T) => string;
  labelOf: (r: T) => string;
  mono?: boolean;
}) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">{firstCol}</th>
            <th className="px-4 py-2.5 text-right font-medium">Calls</th>
            <th className="px-4 py-2.5 font-medium">Completion</th>
            <th className="px-4 py-2.5 text-right font-medium">Escal.</th>
            <th className="px-4 py-2.5 text-right font-medium">AHT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={keyOf(r)} className="border-b border-border transition-colors last:border-0 hover:bg-accent">
              <td className={cn("px-4 py-2.5 font-medium text-foreground", mono && "font-mono text-xs")}>{labelOf(r)}</td>
              <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{formatCount(r.calls)}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Progress
                    value={r.completionRate * 100}
                    className="h-1.5 w-16"
                    indicatorClassName={r.completionRate >= 0.85 ? "bg-emerald-500" : "bg-amber-500"}
                  />
                  <span className="tabular text-xs text-muted-foreground">{formatPercent(r.completionRate)}</span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right">
                <span
                  className={cn(
                    "tabular text-xs font-medium",
                    r.escalationRate >= 0.25
                      ? "text-red-600 dark:text-red-400"
                      : r.escalationRate >= 0.15
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  {formatPercent(r.escalationRate)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{ahtLabel(r.ahtSec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
