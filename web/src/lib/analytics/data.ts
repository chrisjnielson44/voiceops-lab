import { seededRandom } from "../hash";

/**
 * Deterministic analytics demo data. Trend series are generated from a fixed
 * seed so the dashboard renders identically on server and client (no hydration
 * drift) and looks the same on every load — important for a reproducible demo.
 */

export type MetricFormat = "percent" | "duration" | "ms" | "usd" | "count";

export interface KpiMetric {
  id: string;
  label: string;
  value: number;
  format: MetricFormat;
  /** Change vs prior 14-day window, in the metric's native unit. */
  delta: number;
  /** Whether a positive delta is good (e.g. completion up = good). */
  higherIsBetter: boolean;
  trend: number[];
  hint: string;
}

function makeTrend(seed: number, base: number, drift: number, jitter: number, points = 14): number[] {
  const rand = seededRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const trendComponent = base + (drift * i) / points;
    const noise = (rand() - 0.5) * 2 * jitter;
    out.push(Math.max(0, trendComponent + noise));
  }
  return out;
}

export const KPIS: KpiMetric[] = [
  {
    id: "completion_rate",
    label: "Completion rate",
    value: 0.91,
    format: "percent",
    delta: 0.03,
    higherIsBetter: true,
    trend: makeTrend(101, 0.85, 0.06, 0.02),
    hint: "Calls resolved autonomously without human hand-off.",
  },
  {
    id: "aht",
    label: "Avg handle time",
    value: 168,
    format: "duration",
    delta: -12,
    higherIsBetter: false,
    trend: makeTrend(102, 192, -22, 8),
    hint: "Mean call duration from connect to disposition.",
  },
  {
    id: "latency_p50",
    label: "Model latency p50",
    value: 540,
    format: "ms",
    delta: -38,
    higherIsBetter: false,
    trend: makeTrend(103, 600, -60, 25),
    hint: "Median time-to-first-token across routed models.",
  },
  {
    id: "cost_per_call",
    label: "Cost / successful call",
    value: 0.038,
    format: "usd",
    delta: -0.005,
    higherIsBetter: false,
    trend: makeTrend(104, 0.05, -0.012, 0.004),
    hint: "Blended model + telephony cost per resolved call.",
  },
  {
    id: "escalation_rate",
    label: "Escalation rate",
    value: 0.14,
    format: "percent",
    delta: -0.021,
    higherIsBetter: false,
    trend: makeTrend(105, 0.19, -0.05, 0.015),
    hint: "Share of calls routed to a human specialist.",
  },
  {
    id: "tool_error_rate",
    label: "Tool error rate",
    value: 0.021,
    format: "percent",
    delta: -0.006,
    higherIsBetter: false,
    trend: makeTrend(106, 0.03, -0.01, 0.005),
    hint: "Failed or invalid tool invocations per call.",
  },
  {
    id: "phi_access",
    label: "PHI access events",
    value: 1284,
    format: "count",
    delta: 142,
    higherIsBetter: true,
    trend: makeTrend(107, 980, 320, 60),
    hint: "Logged minimum-necessary PHI reads (all audited).",
  },
  {
    id: "compliance_warnings",
    label: "Compliance warnings",
    value: 7,
    format: "count",
    delta: -3,
    higherIsBetter: false,
    trend: makeTrend(108, 13, -7, 2),
    hint: "Open compliance flags requiring review this window.",
  },
];

export interface PayerPerformanceRow {
  payer: string;
  scenario: string;
  calls: number;
  completionRate: number;
  ahtSec: number;
  escalationRate: number;
  costPerCall: number;
  topIntent: string;
}

export const PAYER_PERFORMANCE: PayerPerformanceRow[] = [
  { payer: "Aetna", scenario: "Eligibility", calls: 412, completionRate: 0.95, ahtSec: 142, escalationRate: 0.06, costPerCall: 0.031, topIntent: "benefit accumulators" },
  { payer: "UnitedHealthcare", scenario: "Claim status", calls: 388, completionRate: 0.9, ahtSec: 176, escalationRate: 0.12, costPerCall: 0.04, topIntent: "denial reason" },
  { payer: "Cigna", scenario: "Prior auth", calls: 207, completionRate: 0.71, ahtSec: 233, escalationRate: 0.29, costPerCall: 0.058, topIntent: "clinical criteria" },
  { payer: "BCBS", scenario: "Eligibility", calls: 351, completionRate: 0.93, ahtSec: 151, escalationRate: 0.08, costPerCall: 0.034, topIntent: "COB / other coverage" },
  { payer: "Humana", scenario: "Claim status", calls: 264, completionRate: 0.88, ahtSec: 184, escalationRate: 0.15, costPerCall: 0.043, topIntent: "timely filing" },
  { payer: "Centene", scenario: "Prior auth", calls: 119, completionRate: 0.68, ahtSec: 248, escalationRate: 0.33, costPerCall: 0.061, topIntent: "peer-to-peer" },
];

export interface OutcomeSlice {
  label: string;
  value: number;
  color: string;
}

export const OUTCOME_MIX: OutcomeSlice[] = [
  { label: "Resolved", value: 78, color: "#16a34a" },
  { label: "Escalated", value: 14, color: "#f59e0b" },
  { label: "Transferred", value: 5, color: "#3366f6" },
  { label: "Abandoned", value: 3, color: "#dc2626" },
];

/** Call volume by hour (08:00–19:00), deterministic. */
export const CALLS_BY_HOUR: { hour: string; calls: number }[] = (() => {
  const rand = seededRandom(220);
  const hours = ["8a", "9a", "10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p", "7p"];
  const shape = [0.4, 0.7, 0.95, 1, 0.75, 0.6, 0.85, 0.9, 0.8, 0.65, 0.45, 0.3];
  return hours.map((hour, i) => ({
    hour,
    calls: Math.round(40 + shape[i] * 160 + (rand() - 0.5) * 24),
  }));
})();

export const ANALYTICS_WINDOW = "Trailing 14 days · 1,741 calls";
