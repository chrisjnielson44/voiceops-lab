import { describe, it, expect, beforeEach } from "vitest";
import { useCallStore } from "@/state/useCallStore";
import type { AgentEvent } from "@/lib/agent/types";

beforeEach(() => {
  useCallStore.getState().reset();
});

describe("useCallStore._apply", () => {
  it("starts a live session when LiveKit room info is set", () => {
    const before = Date.now();
    useCallStore.getState().setLiveInfo({
      url: "wss://voiceops.test",
      token: "token",
      room: "voice_room",
      runId: "voice_run",
    });

    const st = useCallStore.getState();
    expect(st.inSession).toBe(true);
    expect(st.replay).toBe(false);
    expect(st.liveInfo?.room).toBe("voice_room");
    expect(st.runId).toBe("voice_run");
    expect(st.status).toBe("dialing");
    expect(st.startedWallMs).toBeGreaterThanOrEqual(before);
  });

  it("appends turns and tools to the feed in order", () => {
    const { _apply } = useCallStore.getState();
    _apply({ kind: "turn", turn: { id: "t-0", seq: 0, speaker: "agent", text: "hi", atMs: 10 } } as AgentEvent);
    _apply({
      kind: "tool",
      tool: { id: "tool-1", seq: 1, tool: "lookup_patient", args: {}, result: "ok", status: "ok", latencyMs: 5, phi: true, atMs: 20 },
    } as AgentEvent);

    const { feed } = useCallStore.getState();
    expect(feed).toHaveLength(2);
    expect(feed[0].kind).toBe("turn");
    expect(feed[1].kind).toBe("tool");
  });

  it("does not downgrade a paused call when a stale 'active' status arrives", () => {
    useCallStore.setState({ status: "paused" });
    useCallStore.getState()._apply({ kind: "status", status: "active", phase: 2, elapsedMs: 0 } as AgentEvent);
    expect(useCallStore.getState().status).toBe("paused");
  });

  it("records prediction, metrics, and audit events", () => {
    const s = useCallStore.getState();
    s._apply({
      kind: "prediction",
      prediction: { nextPayerResponse: "x", nextResponseConfidence: 0.5, completionProbability: 0.9, escalationRisk: 0.1, estRemainingMs: 1000, missingFields: [], rationale: "r" },
    } as AgentEvent);
    s._apply({
      kind: "metrics",
      metrics: { inferences: 1, toolCalls: 0, phiAccesses: 0, toolErrors: 0, promptTokens: 0, completionTokens: 5, avgLatencyMs: 12 },
    } as AgentEvent);
    s._apply({
      kind: "audit",
      event: { seq: 0, id: "evt-0", type: "call.start", atMs: 0, clock: "00:00:00", actor: "operator", summary: "s", phi: false, redaction: "none", hash: "h", prevHash: "0" },
    } as AgentEvent);

    const st = useCallStore.getState();
    expect(st.prediction?.completionProbability).toBe(0.9);
    expect(st.metrics?.completionTokens).toBe(5);
    expect(st.audit).toHaveLength(1);
  });

  it("orders the feed by seq (reasoning ahead of its turn) and de-dupes by id", () => {
    const { _apply } = useCallStore.getState();
    // Arrive out of order, and re-deliver one event (as a replay/reconnect would).
    _apply({ kind: "turn", turn: { id: "t-2", seq: 2, speaker: "agent", text: "second", atMs: 30 } } as AgentEvent);
    _apply({ kind: "reasoning", reasoning: { id: "r-2", seq: 2, atMs: 25, segments: [] } } as AgentEvent);
    _apply({ kind: "turn", turn: { id: "t-0", seq: 0, speaker: "agent", text: "first", atMs: 10 } } as AgentEvent);
    _apply({ kind: "turn", turn: { id: "t-0", seq: 0, speaker: "agent", text: "first", atMs: 10 } } as AgentEvent);

    const ids = useCallStore.getState().feed.map((f) =>
      f.kind === "turn" ? f.turn.id : f.kind === "reasoning" ? f.reasoning.id : f.tool.id,
    );
    expect(ids).toEqual(["t-0", "r-2", "t-2"]); // seq order, reasoning before its turn, no dup
  });

  it("tags a session with the mode that owns it, so /simulate and /live stay separate", () => {
    const s = useCallStore.getState();
    expect(s.sessionMode).toBe(null);
    s.setLiveInfo({ url: "wss://x", token: "t", room: "r", runId: "voice_1" });
    expect(useCallStore.getState().sessionMode).toBe("live"); // a live run is owned by /live
    s.endSession();
    expect(useCallStore.getState().sessionMode).toBe(null); // cleared so neither page adopts it
    expect(useCallStore.getState().inSession).toBe(false);
  });

  it("tracks the human-payer await flag and clears it on reply and on done", () => {
    const s = useCallStore.getState();
    s._apply({ kind: "await", awaiting: true, role: "payer" } as AgentEvent);
    expect(useCallStore.getState().awaitingPayer).toBe(true);
    s._apply({ kind: "await", awaiting: false, role: "payer" } as AgentEvent);
    expect(useCallStore.getState().awaitingPayer).toBe(false);
    // `done` always clears it (so a finished role-play never shows a stuck reply bar).
    s._apply({ kind: "await", awaiting: true, role: "payer" } as AgentEvent);
    s._apply({ kind: "done", outcome: "completed" } as AgentEvent);
    expect(useCallStore.getState().awaitingPayer).toBe(false);
  });
});
