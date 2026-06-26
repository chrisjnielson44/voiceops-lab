"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  BarVisualizer,
  VoiceAssistantControlBar,
  useVoiceAssistant,
  useConnectionState,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import "@livekit/components-styles";
import {
  Activity,
  Brain,
  Check,
  Coins,
  Cpu,
  History,
  Lock,
  PanelRightOpen,
  Pause,
  PhoneOff,
  Play,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  User,
  Volume2,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { useCallStore, type LiveInfo, type StudioMode } from "@/state/useCallStore";
import { useSettings } from "@/state/useSettings";
import { useScenario } from "@/state/useScenario";
import { PHASES } from "@/lib/simulation/engine";
import type { CallStatus } from "@/lib/simulation/types";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { PredictivePanel } from "@/components/PredictivePanel";
import { AuditLedger } from "@/components/AuditLedger";
import { ContextGraphView } from "@/components/ContextGraphView";
import { StudioTranscript } from "@/components/StudioTranscript";
import { Suggestions } from "@/components/ai/activity";
import { StudioSidecar } from "@/components/StudioSidecar";
import { SimVoicePlayer } from "@/components/SimVoicePlayer";
import { PreConfigView, type VoiceOptions, type ScenarioOpt } from "@/components/PreConfigView";
import { RoleCard } from "@/components/RoleCard";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";


const STATUS_META: Record<CallStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  idle: { tone: "slate", label: "Idle" },
  dialing: { tone: "blue", label: "Connecting…", pulse: true },
  active: { tone: "green", label: "On call", pulse: true },
  paused: { tone: "amber", label: "Paused" },
  completed: { tone: "green", label: "Completed" },
  escalated: { tone: "amber", label: "Escalated" },
};

const AGENT_STATE_TONE: Record<string, Tone> = {
  listening: "green",
  thinking: "amber",
  speaking: "blue",
  initializing: "slate",
};

function promptFor(s: ScenarioOpt): string {
  return [
    `You are VoiceOps, an autonomous voice agent calling ${s.payer} on a recorded line.`,
    ``,
    `Objective: ${s.objective}`,
    ``,
    `Authenticate first, then use your tools to verify the relevant ${s.category.replace("-", " ")} details.`,
    `Speak only facts returned by tools — never invent details.`,
    `Capture: ${s.requiredFields.join(", ")}. If a human review is required, escalate. Then summarize and end politely.`,
  ].join("\n");
}

/**
 * Pick the right default model for a mode. Live voice is a real-time loop, so it
 * defaults to a FAST non-reasoning model (a reasoning model's hidden CoT adds
 * seconds per turn — unbearable on a call, and LiveKit strips the CoT anyway).
 * Simulate keeps the reasoning default so its streamed chain-of-thought is the
 * star of the show.
 */
function defaultModelFor(
  mode: StudioMode,
  transport: LiveTransport,
  options: VoiceOptions,
  playgroundModel: string | undefined,
): string {
  // Only the live VOICE call wants a fast non-reasoning model (real-time, and
  // LiveKit strips CoT anyway). Simulate and text role-play both stream the
  // agent's chain-of-thought, so they default to the reasoning model.
  if (mode === "live" && transport === "voice") {
    const byId = (id?: string) => (id ? options.models.find((m) => m.id === id) : undefined);
    const fast =
      byId(options.defaults.fastModel) ??
      options.models.find((m) => m.kind === "local" && !m.reasoning) ??
      options.models.find((m) => !m.reasoning);
    return fast?.id ?? options.defaults.model;
  }
  return playgroundModel || options.defaults.model;
}

function useElapsedMs(startedWallMs: number | null, status: CallStatus): number {
  const [now, setNow] = useState(() => Date.now());
  const live = status === "active" || status === "dialing" || status === "paused";
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [live]);
  if (!startedWallMs) return 0;
  return Math.max(0, now - startedWallMs);
}

/**
 * The unified Studio. A full-screen PRE-CONFIG step gates the demo; once started
 * the surface focuses on the chat (hero), with the agent's reasoning streaming
 * inline (graph traversal · thinking · prediction weighing) and a compact "live
 * mind" sidecar. Full Predictive / Graph / Audit live in a drawer. Simulate runs
 * a real two-model loop; Live voice runs the same agent over LiveKit.
 */
/** Live participation: the human plays the payer rep either by typing
 *  (text role-play, agent leads over the same loop as simulate) or by voice
 *  (LiveKit). */
