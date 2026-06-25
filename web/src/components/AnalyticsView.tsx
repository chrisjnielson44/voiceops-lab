"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Table2,
  PieChart as PieIcon,
  Clock,
  Radio,
} from "lucide-react";
import {
  KPIS,
  PAYER_PERFORMANCE,
  OUTCOME_MIX,
  ANALYTICS_WINDOW,
  type KpiMetric,
  type MetricFormat,
} from "@/lib/analytics/data";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/Meter";
import { MotionStagger, MotionItem } from "@/components/ui/motion";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { formatCount, formatPercent, formatUsd } from "@/lib/format";
import { KpiSparkline } from "@/components/analytics/KpiSparkline";
import { OutcomeDonut } from "@/components/analytics/OutcomeDonut";
import { CallVolumeChart } from "@/components/analytics/CallVolumeChart";

interface LiveTotals {
  totalCalls: number;
  completionRate: number;
  escalationRate: number;
  avgHandleTimeSec: number;
  phiAccessEvents: number;
  toolCalls: number;
}

function ahtLabel(sec: number): string {
  return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

/* ------------------------------ Live ops strip ----------------------------- */

function LiveOpsStrip() {
  // TanStack Query: cached/deduped/retried fetch of the live analytics rollup.
  const { data } = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const r = await fetch("/api/analytics");
      if (!r.ok) throw new Error(`analytics ${r.status}`);
      return r.json() as Promise<{ hasData?: boolean; totals?: LiveTotals }>;
    },
  });
  const hasData = Boolean(data?.hasData);
  const totals: LiveTotals | null = data?.totals ?? null;

  const cards = [
    { label: "Calls run", value: totals ? formatCount(totals.totalCalls) : "0" },
    { label: "Completion", value: totals ? formatPercent(totals.completionRate) : "—" },
    { label: "Escalation", value: totals ? formatPercent(totals.escalationRate) : "—" },
    {
      label: "Avg handle time",
      value: totals && totals.avgHandleTimeSec ? ahtLabel(totals.avgHandleTimeSec) : "—",
    },
    { label: "PHI access events", value: totals ? formatCount(totals.phiAccessEvents) : "0" },
    { label: "Tool calls", value: totals ? formatCount(totals.toolCalls) : "0" },
  ];

  return (
    <Card className="liquid-glass overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
            <Radio className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-sm">Live operations</CardTitle>
            <CardDescription className="text-[11px]">
              Aggregated from your real call runs (Neon)
            </CardDescription>
          </div>
        </div>
        <Badge variant={hasData ? "success" : "outline"} className="gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            {hasData ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            ) : null}
            <span
              className={cn(
                "relative inline-flex h-1.5 w-1.5 rounded-full",
                hasData ? "bg-emerald-400" : "bg-muted-foreground",
              )}
            />
          </span>
          {hasData ? "live data" : "no calls yet"}
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <MotionStagger className="grid grid-cols-2 gap-px bg-border/50 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((c) => (
            <MotionItem
              key={c.label}
              className="bg-transparent px-4 py-3.5 transition-colors hover:bg-accent/40"
            >
              <div className="tabular text-xl font-bold tracking-tight text-foreground">
                {c.value}
              </div>
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
            </MotionItem>
          ))}
        </MotionStagger>
      </CardContent>
    </Card>
  );
}

/* --------------------------------- KPIs ------------------------------------ */

function fmtValue(value: number, format: MetricFormat): string {
  switch (format) {
    case "percent":
      return formatPercent(value, value < 0.1 ? 1 : 0);
    case "duration":
      return ahtLabel(Math.round(value));
    case "ms":
      return `${Math.round(value)}ms`;
    case "usd":
      return formatUsd(value);
    case "count":
      return formatCount(value);
  }
}

