"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FlaskConical, Play, RotateCcw, Trophy, Cloud, Server, Radar as RadarIcon } from "lucide-react";
import {
  BENCH_SCENARIOS,
  BENCH_MODEL_IDS,
  BENCH_METRICS,
  makeMatrix,
  aggregate,
  type BenchCell,
} from "@/lib/benchmark/data";
import { getModel } from "@/lib/providers/registry";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/Meter";
import { fadeUp } from "@/components/ui/motion";
import { cn } from "@/lib/cn";
import { formatPercent, formatUsd } from "@/lib/format";
import { goodness, heatStyle } from "@/components/benchmark/heat";
import { ComparisonRadar } from "@/components/benchmark/ComparisonRadar";

function fmtMetric(value: number, format: "percent" | "ms" | "usd"): string {
  if (format === "percent") return formatPercent(value, 0);
  if (format === "ms") return `${Math.round(value)}ms`;
  return formatUsd(value);
}

export function BenchmarkView() {
  const cells = useMemo(() => makeMatrix(), []);
  const total = cells.length;

  const [revealed, setRevealed] = useState(total);
  const [running, setRunning] = useState(false);
  const [metricKey, setMetricKey] = useState<keyof BenchCell>("taskCompletion");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const run = () => {
    if (timer.current) clearInterval(timer.current);
    setRunning(true);
    setRevealed(0);
    timer.current = setInterval(() => {
      setRevealed((r) => {
        const next = r + 1;
        if (next >= total) {
          if (timer.current) clearInterval(timer.current);
          setRunning(false);
          return total;
        }
        return next;
      });
    }, 70);
  };

  const revealedCells = cells.slice(0, revealed);
  const leaderboard = useMemo(
    () => aggregate(revealedCells.length ? revealedCells : cells),
    [revealedCells, cells],
  );
  const activeMetric = BENCH_METRICS.find((m) => m.key === metricKey)!;

  const cellIndex = (modelIdx: number, scenIdx: number) =>
    modelIdx * BENCH_SCENARIOS.length + scenIdx;

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.07 } } }}
      className="flex flex-col gap-4"
    >
      {/* Header */}
      <motion.div
        variants={fadeUp}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground ring-1 ring-inset ring-border">
            <FlaskConical className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              Model &amp; provider benchmarks
            </h1>
            <p className="text-xs text-muted-foreground">
              {BENCH_MODEL_IDS.length} models × {BENCH_SCENARIOS.length} payer scenarios · deterministic scorecard
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {running && (
            <div className="flex items-center gap-2">
              <span className="tabular text-xs text-muted-foreground">
                {revealed}/{total}
              </span>
              <ProgressBar value={revealed / total} className="h-1.5 w-28" />
            </div>
          )}
          <Button onClick={run} disabled={running}>
            {running ? (
              <RotateCcw className="animate-spin" />
            ) : (
              <Play />
            )}
            {running ? "Running…" : "Run benchmark"}
          </Button>
        </div>
      </motion.div>

      {/* Leaderboard */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div className="flex-1">
              <CardTitle>Leaderboard</CardTitle>
              <CardDescription>
                Composite score: completion, tool validity, hallucination, calibration, latency
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 text-right font-medium">Completion</th>
                    <th className="px-4 py-2 text-right font-medium">p50</th>
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
                    <th className="px-4 py-2 text-right font-medium">Halluc.</th>
                    <th className="px-4 py-2 text-right font-medium">Calib.</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, i) => {
                    const isTop = i === 0;
                    return (
                      <motion.tr
                        key={row.model.id}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                        className={cn(
                          "border-b border-border last:border-0 transition-colors hover:bg-accent",
                          isTop && "bg-amber-500/10",
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset",
                              isTop
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20"
                                : "bg-secondary/60 text-muted-foreground ring-border",
                            )}
                          >
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {row.model.kind === "local" ? (
                                <Server className="h-3.5 w-3.5" />
                              ) : (
                                <Cloud className="h-3.5 w-3.5" />
                              )}
                            </span>
                            <span className="font-medium text-foreground">{row.model.label}</span>
                            <Badge variant={row.model.kind === "local" ? "secondary" : "outline"}>
                              {row.model.family}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                              <motion.div
                                className={cn(
                                  "h-full rounded-full",
                                  isTop ? "bg-amber-400" : "bg-brand-500",
                                )}
                                initial={{ width: 0 }}
                                animate={{ width: `${row.score}%` }}
                                transition={{ duration: 0.7, delay: 0.1 + i * 0.04, ease: "easeOut" }}
                              />
                            </div>
                            <span
                              className={cn(
                                "tabular w-9 text-xs font-semibold",
                                isTop ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                              )}
                            >
                              {row.score.toFixed(1)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                          {formatPercent(row.taskCompletion)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                          {Math.round(row.p50LatencyMs)}ms
                        </td>
                        <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                          {formatUsd(row.costUsd)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                          {formatPercent(row.hallucinationRisk, 1)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                          {formatPercent(row.predictionCalibration)}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Comparison radar */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <RadarIcon className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <CardTitle>Top model comparison</CardTitle>
              <CardDescription>
                Top {Math.min(3, leaderboard.length)} models · normalized 0–100 axes (further = better)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ComparisonRadar rows={leaderboard} />
          </CardContent>
        </Card>
      </motion.div>

      {/* Matrix heatmap */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              <div>
                <CardTitle>Scorecard matrix</CardTitle>
                <CardDescription>Models × payer scenarios · {activeMetric.label}</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {BENCH_METRICS.map((m) => (
                <Button
                  key={m.key}
                  type="button"
                  size="sm"
                  variant={metricKey === m.key ? "default" : "glass"}
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => setMetricKey(m.key)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[680px] border-separate border-spacing-1">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {activeMetric.label}
                    </th>
                    {BENCH_SCENARIOS.map((s) => (
                      <th key={s.id} className="px-2 py-1 text-center text-[11px] font-medium text-foreground">
                        <div>{s.label}</div>
                        <div className="font-normal text-muted-foreground">{s.payer}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BENCH_MODEL_IDS.map((modelId, mi) => {
                    const model = getModel(modelId);
                    return (
                      <tr key={modelId}>
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">
                              {model.kind === "local" ? (
                                <Server className="h-3 w-3" />
                              ) : (
                                <Cloud className="h-3 w-3" />
                              )}
                            </span>
                            {model.label}
                          </div>
                        </td>
                        {BENCH_SCENARIOS.map((s, si) => {
                          const cell = cells.find(
                            (c) => c.modelId === modelId && c.scenarioId === s.id,
                          )!;
                          const isRevealed = cellIndex(mi, si) < revealed;
                          const value = cell[metricKey] as number;
                          const g = goodness(value, metricKey);
                          return (
                            <td key={s.id} className="p-0">
                              {isRevealed ? (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.85 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                                  className="rounded-md px-2 py-2 text-center text-xs font-semibold tabular"
                                  style={heatStyle(value, metricKey)}
                                  title={`${model.label} · ${s.label} — ${Math.round(g * 100)}/100`}
                                >
                                  {fmtMetric(value, activeMetric.format)}
                                </motion.div>
                              ) : (
                                <div className="rounded-md bg-secondary/60 px-2 py-2 text-center text-xs text-muted-foreground/50">
                                  {running ? "···" : "—"}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Deterministic harness — re-running yields identical scores. Cells shade red→green by relative
              performance for the selected metric ({activeMetric.higherIsBetter ? "higher is better" : "lower is better"}).
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
