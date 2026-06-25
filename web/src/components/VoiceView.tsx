"use client";

import { useEffect, useRef, useState } from "react";
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
import { Mic, PhoneCall, PhoneOff, Radio, Loader2, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";

import { SCENARIOS, DEFAULT_SCENARIO_ID } from "@/lib/simulation/scenarios";
import { useProviderStatus } from "@/state/useProviderStatus";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { StatusChip } from "@/components/ui/StatusChip";
import { cn } from "@/lib/cn";

interface TokenInfo {
  url: string;
  token: string;
  room: string;
  runId: string;
  scenarioId: string;
}

const AGENT_STATE_TONE: Record<string, "green" | "amber" | "blue" | "slate"> = {
  listening: "green",
  thinking: "amber",
  speaking: "blue",
  initializing: "slate",
};

export function VoiceView() {
  const { data: providerStatus } = useProviderStatus();
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voiceReady = providerStatus?.voice?.some((v) => v.configured);

  const start = async () => {
    setError(null);
    setConnecting(true);
    try {
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId }),
      });
      if (res.status === 503) {
        setError("LiveKit is not configured on the server.");
        return;
      }
      if (!res.ok) {
        setError(`Failed to start (${res.status}).`);
        return;
      }
      setInfo((await res.json()) as TokenInfo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start voice call.");
    } finally {
      setConnecting(false);
    }
  };

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-lg font-semibold text-foreground">Voice call</h1>
        <p className="text-xs text-muted-foreground">
          Talk to the VoiceOps agent in your browser — WebRTC via LiveKit, ElevenLabs speech, on-device LLM.
        </p>
      </motion.div>

      {!info ? (
        <Panel>
          <PanelHeader title="Start a voice call" icon={<PhoneCall className="h-4 w-4" />} />
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Scenario</span>
              <select
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value)}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.payer} — {s.title}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">{scenario.objective}</p>
            </div>

            {!voiceReady && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Voice provider not reported as configured. The call needs the agent worker running
                  (ElevenLabs + LiveKit + the local model).
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={start}
              disabled={connecting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {connecting ? "Connecting…" : "Start voice call"}
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
          <VoiceSession scenarioPayer={scenario.payer} onEnd={() => setInfo(null)} />
        </LiveKitRoom>
      )}
    </div>
  );
}

function VoiceSession({ scenarioPayer, onEnd }: { scenarioPayer: string; onEnd: () => void }) {
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
    <Panel>
      <PanelHeader
        title={`Live call · ${scenarioPayer}`}
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

      <div className="flex flex-col gap-3 p-4">
        <div className="flex h-20 items-center justify-center rounded-xl bg-secondary/40">
          <BarVisualizer
            state={state}
            barCount={7}
            trackRef={audioTrack}
            className="h-12 w-48"
            options={{ minHeight: 8 }}
          />
        </div>

        <div ref={scrollRef} className="scroll-thin max-h-[320px] min-h-[160px] overflow-y-auto rounded-xl bg-card/40 p-3">
          {transcriptions.length === 0 ? (
            <div className="flex h-[140px] items-center justify-center text-center text-xs text-muted-foreground">
              Connected — the agent will greet you. Start speaking when you're ready.
            </div>
          ) : (
            <ol className="space-y-2">
              {transcriptions.map((t) => {
                const isAgent = (t.participantInfo?.identity ?? "").includes("agent");
                return (
                  <li key={t.streamInfo?.id ?? t.text} className="text-sm">
                    <span
                      className={cn(
                        "mr-1.5 text-[10px] font-semibold uppercase",
                        isAgent ? "text-blue-500" : "text-emerald-500",
                      )}
                    >
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
            <PhoneOff className="h-4 w-4" /> End call
          </button>
        </div>
      </div>
    </Panel>
  );
}