function fmtDelta(delta: number, format: MetricFormat): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const abs = Math.abs(delta);
  switch (format) {
    case "percent":
      return `${sign}${(abs * 100).toFixed(1)} pts`;
    case "duration":
      return `${sign}${Math.round(abs)}s`;
    case "ms":
      return `${sign}${Math.round(abs)}ms`;
    case "usd":
      return `${sign}${formatUsd(abs)}`;
    case "count":
      return `${sign}${formatCount(abs)}`;
  }
}

function KpiCard({ kpi }: { kpi: KpiMetric }) {
  const flat = kpi.delta === 0;
  const improved = !flat && kpi.delta > 0 === kpi.higherIsBetter;
  const variant = flat ? "outline" : improved ? "success" : "destructive";
  const stroke = flat
    ? "hsl(var(--muted-foreground))"
    : improved
      ? "hsl(var(--chart-2))"
      : "hsl(var(--chart-5))";

  return (
    <MotionItem className="h-full">
      <Card className="liquid-glass group h-full transition-colors">
        <CardContent className="flex h-full flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{kpi.label}</span>
            <Badge variant={variant} className="gap-0.5 px-1.5 py-0 text-[10px]">
              {flat ? null : improved ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {fmtDelta(kpi.delta, kpi.format)}
            </Badge>
          </div>
          <div className="mt-1 tabular text-2xl font-bold tracking-tight text-foreground">
            {fmtValue(kpi.value, kpi.format)}
          </div>
          <div className="mt-2">
            <KpiSparkline trend={kpi.trend} stroke={stroke} />
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{kpi.hint}</p>
        </CardContent>
      </Card>
    </MotionItem>
  );
}

/* --------------------------------- View ------------------------------------ */

export function AnalyticsView() {
  return (
    <div className="flex flex-col gap-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="text-lg font-semibold text-foreground">Operations analytics</h1>
        <p className="text-xs text-muted-foreground">
          Live KPIs from your runs, over an illustrative fleet baseline
        </p>
      </motion.div>

      <LiveOpsStrip />

      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Fleet baseline
        </span>
        <span className="text-[11px] text-muted-foreground/70">
          · {ANALYTICS_WINDOW} · illustrative sample
        </span>
      </div>

      <MotionStagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
      </MotionStagger>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
              <Table2 className="h-4 w-4" />
            </span>
            <CardTitle className="text-sm">Payer &amp; scenario performance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Payer</th>
                    <th className="px-4 py-2.5 font-medium">Scenario</th>
                    <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                    <th className="px-4 py-2.5 font-medium">Completion</th>
                    <th className="px-4 py-2.5 text-right font-medium">AHT</th>
                    <th className="px-4 py-2.5 text-right font-medium">Escal.</th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost/call</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYER_PERFORMANCE.map((r, i) => (
                    <motion.tr
                      key={`${r.payer}-${r.scenario}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}
                      className="border-b border-border transition-colors last:border-0 hover:bg-accent"
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{r.payer}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-muted-foreground">{r.scenario}</span>
                        <span className="block text-[11px] text-muted-foreground/70">
                          {r.topIntent}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                        {formatCount(r.calls)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <ProgressBar
                            value={r.completionRate}
                            color={r.completionRate >= 0.85 ? "bg-emerald-500" : "bg-amber-500"}
                            className="h-1.5 w-16"
                          />
                          <span className="tabular text-xs text-muted-foreground">
                            {formatPercent(r.completionRate)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                        {ahtLabel(r.ahtSec)}
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
                      <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                        {formatUsd(r.costPerCall)}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <OutcomeDonut data={OUTCOME_MIX} />
            <ul className="flex-1 space-y-2">
              {OUTCOME_MIX.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="tabular ml-auto font-medium text-foreground">{s.value}%</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
              <BarChart3 className="h-4 w-4" />
            </span>
            <CardTitle className="text-sm">Call volume by hour</CardTitle>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> business hours
          </span>
        </CardHeader>
        <CardContent>
          <CallVolumeChart />
        </CardContent>
      </Card>
    </div>
  );
}
