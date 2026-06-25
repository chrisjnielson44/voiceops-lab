/**
 * Small, dependency-free formatting helpers shared across the cockpit.
 * Kept pure so they render identically on the server and the client.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Smoothstep easing — used to shape probability curves over call progress. */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** "m:ss" clock from milliseconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Compact duration, e.g. "1m 20s" or "850ms". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Format a wall-clock timestamp (ms since epoch) as HH:MM:SS. */
export function formatTimeOfDay(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function titleCase(value: string): string {
  return value.replace(/(^|[\s_-])(\w)/g, (_, sep, ch) => `${sep === "_" || sep === "-" ? " " : sep}${ch.toUpperCase()}`);
}