export type LiveTransport = "text" | "voice";

/** Mode-locked entry points for the two routes (/simulate, /live). */
export function SimulateView() {
  return <StudioView initialMode="simulate" />;
}
export function LiveView() {
  return <StudioView initialMode="live" />;
}

export function StudioView({ initialMode }: { initialMode?: StudioMode } = {}) {
  const mode = useCallStore((s) => s.mode);
  const setMode = useCallStore((s) => s.setMode);
  const scenarioId = useCallStore((s) => s.scenarioId);
  const selectScenario = useCallStore((s) => s.selectScenario);
  const model = useCallStore((s) => s.model);
  const selectModel = useCallStore((s) => s.selectModel);
  const status = useCallStore((s) => s.status);
  const error = useCallStore((s) => s.error);
  const start = useCallStore((s) => s.start);
  const say = useCallStore((s) => s.say);
  const awaitingPayer = useCallStore((s) => s.awaitingPayer);
  const predictionSet = useCallStore((s) => s.predictionSet);
  const playbackReveal = useCallStore((s) => s.playbackReveal);
  // Session lifecycle lives in the store so it survives navigation away & back.
  const inSession = useCallStore((s) => s.inSession);
  const sessionMode = useCallStore((s) => s.sessionMode);
  const runId = useCallStore((s) => s.runId);
  const liveInfo = useCallStore((s) => s.liveInfo);
  const replay = useCallStore((s) => s.replay);
  const setLiveInfo = useCallStore((s) => s.setLiveInfo);
  const applyEvent = useCallStore((s) => s._apply);
  const openSession = useCallStore((s) => s.openSession);
  const attachLiveStream = useCallStore((s) => s.attachLiveStream);
  const endSession = useCallStore((s) => s.endSession);

  const playgroundDefaults = useSettings((s) => s.playgroundDefaults);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { runId?: string };

  const [drawer, setDrawer] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceRate, setVoiceRate] = useState(1);
  const VOICE_RATES = [1, 1.25, 1.5, 2];
  const cycleVoiceRate = () => setVoiceRate((r) => VOICE_RATES[(VOICE_RATES.indexOf(r) + 1) % VOICE_RATES.length] ?? 1);

  // Live participation: text role-play (agent leads, you type as the rep) or a
  // real voice call. Text is the default — no LiveKit/keys needed.
  const [liveTransport, setLiveTransport] = useState<LiveTransport>("text");

  // This page's mode (the route owns it) and whether the ACTIVE session belongs to
  // this page. A simulate run started on /simulate must not show through on /live.
  const pageMode: StudioMode = initialMode ?? mode;
  const routePath = pageMode === "live" ? "/live" : "/simulate";
  const ownSession = inSession && sessionMode === pageMode;

  // Keep the pre-config selector on this page's mode whenever we're NOT showing
  // this page's own running session (so /live shows the live setup even if a
  // simulate run is still alive in the store, and vice versa).
  useEffect(() => {
    if (initialMode && !ownSession && mode !== initialMode) setMode(initialMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode, ownSession]);

  // Live-only config (kept local; the live token + session flags use the store).
  const [voiceId, setVoiceId] = useState("");
  const [temperature, setTemperature] = useState(0.4);
  const [instructions, setInstructions] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  // Has the user manually picked a model? Until they do, the model follows the
  // mode-appropriate default (fast for live, reasoning for simulate).
  const [modelDirty, setModelDirty] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const { data: options } = useQuery({
    queryKey: ["voice-options"],
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return (await r.json()) as VoiceOptions;
    },
  });

  const scenario = options?.scenarios.find((s) => s.id === scenarioId);

  // URL ⇄ session sync. The runId lives in the URL so a session is shareable,
  // bookmarkable, and survives refresh — and so each page only adopts its own run.
  const openedRef = useRef<string | null>(null);
  // (a) URL → session: a runId in the URL that isn't the active run = open it
  //     (deep link from Call History, a refresh, or a shared link). Replay.
  useEffect(() => {
    const rid = search?.runId;
    if (rid && rid !== runId && openedRef.current !== rid) {
      openedRef.current = rid;
      openSession(rid, pageMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.runId, runId]);
  // (b) session → URL: reflect this page's own running session's id in the URL.
  useEffect(() => {
    if (ownSession && runId && search?.runId !== runId) {
      navigate({ to: routePath, search: { runId }, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownSession, runId, search?.runId]);

  useEffect(() => {
    if (!options) return;
    setVoiceId((v) => v || playgroundDefaults.voiceId || options.defaults.voiceId || options.voices[0]?.id || "");
    setTemperature((t) => t || playgroundDefaults.temperature || options.defaults.temperature);
    // Don't reseed the scenario while a session is active/restored — that would
    // wipe the run the user came back to.
    if (inSession) return;
    if (playgroundDefaults.scenarioId && playgroundDefaults.scenarioId !== scenarioId) {
      selectScenario(playgroundDefaults.scenarioId);
    } else if (!scenarioId && options.defaults.scenarioId) {
      selectScenario(options.defaults.scenarioId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  // Mode-aware model default: follows the mode (fast for live, reasoning for
  // simulate) until the user manually picks one. Never reseeds mid-session.
  useEffect(() => {
    if (!options || modelDirty || inSession) return;
    selectModel(defaultModelFor(mode, liveTransport, options, playgroundDefaults.model));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, mode, liveTransport, modelDirty, inSession]);

  useEffect(() => {
    if (scenario && !promptDirty) setInstructions(promptFor(scenario));
  }, [scenario, promptDirty]);

  // LIVE mode: once a voice session is up, subscribe to the backend bridge's SSE
  // (parity with simulate) so the graph / prediction / reasoning / tool panels
  // track the call. Attach once per runId; the audio itself rides on LiveKit.
  const liveStreamRef = useRef<string | null>(null);
  useEffect(() => {
    const rid = sessionMode === "live" && inSession && !replay ? liveInfo?.runId : undefined;
    if (rid && liveStreamRef.current !== rid) {
      liveStreamRef.current = rid;
      attachLiveStream(rid);
    }
    if (!inSession) liveStreamRef.current = null;
  }, [sessionMode, inSession, replay, liveInfo?.runId, attachLiveStream]);

  const startLive = async (): Promise<boolean> => {
    setLiveError(null);
    try {
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId, model, voiceId, instructions, temperature }),
      });
      if (res.status === 503) { setLiveError("LiveKit is not configured on the server."); return false; }
      if (!res.ok) { setLiveError(`Failed to start (${res.status}).`); return false; }
      setLiveInfo((await res.json()) as LiveInfo);
      return true;
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : "Failed to start session.");
      return false;
    }
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      if (mode === "simulate") await start();
      else if (liveTransport === "text") await start({ humanPayer: true }); // agent leads, you type as the rep
      else await startLive(); // real voice call over LiveKit
    } finally {
      setLaunching(false);
    }
  };

  const newSession = () => {
    endSession();
    setLiveError(null);
    openedRef.current = null;
    navigate({ to: routePath, search: { runId: undefined }, replace: true });
  };

  // Show this page's pre-config unless ITS OWN session is running (a session from
  // the other surface stays in the store but never renders through here).
  if (!ownSession) {
    return (
      <PreConfigView
        options={options}
        mode={mode}
        lockMode
        pageTitle={mode === "live" ? "Live" : "Simulation"}
        transport={liveTransport}
        onTransport={setLiveTransport}
        onMode={setMode}
        scenarioId={scenarioId}
        onScenario={(id) => { selectScenario(id); setPromptDirty(false); }}
        model={model}
        onModel={(id) => { selectModel(id); setModelDirty(true); }}
        voiceId={voiceId}
        onVoice={setVoiceId}
        temperature={temperature}
        onTemperature={setTemperature}
        instructions={instructions}
        onInstructions={(v) => { setInstructions(v); setPromptDirty(true); }}
        onLaunch={handleLaunch}
        launching={launching}
        error={error || liveError}
      />
    );
  }

  // Render by what the SESSION is (sessionMode), not the pre-config selector.
  // Text role-play streams over the same SSE loop as simulate (no LiveKit room);
  // a live VOICE session is the one that holds `liveInfo`.
  const textRoleplay = sessionMode === "live" && !liveInfo;
  const payerVoiceId = options?.voices?.find((v) => v.id !== voiceId)?.id ?? voiceId;
  const voiceActive = sessionMode === "simulate" && voiceOn && !replay; // never auto-speak a replay or role-play
  const thinking = (sessionMode === "simulate" || textRoleplay) && !replay && !awaitingPayer && (status === "active" || status === "dialing");

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col gap-6">
      <SessionHeader
        scenario={scenario}
        mode={sessionMode ?? pageMode}
        status={status}
        model={model}
        replay={replay}
        voiceOn={voiceOn}
        onSetVoice={setVoiceOn}
        voiceRate={voiceRate}
        onCycleVoiceRate={cycleVoiceRate}
        onNewSession={newSession}
        onInspect={() => setDrawer(true)}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ---- Conversation hero (Claude/ChatGPT/Perplexity style) ---- */}
        <div className="flex min-h-0 flex-col lg:col-span-8">
          {sessionMode === "simulate" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
                <StudioTranscript
                  thinking={thinking}
                  revealCount={voiceActive ? playbackReveal : undefined}
                  emptyTitle={replay ? "Loading session…" : "Starting the simulation…"}
                  emptyDescription="The agent and payer converse end-to-end on real local models. The agent's reasoning — graph traversal, thinking, and predictions — streams above each turn."
                />
                <InlineMetrics />
              </div>
            </div>
          ) : textRoleplay ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3">
                {!replay && <RoleCard scenarioId={scenarioId} />}
                <StudioTranscript
                  thinking={thinking}
                  emptyTitle={replay ? "Loading session…" : "The agent is placing the call…"}
                  emptyDescription="You're the payer rep. The agent leads — authenticating, asking for what it needs — and you respond. Its reasoning, graph walk, and predictions stream above each turn."
                />
                {!replay && (
                  <div className="flex shrink-0 flex-col gap-2">
                    {awaitingPayer && (predictionSet?.predictions?.length ?? 0) > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="px-1 text-[11px] font-medium text-muted-foreground">Suggested replies — what the rep might say</span>
                        <Suggestions
                          items={predictionSet!.predictions.slice(0, 3).map((p) => ({
                            label: p.utterance,
                            hint: `${p.intent} · ${Math.round(p.confidence * 100)}%`,
                          }))}
                          onPick={(t) => say(t)}
                        />
                      </div>
                    )}
                    <PayerReplyBar awaiting={awaitingPayer} onSend={say} />
                  </div>
                )}
                <InlineMetrics />
              </div>
            </div>
          ) : liveInfo ? (
            <Card className="flex h-full min-h-0 flex-col overflow-hidden">
              <LiveKitRoom
                serverUrl={liveInfo.url}
                token={liveInfo.token}
                connect
                audio
                video={false}
                onConnected={() => applyEvent({ kind: "status", status: "active", phase: 0, elapsedMs: 0 })}
                onDisconnected={endSession}
                onError={(err) => {
                  setLiveError(err.message);
                  endSession();
                }}
              >
                <RoomAudioRenderer />
                <LiveStage onEnd={newSession} />
              </LiveKitRoom>
            </Card>
          ) : (
            <Card className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <Radio className="h-8 w-8 animate-pulse text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{liveError ?? "Connecting to the live session…"}</p>
              {liveError && <Button variant="outline" onClick={newSession}>Back to setup</Button>}
            </Card>
          )}
        </div>

        {/* ---- Right rail: context graph + prediction (fits, no scroll) ---- */}
        <aside className="min-h-0 lg:col-span-4">
          <StudioSidecar />
        </aside>
      </div>

      {sessionMode === "simulate" && <SimVoicePlayer enabled={voiceActive} rate={voiceRate} agentVoiceId={voiceId} payerVoiceId={payerVoiceId} />}

      {/* ---- Full inspect drawer ---- */}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle>Inspect</SheetTitle>
          </SheetHeader>
          <InspectTabs />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PlaybackBtn({ active, onClick, icon, label, title }: { active: boolean; onClick: () => void; icon?: React.ReactNode; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SessionHeader({
  scenario,
  mode,
  status,
  model,
  replay,
  voiceOn,
  onSetVoice,
  voiceRate,
  onCycleVoiceRate,
  onNewSession,
  onInspect,
}: {
  scenario: ScenarioOpt | undefined;
  mode: "simulate" | "live";
  status: CallStatus;
  model: string;
  replay: boolean;
  voiceOn: boolean;
  onSetVoice: (on: boolean) => void;
  voiceRate: number;
  onCycleVoiceRate: () => void;
  onNewSession: () => void;
  onInspect: () => void;
}) {
  // TTS is the only credit-spender; default OFF. "Voiced" = paced + ElevenLabs.
  const ttsEnabled = useSettings((s) => s.ttsEnabled);
  const setTtsEnabled = useSettings((s) => s.setTtsEnabled);
  const phase = useCallStore((s) => s.phase);
  const startedWallMs = useCallStore((s) => s.startedWallMs);
  const runId = useCallStore((s) => s.runId);
  const pause = useCallStore((s) => s.pause);
  const resume = useCallStore((s) => s.resume);
  const stop = useCallStore((s) => s.stop);
  const scenarioId = useCallStore((s) => s.scenarioId);
  const { data: full } = useScenario(scenarioId);
  const elapsedMs = useElapsedMs(startedWallMs, status);
  const meta = STATUS_META[status];
  const running = status === "active" || status === "dialing";

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={scenario ? `${scenario.payer} — ${scenario.title}` : "Session"}
        actions={
          <>
            <StatusChip tone={mode === "live" ? "blue" : "violet"}>
              {mode === "live" ? <Radio className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              {mode === "live" ? "Live" : "Simulate"}
            </StatusChip>
            <StatusChip tone={meta.tone} dot pulse={meta.pulse}>{meta.label}</StatusChip>
            {replay && <StatusChip tone="blue"><History className="h-3 w-3" /> Replay</StatusChip>}

            {!replay && <span className="tabular text-lg font-semibold text-foreground">{formatClock(elapsedMs)}</span>}
            <StatusChip tone="violet"><Brain className="h-3 w-3" /> {model.split("/").pop()}</StatusChip>

            {mode === "simulate" && !replay && (
              <div className="flex items-center gap-1.5">
                {/* Read = instant text. Listen = paced but silent (no credits).
                    Voiced = paced + ElevenLabs read-aloud (uses credits). */}
                <div className="inline-flex rounded-lg border border-border p-0.5">
                  <PlaybackBtn
                    active={!voiceOn}
                    onClick={() => onSetVoice(false)}
                    label="Read"
                    title="Read — instant, full speed, no audio"
                  />
                  <PlaybackBtn
                    active={voiceOn && !ttsEnabled}
                    onClick={() => { onSetVoice(true); setTtsEnabled(false); }}
                    label="Listen"
                    title="Listen — paced back-and-forth, silent (no ElevenLabs credits)"
                  />
                  <PlaybackBtn
                    active={voiceOn && ttsEnabled}
                    onClick={() => { onSetVoice(true); setTtsEnabled(true); }}
                    icon={<Volume2 className="h-3.5 w-3.5" />}
                    label="Voiced"
                    title="Voiced — paced + ElevenLabs read-aloud (uses credits)"
                  />
                </div>
                {voiceOn && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="tabular font-medium"
                    onClick={onCycleVoiceRate}
                    title="Playback speed"
                  >
                    {voiceRate}×
                  </Button>
                )}
              </div>
            )}

            {mode === "simulate" && !replay && (status === "active" || status === "paused") && (
              <Button variant="outline" size="sm" onClick={status === "paused" ? resume : pause}>
                {status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </Button>
            )}
            {mode === "simulate" && !replay && running && (
              <Button variant="outline" size="sm" onClick={stop} disabled={!runId}>
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onInspect}>
              <PanelRightOpen className="h-3.5 w-3.5" /> Inspect
            </Button>
            <Button size="sm" onClick={onNewSession}>
              <Plus className="h-3.5 w-3.5" /> New session
            </Button>
          </>
        }
      />

      {/* meta strip: scenario phases + member context PHI */}
      <Card className="flex flex-col gap-2.5 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {scenario?.category && (
            <span className="text-xs capitalize text-muted-foreground">{scenario.category.replace("-", " ")}</span>
          )}
          {/* phase pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {PHASES.map((label, i) => {
              const done = i < phase || status === "completed" || status === "escalated";
              const current = i === phase && running;
              return (
                <span
                  key={label}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    done ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : current ? "bg-primary text-primary-foreground"
                        : "bg-secondary/60 text-muted-foreground",
                  )}
                >
                  {done && <Check className="h-2.5 w-2.5" />} {label}
                </span>
              );
            })}
          </div>
        </div>

        {full?.patient && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2.5 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-3.5 w-3.5" /> {full.patient.name}
            </span>
            <span className="font-mono text-muted-foreground">{full.patient.memberId}</span>
            <span className="font-mono text-muted-foreground">DOB {full.patient.dob}</span>
            {full.provider && <span className="font-mono text-muted-foreground">NPI {full.provider.npi}</span>}
            <StatusChip tone="violet" className="ml-auto"><Lock className="h-3 w-3" /> PHI</StatusChip>
          </div>
        )}
      </Card>
    </div>
  );
}

function InspectTabs() {
  const [tab, setTab] = useState<"predictive" | "graph" | "audit">("predictive");
  return (
    <div className="flex flex-col gap-3 p-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full">
          <TabsTrigger value="predictive" className="flex-1"><span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Predictive</span></TabsTrigger>
          <TabsTrigger value="graph" className="flex-1"><span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Graph</span></TabsTrigger>
          <TabsTrigger value="audit" className="flex-1"><span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Audit</span></TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-[560px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {tab === "predictive" ? <PredictivePanel /> : tab === "graph" ? <ContextGraphView /> : <AuditLedger />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function LiveStage({ onEnd }: { onEnd: () => void }) {
  const conn = useConnectionState();
  const { state, audioTrack } = useVoiceAssistant();
  const connected = conn === ConnectionState.Connected;
  // The transcript is fed by the backend bridge over SSE (turns + tool cards +
  // reasoning, interleaved) — the same store the sidecar reads — rather than raw
  // LiveKit captions, so the live call shows the agent's full activity.
  const thinking = state === "thinking";

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Live session</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip tone={connected ? "green" : "amber"} dot pulse={!connected}>{conn}</StatusChip>
          <StatusChip tone={AGENT_STATE_TONE[state] ?? "slate"}>{state}</StatusChip>
        </div>
      </div>
      <div className="flex h-28 items-center justify-center border-b border-border bg-secondary/30">
        <BarVisualizer state={state} barCount={9} trackRef={audioTrack} className="h-16 w-56" options={{ minHeight: 8 }} />
      </div>
      <div className="min-h-0 flex-1">
        <StudioTranscript
          thinking={thinking}
          emptyTitle={connected ? "Connected" : "Connecting…"}
          emptyDescription="The agent will greet you — start speaking when ready. Its reasoning, tool calls, graph, and predictions stream live as you talk."
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <VoiceAssistantControlBar controls={{ leave: false }} />
        <Button variant="outline" onClick={onEnd}><PhoneOff className="h-4 w-4" /> End session</Button>
      </div>
    </>
  );
}

/**
 * Reply bar for text role-play: the human plays the payer rep. Enabled only when
 * the agent has paused for their turn (`awaiting`); otherwise it shows the agent
 * is still working so the human isn't tempted to talk over it.
 */
function PayerReplyBar({ awaiting, onSend }: { awaiting: boolean; onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const body = text.trim();
    if (!body || !awaiting) return;
    onSend(body);
    setText("");
  };
  return (
    <div className="shrink-0">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border bg-card/60 p-2 transition-colors",
          awaiting ? "border-brand-500/40" : "border-border opacity-70",
        )}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          disabled={!awaiting}
          placeholder={awaiting ? "Reply as the payer rep…  (Enter to send, Shift+Enter for a new line)" : "The agent is working…"}
          className="scroll-thin max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />
        <Button size="sm" onClick={submit} disabled={!awaiting || !text.trim()}>
          <Send className="h-3.5 w-3.5" /> Send
        </Button>
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted-foreground">
        {awaiting ? "Your turn — answer as the rep would (the role card shows what's on file)." : "Listening to the agent…"}
      </p>
    </div>
  );
}

/** A slim, single-line metrics readout (no KPI cards) shown under the thread. */
function InlineMetrics() {
  const metrics = useCallStore((s) => s.metrics);
  const m = metrics ?? { inferences: 0, toolCalls: 0, phiAccesses: 0, toolErrors: 0, promptTokens: 0, completionTokens: 0, avgLatencyMs: 0 };
  const items = [
    { icon: <Cpu className="h-3.5 w-3.5" />, label: "avg latency", value: m.avgLatencyMs ? `${m.avgLatencyMs}ms` : "—" },
    { icon: <Activity className="h-3.5 w-3.5" />, label: "inferences", value: `${m.inferences}` },
    { icon: <Wrench className="h-3.5 w-3.5" />, label: "tools", value: `${m.toolCalls}` },
    { icon: <Lock className="h-3.5 w-3.5" />, label: "PHI", value: `${m.phiAccesses}` },
    { icon: <Coins className="h-3.5 w-3.5" />, label: "tokens", value: m.completionTokens ? `${m.completionTokens}` : "—" },
  ];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="text-muted-foreground/70">{it.icon}</span>
          <span className="tabular font-medium text-foreground/80">{it.value}</span>
          <span className="text-muted-foreground/60">{it.label}</span>
        </span>
      ))}
    </div>
  );
}
