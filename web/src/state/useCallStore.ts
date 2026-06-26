"use client";

import { create } from "zustand";
import type { AgentEvent, LiveReasoning, LiveTool, LiveTurn, RunMetrics } from "@/lib/agent/types";
import type { AuditEvent } from "@/lib/audit/types";
import type { CallStatus, PredictionSnapshot } from "@/lib/simulation/types";
import type { PredictionSet, PrefetchRecord, Subgraph } from "@/lib/graph/types";

export type FeedItem =
  | { kind: "turn"; turn: LiveTurn }
  | { kind: "tool"; tool: LiveTool }
  | { kind: "reasoning"; reasoning: LiveReasoning };

export type StudioMode = "simulate" | "live";

export interface LiveInfo {
  url: string;
  token: string;
  room: string;
  runId: string;
}

interface CallState {
  scenarioId: string;
  runId: string | null;
  status: CallStatus;
  phase: number;
  startedWallMs: number | null;
  modelLabel: string;
  mode: StudioMode;
  model: string;
  // Session lifecycle — kept in the store (not local component state) so leaving
  // Studio and returning restores the running/finished session. `replay` marks a
  // read-only session re-opened from Call History.
  inSession: boolean;
  liveInfo: LiveInfo | null;
  replay: boolean;

  feed: FeedItem[];
  audit: AuditEvent[];
  prediction: PredictionSnapshot | null;
  predictionSet: PredictionSet | null;
  prefetch: Record<string, PrefetchRecord>;
  subgraph: Subgraph | null;
  metrics: RunMetrics | null;
  error: string | null;
  // How many feed items are revealed in the transcript. When voice is on, the
  // player advances this in lockstep with the read-aloud so the conversation
  // never runs ahead of the audio; when off it's pinned to feed.length.
  playbackReveal: number;

  selectScenario: (id: string) => void;
  setMode: (m: StudioMode) => void;
  selectModel: (id: string) => void;
  setPlaybackReveal: (n: number) => void;
  setLiveInfo: (info: LiveInfo | null) => void;
  start: () => Promise<void>;
  openSession: (runId: string) => void;
  endSession: () => void;
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
  // Seeded from GET /api/voice/options defaults (see StudioView) — no hardcoded
  // client scenario catalog.
  scenarioId: "",
  runId: null,
  status: "idle",
  phase: 0,
  startedWallMs: null,
  modelLabel: "local model",
  mode: "simulate",
  model: "",

  inSession: false,
  liveInfo: null,
  replay: false,

  feed: [],
  audit: [],
  prediction: null,
  predictionSet: null,
  prefetch: {},
  subgraph: null,
  metrics: null,
  error: null,
  playbackReveal: 0,

  setPlaybackReveal: (n) => set({ playbackReveal: n }),
  setLiveInfo: (info) => set({ liveInfo: info, inSession: info ? true : get().inSession }),

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
      predictionSet: null,
      prefetch: {},
      subgraph: null,
      metrics: null,
      error: null,
      playbackReveal: 0,
    });
  },

  setMode: (m) => set({ mode: m }),
  selectModel: (id) => set({ model: id }),

  start: async () => {
    const st = get();
    if (st.status === "active" || st.status === "dialing") return;
    closeStream();
    set({
      status: "dialing",
      inSession: true,
      replay: false,
      feed: [],
      audit: [],
      prediction: null,
      predictionSet: null,
      prefetch: {},
      subgraph: null,
      metrics: null,
      error: null,
      playbackReveal: 0,
      startedWallMs: Date.now(),
    });

    try {
      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: st.scenarioId, model: st.model || undefined }),
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

  // Re-open a stored (or still-live) session by id and replay its full event
  // stream. The backend replays from memory, or from the persisted event_stream
  // once the run has been evicted — so historical calls render in full.
  openSession: (runId) => {
    closeStream();
    set({
      runId,
      status: "active",
      inSession: true,
      replay: true,
      phase: 0,
      startedWallMs: Date.now(),
      feed: [],
      audit: [],
      prediction: null,
      predictionSet: null,
      prefetch: {},
      subgraph: null,
      metrics: null,
      error: null,
      playbackReveal: 0,
    });
    es = new EventSource(`/api/agent/stream?runId=${encodeURIComponent(runId)}`);
    es.onmessage = (ev) => {
      try {
        get()._apply(JSON.parse(ev.data) as AgentEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => closeStream();
  },

  endSession: () => {
    const { runId, replay } = get();
    if (runId && !replay) control(runId, "stop");
    closeStream();
    set({
      inSession: false,
      liveInfo: null,
      replay: false,
      runId: null,
      status: "idle",
      phase: 0,
      startedWallMs: null,
      feed: [],
      audit: [],
      prediction: null,
      predictionSet: null,
      prefetch: {},
      subgraph: null,
      metrics: null,
      error: null,
      playbackReveal: 0,
    });
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
    const { runId, replay } = get();
    if (runId && !replay) control(runId, "stop");
    closeStream();
    set({
      runId: null,
      status: "idle",
      inSession: false,
      liveInfo: null,
      replay: false,
      phase: 0,
      startedWallMs: null,
      feed: [],
      audit: [],
      prediction: null,
      predictionSet: null,
      prefetch: {},
      subgraph: null,
      metrics: null,
      error: null,
      playbackReveal: 0,
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
      case "reasoning":
        // Streamed: upsert by id so the trace grows in place (one block per turn).
        set((s) => {
          const idx = s.feed.findIndex((f) => f.kind === "reasoning" && f.reasoning.id === e.reasoning.id);
          if (idx === -1) return { feed: [...s.feed, { kind: "reasoning", reasoning: e.reasoning }] };
          const feed = s.feed.slice();
          feed[idx] = { kind: "reasoning", reasoning: e.reasoning };
          return { feed };
        });
        break;
      case "prediction":
        set({ prediction: e.prediction });
        break;
      case "predictionSet":
        set({ predictionSet: e.predictionSet });
        break;
      case "prefetch":
        set((s) => ({ prefetch: { ...s.prefetch, [e.record.key]: e.record } }));
        break;
      case "graph":
        set({ subgraph: e.subgraph });
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
