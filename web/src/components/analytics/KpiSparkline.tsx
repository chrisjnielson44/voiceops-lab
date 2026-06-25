"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { useId } from "react";

/**
 * Tiny animated area sparkline for KPI cards. Renders kpi.trend (14 pts).
 * Color encodes whether the metric improved (green) / worsened (red) / flat.
 */
export function KpiSparkline({
  trend,
  stroke,
}: {
  trend: number[];
  stroke: string;
}) {
  const gradId = useId().replace(/:/g, "");
  const data = trend.map((v, i) => ({ i, v }));
  const min = Math.min(...trend);
  const max = Math.max(...trend);
  // pad domain so the line is not flush against edges
  const pad = (max - min || 1) * 0.15;

  return (
    <div className="h-9 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[min - pad, max + pad]} />
          <Area
            dataKey="v"
            type="monotone"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#spark-${gradId})`}
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
