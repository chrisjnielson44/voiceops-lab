import { getModel, MODELS, type ModelInfo } from "../providers/registry";
import { seededFloat } from "../hash";
import { clamp } from "../format";

/**
 * Benchmark harness (deterministic). Each (model × scenario) cell is computed
 * from a hash seed shaped by the model's quality/latency/hallucination profile
 * and the scenario's difficulty. Re-running the benchmark yields identical
 * numbers — it is a reproducible scorecard, not random theater.
 */

export interface BenchScenario {
  id: string;
  label: string;
  payer: string;
  category: string;
  difficulty: "routine" | "moderate" | "complex";
}

export const BENCH_SCENARIOS: BenchScenario[] = [
  { id: "elig-aetna", label: "Eligibility", payer: "Aetna", category: "eligibility", difficulty: "routine" },
  { id: "elig-bcbs", label: "Eligibility (COB)", payer: "BCBS", category: "eligibility", difficulty: "moderate" },
  { id: "claim-uhc", label: "Claim status", payer: "UHC", category: "claim-status", difficulty: "moderate" },
  { id: "claim-humana", label: "Claim appeal", payer: "Humana", category: "claim-status", difficulty: "complex" },
  { id: "pa-cigna", label: "Prior auth", payer: "Cigna", category: "prior-auth", difficulty: "complex" },
];

/** Models included in the benchmark (the deterministic sim engine is excluded). */
export const BENCH_MODEL_IDS = MODELS.filter((m) => m.kind !== "demo").map((m) => m.id);

const DIFFICULTY: Record<BenchScenario["difficulty"], { completion: number; latency: number; tokens: number; hallu: number }> = {
  routine: { completion: 0.05, latency: 1.0, tokens: 1.0, hallu: 0.8 },
  moderate: { completion: -0.01, latency: 1.15, tokens: 1.3, hallu: 1.0 },
  complex: { completion: -0.1, latency: 1.35, tokens: 1.7, hallu: 1.35 },
};

export interface BenchCell {
  modelId: string;
  scenarioId: string;
  taskCompletion: number; // 0..1
  p50LatencyMs: number;
  costUsd: number;
  toolValidity: number; // 0..1
  hallucinationRisk: number; // 0..1 (lower better)
  predictionCalibration: number; // 0..1
}

export function makeCell(modelId: string, scenario: BenchScenario): BenchCell {
  const model = getModel(modelId);
  const d = DIFFICULTY[scenario.difficulty];
  const key = `${modelId}::${scenario.id}`;

  const taskCompletion = clamp(
    model.qualityIndex + d.completion + seededFloat(`${key}:tc`, -0.04, 0.04),
    0.35,
    0.99,
  );
  const p50LatencyMs = Math.round(
    model.baseLatencyMs * d.latency + seededFloat(`${key}:lat`, -45, 70),
  );
  const promptTokens = 1500 * d.tokens;
  const completionTokens = 320 * d.tokens;
  const costUsd =
    (promptTokens / 1000) * model.inputCostPer1k +
    (completionTokens / 1000) * model.outputCostPer1k;
  const toolValidity = clamp(
    model.qualityIndex + 0.03 + seededFloat(`${key}:tv`, -0.05, 0.04),
    0.4,
    0.995,
  );
  const hallucinationRisk = clamp(
    model.hallucinationBase * d.hallu + seededFloat(`${key}:hr`, -0.01, 0.02),
    0.005,
    0.4,
  );
  const predictionCalibration = clamp(
    0.78 + (model.qualityIndex - 0.8) * 0.6 + seededFloat(`${key}:pc`, -0.04, 0.04),
    0.55,
    0.98,
  );

  return {
    modelId,
    scenarioId: scenario.id,
    taskCompletion,
    p50LatencyMs,
    costUsd,
    toolValidity,
    hallucinationRisk,
    predictionCalibration,
  };
}

export function makeMatrix(): BenchCell[] {
  const cells: BenchCell[] = [];
  for (const modelId of BENCH_MODEL_IDS) {
    for (const scenario of BENCH_SCENARIOS) {
      cells.push(makeCell(modelId, scenario));
    }
  }
  return cells;
}

export interface BenchAggregate {
  model: ModelInfo;
  taskCompletion: number;
  p50LatencyMs: number;
  costUsd: number;
  toolValidity: number;
  hallucinationRisk: number;
  predictionCalibration: number;
  /** Composite 0–100 score for the leaderboard. */
  score: number;
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / Math.max(1, nums.length);
}

export function aggregate(cells: BenchCell[]): BenchAggregate[] {
  const byModel = new Map<string, BenchCell[]>();
  for (const c of cells) {
    const list = byModel.get(c.modelId) ?? [];
    list.push(c);
    byModel.set(c.modelId, list);
  }

  const rows: BenchAggregate[] = [];
  for (const [modelId, list] of byModel) {
    const taskCompletion = mean(list.map((c) => c.taskCompletion));
    const p50LatencyMs = Math.round(mean(list.map((c) => c.p50LatencyMs)));
    const costUsd = mean(list.map((c) => c.costUsd));
    const toolValidity = mean(list.map((c) => c.toolValidity));
    const hallucinationRisk = mean(list.map((c) => c.hallucinationRisk));
    const predictionCalibration = mean(list.map((c) => c.predictionCalibration));

    // Latency score: 200ms → ~1.0, 1200ms → ~0.0.
    const latencyScore = clamp(1 - (p50LatencyMs - 200) / 1000, 0, 1);
    const score =
      100 *
      (0.4 * taskCompletion +
        0.2 * toolValidity +
        0.15 * (1 - hallucinationRisk) +
        0.15 * predictionCalibration +
        0.1 * latencyScore);

    rows.push({
      model: getModel(modelId),
      taskCompletion,
      p50LatencyMs,
      costUsd,
      toolValidity,
      hallucinationRisk,
      predictionCalibration,
      score,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

export const BENCH_METRICS: {
  key: keyof BenchCell;
  label: string;
  format: "percent" | "ms" | "usd";
  higherIsBetter: boolean;
}[] = [
  { key: "taskCompletion", label: "Task completion", format: "percent", higherIsBetter: true },
  { key: "p50LatencyMs", label: "p50 latency", format: "ms", higherIsBetter: false },
  { key: "costUsd", label: "Cost / call", format: "usd", higherIsBetter: false },
  { key: "toolValidity", label: "Tool validity", format: "percent", higherIsBetter: true },
  { key: "hallucinationRisk", label: "Hallucination risk", format: "percent", higherIsBetter: false },
  { key: "predictionCalibration", label: "Pred. calibration", format: "percent", higherIsBetter: true },
];
