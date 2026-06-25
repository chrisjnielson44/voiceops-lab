import { cn } from "@/lib/cn";
import { clamp } from "@/lib/format";

/** Horizontal progress / value meter. */
export function ProgressBar({
  value,
  color = "bg-primary",
  track = "bg-secondary",
  height = "h-2",
  className,
}: {
  value: number; // 0..1
  color?: string;
  track?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-hidden rounded-full", track, height, className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", color)}
        style={{ width: `${clamp(value, 0, 1) * 100}%` }}
      />
    </div>
  );
}

/** Radial progress ring with arbitrary centered content. */
export function Gauge({
  value,
  size = 116,
  stroke = 10,
  color = "hsl(var(--primary))",
  track = "hsl(var(--secondary))",
  children,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * clamp(value, 0, 1);
  const center = size / 2;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
