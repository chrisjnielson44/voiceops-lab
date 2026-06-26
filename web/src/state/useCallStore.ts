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

function feedId(it: FeedItem): string {
  return it.kind === "turn" ? it.turn.id : it.kind === "tool" ? it.tool.id : it.reasoning.id;
}

/** Sort key so the feed is deterministic regardless of SSE arrival order. Items
 *  share `seq` with the turn/tool they relate to; a reasoning block precedes its
 *  turn/tool at the same seq (rank 0 vs 1). */
function feedRank(it: FeedItem): number {
  const seq = it.kind === "turn" ? it.turn.seq : it.kind === "tool" ? it.tool.seq : it.reasoning.seq;
  const tie = it.kind === "reasoning" ? 0 : 1;
  return seq * 2 + tie;
}

/** Upsert by id and keep the feed ordered by (seq, rank): de-dupes a replayed or
 *  re-delivered event and slots a late one into its correct place. */
function placeFeed(feed: FeedItem[], item: FeedItem): FeedItem[] {
  const id = feedId(item);
  const next = feed.filter((f) => feedId(f) !== id);
  const rank = feedRank(item);
  let i = next.findIndex((f) => feedRank(f) > rank);
  if (i === -1) i = next.length;
  next.splice(i, 0, item);
  return next;
}

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
  // Which surface OWNS the active session — so /simulate and /live each only show
  // their own run (not whatever happens to be live). `mode` is just the pre-config
  // selector; `sessionMode` is what the running session actually is.
  sessionMode: StudioMode | null;
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
  // Text role-play: true while the agent has paused for the human (playing the
  // payer rep) to type a reply. Drives the reply bar.
  awaitingPayer: boolean;

  selectScenario: (id: string) => void;
  setMode: (m: StudioMode) => void;
  selectModel: (id: string) => void;
  setPlaybackReveal: (n: number) => void;
  setLiveInfo: (info: LiveInfo | null) => void;
  start: (opts?: { humanPayer?: boolean }) => Promise<void>;
  say: (text: string) => Promise<void>;
  openSession: (runId: string, mode?: StudioMode) => void;
  attachLiveStream: (runId: string) => void;
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
  sessionMode: null,
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
  awaitingPayer: false,

  setPlaybackReveal: (n) => set({ playbackReveal: n }),
  setLiveInfo: (info) => {
    if (!info) {
      set({ liveInfo: null });
      return;
    }
    set({
      liveInfo: info,
      inSession: true,
      sessionMode: "live",
      replay: false,
      runId: info.runId,
      status: "dialing",
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
  },

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

  start: async (opts) => {
    const st = get();
    if (st.status === "active" || st.status === "dialing") return;
    closeStream();
    set({
      status: "dialing",
      inSession: true,
      sessionMode: st.mode, // the page forced `mode` to its route before launch
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
      awaitingPayer: false,
      startedWallMs: Date.now(),
    });

    try {
      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: st.scenarioId,
          model: st.model || undefined,
          humanPayer: opts?.humanPayer ?? false,
        }),
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

  // Text role-play: submit the human's reply (they play the payer rep). The
  // backend hands it to the paused orchestrator, which resumes the agent's turn.
  say: async (text) => {
    const { runId } = get();
    const body = text.trim();
    if (!runId || !body) return;
    set({ awaitingPayer: false });
    await fetch("/api/agent/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, text: body }),
    }).catch(() => {});
  },

  // Re-open a stored (or still-live) session by id and replay its full event
  // stream. The backend replays from memory, or from the persisted event_stream
  // once the run has been evicted — so historical calls render in full.
  openSession: (runId, mode = "simulate") => {
    closeStream();
    set({
      runId,
      status: "active",
      inSession: true,
      sessionMode: mode,
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

  // Attach to a LIVE voice run's SSE without resetting state or POSTing /start.
  // The audio rides on LiveKit (handled in the view); this stream carries the
  // backend bridge's enrichment — turns, tools, reasoning, graph, predictions —
  // so the cockpit lights up exactly like simulate. `setLiveInfo` already seeded
  // the session state, so this is purely additive.
  attachLiveStream: (runId) => {
    closeStream();
    es = new EventSource(`/api/agent/stream?runId=${encodeURIComponent(runId)}`);
    es.onmessage = (ev) => {
      try {
        get()._apply(JSON.parse(ev.data) as AgentEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    // The live audio session is independent of this stream, so a transient SSE
    // error shouldn't tear down the call — just stop consuming enrichment.
    es.onerror = () => closeStream();
  },

  endSession: () => {
    const { runId, replay } = get();
    if (runId && !replay) control(runId, "stop");
    closeStream();
    set({
      inSession: false,
      sessionMode: null,
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
      awaitingPayer: false,
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
      sessionMode: null,
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
        set((s) => ({ feed: placeFeed(s.feed, { kind: "turn", turn: e.turn }) }));
        break;
      case "tool":
        set((s) => ({ feed: placeFeed(s.feed, { kind: "tool", tool: e.tool }) }));
        break;
      case "reasoning":
        // Streamed: upsert by id (placeFeed replaces same-id) so the trace grows
        // in place and stays ordered ahead of the turn it precedes.
        set((s) => ({ feed: placeFeed(s.feed, { kind: "reasoning", reasoning: e.reasoning }) }));
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
      case "await":
        set({ awaitingPayer: e.awaiting });
        break;
      case "done":
        closeStream();
        set({ awaitingPayer: false });
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
