"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "framer-motion";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const config = {
  calls: { label: "Calls", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

/** Bar chart of real call volume by hour-of-day (from persisted runs). */
export function CallVolumeChart({ data }: { data: { hour: string; calls: number }[] }) {
  const reduce = useReducedMotion();
  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} tickMargin={4} fontSize={11} width={40} allowDecimals={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar
          dataKey="calls"
          fill="var(--color-calls)"
          radius={[6, 6, 0, 0]}
          isAnimationActive={!reduce}
          animationDuration={750}
          animationEasing="ease-out"
        />
      </BarChart>
    </ChartContainer>
  );
}
