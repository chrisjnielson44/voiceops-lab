"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export interface OutcomeSlice {
  label: string;
  value: number;
  color: string;
}

/**
 * Donut for the real outcome mix of persisted runs. Center label shows the
 * "Resolved" (completed) share.
 */
export function OutcomeDonut({ data }: { data: OutcomeSlice[] }) {
  const resolved = data.find((d) => d.label === "Resolved")?.value ?? 0;

  return (
    <div className="relative h-[180px] w-[180px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={56}
            outerRadius={82}
            paddingAngle={2}
            stroke="transparent"
            startAngle={90}
            endAngle={-270}
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          >
            {data.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-2xl font-bold tracking-tight text-foreground">{resolved}%</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">resolved</span>
      </div>
    </div>
  );
}
