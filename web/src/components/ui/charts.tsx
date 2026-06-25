import { cn } from "@/lib/cn";

/** Minimal SVG sparkline with optional area fill and end dot. */
export function Sparkline({
  data,
  width = 132,
  height = 40,
  stroke = "#3366f6",
  fill = "rgba(51,102,246,0.10)",
  showDot = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  showDot?: boolean;
}) {
  if (data.length === 0) return null;
  const pad = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${height - pad} L${pts[0][0].toFixed(1)} ${height - pad} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={area} fill={fill} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {showDot && <circle cx={last[0]} cy={last[1]} r={2.5} fill={stroke} />}
    </svg>
  );
}

/** Vertical bar chart built from divs (easy to label + responsive). */
export function MiniBars({
  data,
  color = "bg-brand-500",
  highlightColor = "bg-brand-600",
  className,
}: {
  data: { label: string; value: number }[];
  color?: string;
  highlightColor?: string;
  className?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cn("flex h-full items-end gap-1.5", className)}>
      {data.map((d) => {
        const isMax = d.value === max;
        return (
          <div key={d.label} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div
              className={cn("w-full rounded-t-sm transition-all", isMax ? highlightColor : color)}
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.label}: ${d.value}`}
            />
            <span className="text-[10px] tabular-nums text-muted-foreground">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Donut chart using stroke-dasharray arcs. */
export function Donut({
  slices,
  size = 140,
  stroke = 18,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
  stroke?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  let offset = 0;
  return (
    <svg width={size} height={size} className="-rotate-90">
      {slices.map((s) => {
        const len = (s.value / total) * c;
        const circle = (
          <circle
            key={s.label}
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return circle;
      })}
    </svg>
  );
}
