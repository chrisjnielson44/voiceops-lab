import type { Scenario, TranscriptTurn } from "./types";

/**
 * Pure selectors over a scenario + elapsed time. Because every derived view
 * (transcript, tool events, progress, gathered fields) is a function of
 * `elapsedMs`, the entire call state is reproducible and scrubbable.
 */

/** Turns whose start time has passed — i.e. what the caption feed has revealed. */
export function revealedTurns(scenario: Scenario, elapsedMs: number): TranscriptTurn[] {
  return scenario.turns.filter((t) => t.atMs <= elapsedMs);
}

/** The turn currently being "spoken" (for the live speaking indicator). */
export function activeTurn(scenario: Scenario, elapsedMs: number): TranscriptTurn | undefined {
  return scenario.turns.find((t) => elapsedMs >= t.atMs && elapsedMs < t.endMs);
}

/** Tool invocations revealed so far, newest last. */
export function revealedToolTurns(scenario: Scenario, elapsedMs: number): TranscriptTurn[] {
  return revealedTurns(scenario, elapsedMs).filter((t) => t.tool);
}

export function progressFraction(scenario: Scenario, elapsedMs: number): number {
  if (scenario.totalDurationMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs / scenario.totalDurationMs));
}

export function gatheredFields(scenario: Scenario, elapsedMs: number): string[] {
  const set = new Set<string>();
  for (const turn of revealedTurns(scenario, elapsedMs)) {
    for (const f of turn.satisfies ?? []) set.add(f);
  }
  return [...set];
}

export function isComplete(scenario: Scenario, elapsedMs: number): boolean {
  return elapsedMs >= scenario.totalDurationMs;
}

/** Coarse call phase used by the left-rail stepper. */
export function callPhase(scenario: Scenario, elapsedMs: number): number {
  const p = progressFraction(scenario, elapsedMs);
  if (p <= 0) return 0; // connect
  if (p < 0.25) return 1; // authenticate
  if (p < 0.85) return 2; // gather
  return 3; // resolve
}

export const PHASES = ["Connect", "Authenticate", "Gather", "Resolve"] as const;
