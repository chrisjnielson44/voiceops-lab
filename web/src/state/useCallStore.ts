"use client";

import { create } from "zustand";
import type { AgentEvent, LiveTool, LiveTurn, RunMetrics } from "@/lib/agent/types";
import type { AuditEvent } from "@/lib/audit/types";
import type { CallStatus, PredictionSnapshot } from "@/lib/simulation/types";
import { DEFAULT_SCENARIO_ID } from "@/lib/simulation/scenarios";

export type FeedItem =
  | { kind: "turn"; turn: LiveTurn }
  | { kind: "tool"; tool: LiveTool };

interface CallState {
  scenarioId: string;
  runId: string | null;
  status: CallStatus;
  phase: number;
  startedWallMs: number | null;
  modelLabel: string;

  feed: FeedItem[];
  audit: AuditEvent[];
  prediction: PredictionSnapshot | null;
  metrics: RunMetrics | null;
  error: string | null;

  selectScenario: (id: string) => void;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  _apply: (e: AgentEvent) => void;
}

// EventSource kept outside reactive state.
let es: EventSource | null = null;

function closeStream() {
  if (es) {
    es.close();
    es = null;
  }
}

async function control(runId: string, action: "pause" | "resume" | "stop") {
  await fetch("/api/agent/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, action }),
  }).catch(() => {});
}

export const useCallStore = create<CallState>((set, get) => ({
  scenarioId: DEFAULT_SCENARIO_ID,
  runId: null,
  status: "idle",
  phase: 0,
  startedWallMs: null,
  modelLabel: "local model",

  feed: [],
  audit: [],
  prediction: null,
  metrics: null,
  error: null,

  selectScenario: (id) => {
    const st = get();
    if (st.status === "active" || st.status === "dialing") return; // don't switch mid-call
    closeStream();
    set({
      scenarioId: id,
      runId: null,
      status: "idle",
      phase: 0,
      startedWallMs: null,
      feed: [],
      audit: [],
      prediction: null,
      metrics: null,
      error: null,
    });
  },

  start: async () => {
    const st = get();
    if (st.status === "active" || st.status === "dialing") return;
    closeStream();
    set({
      status: "dialing",
      feed: [],
      audit: [],
      prediction: null,
      metrics: null,
      error: null,
      startedWallMs: Date.now(),
    });

    try {
      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: st.scenarioId }),
      });
      if (res.status === 401) {
        set({ status: "idle", error: "Please sign in to start a call." });
        return;
      }
      if (!res.ok) {
        set({ status: "idle", error: `Failed to start (${res.status}).` });
        return;
      }
      const { runId, model } = (await res.json()) as { runId: string; model?: string };
      set({ runId, modelLabel: friendlyModel(model) });

      es = new EventSource(`/api/agent/stream?runId=${encodeURIComponent(runId)}`);
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as AgentEvent;
          get()._apply(data);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        // Stream closes normally on done; only surface if still mid-call.
        if (get().status === "dialing") set({ status: "idle", error: "Connection to agent stream failed." });
        closeStream();
      };
    } catch (e) {
      set({ status: "idle", error: e instanceof Error ? e.message : "Failed to start call." });
    }
  },

  pause: async () => {
    const { runId } = get();
    if (!runId) return;
    set({ status: "paused" });
    await control(runId, "pause");
  },

  resume: async () => {
    const { runId } = get();
    if (!runId) return;
    set({ status: "active" });
    await control(runId, "resume");
  },

  stop: async () => {
    const { runId } = get();
    if (runId) await control(runId, "stop");
    closeStream();
    set({ status: "idle" });
  },

  reset: () => {
    const { runId } = get();
    if (runId) control(runId, "stop");
    closeStream();
    set({
      runId: null,
      status: "idle",
      phase: 0,
      startedWallMs: null,
      feed: [],
      audit: [],
      prediction: null,
      metrics: null,
      error: null,
    });
  },

  _apply: (e) => {
    switch (e.kind) {
      case "status":
        set((s) => ({ status: s.status === "paused" && e.status === "active" ? "paused" : e.status, phase: e.phase }));
        break;
      case "turn":
        set((s) => ({ feed: [...s.feed, { kind: "turn", turn: e.turn }] }));
        break;
      case "tool":
        set((s) => ({ feed: [...s.feed, { kind: "tool", tool: e.tool }] }));
        break;
      case "prediction":
        set({ prediction: e.prediction });
        break;
      case "audit":
        set((s) => ({ audit: [...s.audit, e.event] }));
        break;
      case "metrics":
        set({ metrics: e.metrics });
        break;
      case "error":
        set({ error: e.message });
        break;
      case "done":
        closeStream();
        if (e.outcome === "stopped") set((s) => ({ status: s.status === "completed" || s.status === "escalated" ? s.status : "idle" }));
        break;
    }
  },
}));

function friendlyModel(id?: string): string {
  if (!id) return "local model";
  const tail = id.split("/").pop() ?? id;
  return tail.replace(/-4bit$/i, "").replace(/-Instruct/i, "");
}
