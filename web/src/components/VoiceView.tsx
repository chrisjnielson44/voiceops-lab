"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Mic, PhoneOff, Radio, Loader2, AlertTriangle, SlidersHorizontal, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

import { Panel, PanelHeader } from "@/components/ui/Panel";
import { StatusChip } from "@/components/ui/StatusChip";
import { cn } from "@/lib/cn";

interface ScenarioOpt {
  id: string;
  title: string;
  payer: string;
  category: string;
  objective: string;
  requiredFields: string[];
}
interface VoiceOpt {
  id: string;
  name: string;
  category: string;
}
interface ModelOpt {
  id: string;
  label: string;
  kind: string;
}
interface VoiceOptions {
  scenarios: ScenarioOpt[];
  voices: VoiceOpt[];
  models: ModelOpt[];
  defaults: { scenarioId: string; model: string; voiceId: string | null; temperature: number };
  speechProvider: string | null;
}
interface TokenInfo {
  url: string;
  token: string;
  room: string;
  runId: string;
}

function promptFor(s: ScenarioOpt): string {
  return [
    `You are VoiceOps, an autonomous healthcare voice agent calling ${s.payer} provider services.`,
    ``,
    `Objective: ${s.objective}`,
    ``,
    `Authenticate first, then use your tools to verify the member and ${s.category.replace("-", " ")} details.`,
    `Speak only facts returned by tools — never invent coverage, claim, or auth details.`,
    `Capture: ${s.requiredFields.join(", ")}. If a peer-to-peer review is required, escalate. Then summarize and end politely.`,
  ].join("\n");
}

const AGENT_STATE_TONE: Record<string, "green" | "amber" | "blue" | "slate"> = {
  listening: "green",
  thinking: "amber",
  speaking: "blue",
  initializing: "slate",
};

