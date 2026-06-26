import { cn } from "@/lib/cn";

/**
 * Brand mark: a five-bar audio waveform (a live input meter), center-weighted so
 * the middle bar is tallest. Idle = static bars; on hover the bars animate like a
 * speaking voice level. Drawn with `currentColor` so it inherits the surrounding
 * color. Animation lives in globals.css (`.wave-bar` / `@keyframes wave-eq`),
 * gated by `.logo-mark:hover` and disabled under prefers-reduced-motion.
 */
export function WaveMark({ className }: { className?: string }) {
  // [x, height] per bar; symmetric, tallest in the middle. Vertically centered
  // about the 24×24 box (y = (24 - height) / 2).
  const bars: [number, number][] = [
    [2.4, 9],
    [6.6, 15],
    [10.8, 21],
    [15.0, 15],
    [19.2, 9],
  ];
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("overflow-visible", className)}
      fill="currentColor"
      aria-hidden="true"
    >
      {bars.map(([x, h], i) => (
        <rect
          key={i}
          className="wave-bar"
          x={x}
          y={(24 - h) / 2}
          width={2.4}
          height={h}
          rx={1.2}
        />
      ))}
    </svg>
  );
}
