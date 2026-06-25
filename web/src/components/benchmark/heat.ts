import type { BenchCell } from "@/lib/benchmark/data";
import { clamp } from "@/lib/format";

/**
 * Heatmap scale + goodness logic for the dark scorecard matrix. Hue ramps
 * red (6) → green (136) by relative goodness; backgrounds stay deep and
 * saturated with light text so revealed cells pop against the dark canvas.
 */
export const RANGES: Record<keyof BenchCell, { lo: number; hi: number; higher: boolean } | undefined> = {
  modelId: undefined,
  scenarioId: undefined,
  taskCompletion: { lo: 0.5, hi: 0.98, higher: true },
  p50LatencyMs: { lo: 260, hi: 900, higher: false },
  costUsd: { lo: 0, hi: 0.03, higher: false },
  toolValidity: { lo: 0.6, hi: 0.99, higher: true },
  hallucinationRisk: { lo: 0.02, hi: 0.22, higher: false },
  predictionCalibration: { lo: 0.6, hi: 0.96, higher: true },
};

/** 0 (worst) → 1 (best) for a value/metric, accounting for higher-is-better. */
export function goodness(value: number, key: keyof BenchCell): number {
  const r = RANGES[key];
  if (!r) return 0.5;
  const norm = clamp((value - r.lo) / (r.hi - r.lo), 0, 1);
  return r.higher ? norm : 1 - norm;
}

/**
 * Dark-mode heat style: deep saturated background that intensifies with
 * goodness, paired with bright text in the same hue. Hue ramps red → green.
 */
export function heatStyle(value: number, key: keyof BenchCell): React.CSSProperties {
  const g = goodness(value, key);
  const hue = 6 + g * 130; // red → green
  // Strength: even the worst cells keep a faint tint; best cells glow.
  const strength = 0.18 + g * 0.42;
  return {
    backgroundColor: `hsl(${hue} 70% 22% / ${strength})`,
    color: `hsl(${hue} 85% 78%)`,
    boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 50% / ${0.12 + g * 0.28})`,
  };
}