export function VoiceView() {
  const { data: options, isLoading } = useQuery({
    queryKey: ["voice-options"],
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return r.json() as Promise<VoiceOptions>;
    },
  });

  const [scenarioId, setScenarioId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [voiceId, setVoiceId] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.4);
  const [instructions, setInstructions] = useState<string>("");
  const [promptDirty, setPromptDirty] = useState(false);

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize from server defaults once options arrive.
  useEffect(() => {
    if (!options) return;
    setScenarioId((v) => v || options.defaults.scenarioId);
    setModel((v) => v || options.defaults.model);
    setVoiceId((v) => v || options.defaults.voiceId || options.voices[0]?.id || "");
    setTemperature((v) => v || options.defaults.temperature);
  }, [options]);

  const scenario = useMemo(
    () => options?.scenarios.find((s) => s.id === scenarioId),
    [options, scenarioId],
  );

  // Prefill the system prompt from the scenario unless the user has edited it.
  useEffect(() => {
    if (scenario && !promptDirty) setInstructions(promptFor(scenario));
  }, [scenario, promptDirty]);

  const start = async () => {
    setError(null);
    setConnecting(true);
    try {
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId, model, voiceId, instructions, temperature }),
      });
      if (res.status === 503) return setError("LiveKit is not configured on the server.");
      if (!res.ok) return setError(`Failed to start (${res.status}).`);
      setInfo((await res.json()) as TokenInfo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start session.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-lg font-semibold text-foreground">Voice agent sandbox</h1>
        <p className="text-xs text-muted-foreground">
          Compose a configuration — scenario, model, voice, prompt — and talk to the agent live. WebRTC via LiveKit,
          ElevenLabs speech, on-device LLM.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {/* ---- Config rail ---- */}
        <Panel className="h-fit">
          <PanelHeader title="Configuration" icon={<SlidersHorizontal className="h-4 w-4" />} />
          <div className="flex flex-col gap-4 p-4">
            {isLoading || !options ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Field label="Scenario">
                  <Select
                    value={scenarioId}
                    onChange={(v) => {
                      setScenarioId(v);
                      setPromptDirty(false);
                    }}
                    options={options.scenarios.map((s) => ({ value: s.id, label: `${s.payer} — ${s.title}` }))}
                  />
                </Field>

                <Field label="Model" hint={options.models.find((m) => m.id === model)?.kind}>
                  <Select
                    value={model}
                    onChange={setModel}
                    options={options.models.map((m) => ({ value: m.id, label: m.label }))}
                  />
                </Field>

                <Field label="Voice" hint={options.speechProvider ?? undefined}>
                  <Select
                    value={voiceId}
                    onChange={setVoiceId}
                    options={options.voices.map((v) => ({ value: v.id, label: v.name }))}
                  />
                </Field>

                <Field label={`Temperature · ${temperature.toFixed(2)}`}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                  />
                </Field>

                <Field label="System prompt">
                  <textarea
                    value={instructions}
                    onChange={(e) => {
                      setInstructions(e.target.value);
                      setPromptDirty(true);
                    }}
                    rows={9}
                    className="scroll-thin w-full resize-y rounded-xl border border-input bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
              </>
            )}
          </div>
        </Panel>

        {/* ---- Session stage ---- */}
        <div className="min-w-0">
          {!info ? (
            <Panel className="flex h-full flex-col">
              <PanelHeader title="Session" icon={<Sparkles className="h-4 w-4" />} />
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-foreground">
                  <Mic className="h-7 w-7" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">Ready to start</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                    {scenario ? scenario.objective : "Pick a configuration on the left, then start the session and talk."}
                  </p>
                </div>
                {options?.speechProvider == null && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Speech provider not configured on the server, and the agent worker must be running.</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={start}
                  disabled={connecting || isLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                  {connecting ? "Connecting…" : "Start session"}
                </button>
                {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              </div>
            </Panel>
          ) : (
            <LiveKitRoom
              serverUrl={info.url}
              token={info.token}
              connect
              audio
              video={false}
              onDisconnected={() => setInfo(null)}
            >
              <RoomAudioRenderer />
              <VoiceSession onEnd={() => setInfo(null)} />
            </LiveKitRoom>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function VoiceSession({ onEnd }: { onEnd: () => void }) {
  const conn = useConnectionState();
  const { state, audioTrack } = useVoiceAssistant();
  const transcriptions = useTranscriptions();
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcriptions.length]);

  const connected = conn === ConnectionState.Connected;
  const mmss = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, "0")}`;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Live session"
        icon={<Radio className="h-4 w-4" />}
        right={
          <div className="flex items-center gap-2">
            <StatusChip tone={connected ? "green" : "amber"} dot pulse={!connected}>
              {conn}
            </StatusChip>
            <StatusChip tone={AGENT_STATE_TONE[state] ?? "slate"}>{state}</StatusChip>
            <span className="tabular text-xs text-muted-foreground">{mmss}</span>
          </div>
        }
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex h-24 items-center justify-center rounded-xl bg-secondary/40">
          <BarVisualizer state={state} barCount={9} trackRef={audioTrack} className="h-14 w-56" options={{ minHeight: 8 }} />
        </div>

        <div ref={scrollRef} className="scroll-thin min-h-[220px] flex-1 overflow-y-auto rounded-xl bg-card/40 p-3">
          {transcriptions.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-center text-xs text-muted-foreground">
              Connected — the agent will greet you. Start speaking when you're ready.
            </div>
          ) : (
            <ol className="space-y-2">
              {transcriptions.map((t) => {
                const isAgent = (t.participantInfo?.identity ?? "").includes("agent");
                return (
                  <li key={t.streamInfo?.id ?? t.text} className="text-sm">
                    <span className={cn("mr-1.5 text-[10px] font-semibold uppercase", isAgent ? "text-blue-500" : "text-emerald-500")}>
                      {isAgent ? "agent" : "you"}
                    </span>
                    <span className="text-foreground/85">{t.text}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <VoiceAssistantControlBar controls={{ leave: false }} />
          <button
            type="button"
            onClick={onEnd}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            <PhoneOff className="h-4 w-4" /> End session
          </button>
        </div>
      </div>
    </Panel>
  );
}
