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
  useTranscriptions,
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
  ShieldCheck,
  Sparkles,
  Square,
  User,
  Volume2,
  VolumeX,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { useCallStore, type LiveInfo } from "@/state/useCallStore";
import { useSettings } from "@/state/useSettings";
import { useScenario } from "@/state/useScenario";
import { PHASES } from "@/lib/simulation/engine";
import type { CallStatus } from "@/lib/simulation/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { PredictivePanel } from "@/components/PredictivePanel";
import { AuditLedger } from "@/components/AuditLedger";
import { ContextGraphView } from "@/components/ContextGraphView";
import { StudioTranscript, type LiveMessage } from "@/components/StudioTranscript";
import { StudioSidecar } from "@/components/StudioSidecar";
import { SimVoicePlayer } from "@/components/SimVoicePlayer";
import { PreConfigView, type VoiceOptions, type ScenarioOpt } from "@/components/PreConfigView";
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
export function StudioView() {
  const mode = useCallStore((s) => s.mode);
  const setMode = useCallStore((s) => s.setMode);
  const scenarioId = useCallStore((s) => s.scenarioId);
  const selectScenario = useCallStore((s) => s.selectScenario);
  const model = useCallStore((s) => s.model);
  const selectModel = useCallStore((s) => s.selectModel);
  const status = useCallStore((s) => s.status);
  const error = useCallStore((s) => s.error);
  const start = useCallStore((s) => s.start);
  const playbackReveal = useCallStore((s) => s.playbackReveal);
  // Session lifecycle lives in the store so it survives navigation away & back.
  const inSession = useCallStore((s) => s.inSession);
  const liveInfo = useCallStore((s) => s.liveInfo);
  const replay = useCallStore((s) => s.replay);
  const setLiveInfo = useCallStore((s) => s.setLiveInfo);
  const openSession = useCallStore((s) => s.openSession);
  const endSession = useCallStore((s) => s.endSession);

  const playgroundDefaults = useSettings((s) => s.playgroundDefaults);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { runId?: string };

  const [drawer, setDrawer] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceRate, setVoiceRate] = useState(1);
  const VOICE_RATES = [1, 1.25, 1.5, 2];
  const cycleVoiceRate = () => setVoiceRate((r) => VOICE_RATES[(VOICE_RATES.indexOf(r) + 1) % VOICE_RATES.length] ?? 1);

  // Live-only config (kept local; the live token + session flags use the store).
  const [voiceId, setVoiceId] = useState("");
  const [temperature, setTemperature] = useState(0.4);
  const [instructions, setInstructions] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
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

  // Deep link / "Open" from Call History: replay a stored run, then drop the param.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    const rid = search?.runId;
    if (rid && openedRef.current !== rid) {
      openedRef.current = rid;
      openSession(rid);
      navigate({ to: "/studio", search: { runId: undefined }, replace: true });
    }
  }, [search?.runId, openSession, navigate]);

  useEffect(() => {
    if (!options) return;
    if (!model) selectModel(playgroundDefaults.model || options.defaults.model);
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

  useEffect(() => {
    if (scenario && !promptDirty) setInstructions(promptFor(scenario));
  }, [scenario, promptDirty]);

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
      else await startLive();
    } finally {
      setLaunching(false);
    }
  };

  const newSession = () => {
    endSession();
    setLiveError(null);
  };

  if (!inSession) {
    return (
      <PreConfigView
        options={options}
        mode={mode}
        onMode={setMode}
        scenarioId={scenarioId}
        onScenario={(id) => { selectScenario(id); setPromptDirty(false); }}
        model={model}
        onModel={selectModel}
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

  const payerVoiceId = options?.voices?.find((v) => v.id !== voiceId)?.id ?? voiceId;
  const voiceActive = voiceOn && !replay; // never auto-speak a replayed call
  const thinking = mode === "simulate" && !replay && (status === "active" || status === "dialing");

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col gap-3">
      <SessionHeader
        scenario={scenario}
        mode={mode}
        status={status}
        model={model}
        replay={replay}
        voiceOn={voiceOn}
        onToggleVoice={() => setVoiceOn((v) => !v)}
        voiceRate={voiceRate}
        onCycleVoiceRate={cycleVoiceRate}
        onNewSession={newSession}
        onInspect={() => setDrawer(true)}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ---- Conversation hero (Claude/ChatGPT/Perplexity style) ---- */}
        <div className="flex min-h-0 flex-col lg:col-span-8">
          {mode === "simulate" ? (
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
          ) : liveInfo ? (
            <Card className="flex h-full min-h-0 flex-col overflow-hidden">
              <LiveKitRoom serverUrl={liveInfo.url} token={liveInfo.token} connect audio video={false} onDisconnected={() => setLiveInfo(null)}>
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

      {mode === "simulate" && <SimVoicePlayer enabled={voiceActive} rate={voiceRate} agentVoiceId={voiceId} payerVoiceId={payerVoiceId} />}

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

function SessionHeader({
  scenario,
  mode,
  status,
  model,
  replay,
  voiceOn,
  onToggleVoice,
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
  onToggleVoice: () => void;
  voiceRate: number;
  onCycleVoiceRate: () => void;
  onNewSession: () => void;
  onInspect: () => void;
}) {
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
    <Card className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            {mode === "live" ? <Radio className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {scenario ? `${scenario.payer} — ${scenario.title}` : "Session"}
            </div>
            <div className="truncate text-xs text-muted-foreground">{(scenario?.category ?? "").replace("-", " ")}</div>
          </div>
        </div>

        <StatusChip tone={meta.tone} dot pulse={meta.pulse}>{meta.label}</StatusChip>
        {replay && <StatusChip tone="blue"><History className="h-3 w-3" /> Replay</StatusChip>}

        {/* phase pills */}
        <div className="hidden items-center gap-1.5 md:flex">
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

        <div className="ml-auto flex items-center gap-2">
          {!replay && <span className="tabular text-lg font-semibold text-foreground">{formatClock(elapsedMs)}</span>}
          <StatusChip tone="violet"><Brain className="h-3 w-3" /> {model.split("/").pop()}</StatusChip>

          {mode === "simulate" && !replay && (
            <div className="flex items-center">
              <Button
                variant="outline"
                size="sm"
                className="rounded-r-none"
                onClick={onToggleVoice}
                title={voiceOn ? "Mute agent voices" : "Unmute agent voices"}
              >
                {voiceOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="-ml-px rounded-l-none tabular font-medium"
                onClick={onCycleVoiceRate}
                disabled={!voiceOn}
                title="Read-aloud speed"
              >
                {voiceRate}×
              </Button>
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
        </div>
      </div>

      {/* member context PHI strip */}
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
  const transcriptions = useTranscriptions();
  const connected = conn === ConnectionState.Connected;

  const messages: LiveMessage[] = transcriptions.map((t, i) => ({
    id: t.streamInfo?.id ?? `${i}`,
    role: (t.participantInfo?.identity ?? "").includes("agent") ? "agent" : "user",
    text: t.text,
  }));

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
      <StudioTranscript messages={messages} emptyTitle="Connected" emptyDescription="The agent will greet you — start speaking when ready." />
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <VoiceAssistantControlBar controls={{ leave: false }} />
        <Button variant="outline" onClick={onEnd}><PhoneOff className="h-4 w-4" /> End session</Button>
      </div>
    </>
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
