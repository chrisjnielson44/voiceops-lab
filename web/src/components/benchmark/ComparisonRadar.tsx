"use client";

import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { BenchAggregate } from "@/lib/benchmark/data";
import { clamp } from "@/lib/format";

/**
 * Radar comparison of the top models across normalized 0–100 axes. Latency and
 * hallucination are inverted so that "further from center = better" holds on
 * every axis, keeping the shape readable at a glance.
 */

const AXES: { key: string; label: string; from: (r: BenchAggregate) => number }[] = [
  { key: "completion", label: "Completion", from: (r) => r.taskCompletion * 100 },
  { key: "tools", label: "Tool validity", from: (r) => r.toolValidity * 100 },
  { key: "calibration", label: "Calibration", from: (r) => r.predictionCalibration * 100 },
  { key: "trust", label: "Trust", from: (r) => (1 - r.hallucinationRisk) * 100 },
  { key: "speed", label: "Speed", from: (r) => clamp(1 - (r.p50LatencyMs - 200) / 1000, 0, 1) * 100 },
];

const SERIES_VARS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-4))"];

export function ComparisonRadar({ rows }: { rows: BenchAggregate[] }) {
  const top = rows.slice(0, 3);

  const { data, config } = useMemo(() => {
    const cfg: ChartConfig = {};
    top.forEach((row, i) => {
      cfg[row.model.id] = { label: row.model.label, color: SERIES_VARS[i] ?? SERIES_VARS[0] };
    });

    const rowsData = AXES.map((axis) => {
      const point: Record<string, string | number> = { axis: axis.label };
      for (const row of top) point[row.model.id] = Math.round(axis.from(row));
      return point;
    });

    return { data: rowsData, config: cfg };
  }, [top]);

  if (top.length === 0) return null;

  return (
    <ChartContainer config={config} className="aspect-square max-h-[300px] w-full">
      <RadarChart data={data} outerRadius="72%">
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="axis"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <PolarRadiusAxis
          domain={[0, 100]}
          tick={false}
          axisLine={false}
          tickCount={5}
        />
        {top.map((row, i) => {
          const color = SERIES_VARS[i] ?? SERIES_VARS[0];
          return (
            <Radar
              key={row.model.id}
              name={row.model.label}
              dataKey={row.model.id}
              stroke={color}
              fill={color}
              fillOpacity={0.16}
              strokeWidth={2}
              dot={{ r: 2.5, fillOpacity: 1 }}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
            />
          );
        })}
        <ChartLegend content={<ChartLegendContent />} />
      </RadarChart>
    </ChartContainer>
  );
}
