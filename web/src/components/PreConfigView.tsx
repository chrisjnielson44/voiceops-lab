"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  Keyboard,
  Mic,
  Play,
  Radio,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { RoleCard } from "@/components/RoleCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { StatusChip } from "@/components/ui/StatusChip";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import type { VoiceRuntimeId, VoiceRuntimeStatus } from "@/lib/voice/types";

export interface ScenarioOpt { id: string; title: string; payer: string; category: string; objective: string; requiredFields: string[]; }
export interface VoiceOpt { id: string; name: string; category: string; }
export interface ModelOpt { id: string; label: string; kind: string; reasoning?: boolean; }
export interface VoiceOptions {
  scenarios: ScenarioOpt[];
  voices: VoiceOpt[];
  models: ModelOpt[];
  runtimes?: VoiceRuntimeStatus[];
  defaults: { scenarioId: string; model: string; fastModel?: string; voiceId: string | null; runtime?: VoiceRuntimeId; temperature: number };
  speechProvider: string | null;
}

/**
 * The full-screen pre-config step shown before a session. Pick a mode, a
 * scenario, and a model (reasoning models flagged); Live mode reveals voice +
 * sampling controls. "Start" hands off to the chat-focused session view.
 */
export function PreConfigView({
  options,
  mode,
  onMode,
  lockMode = false,
  pageTitle = "Studio",
  transport = "text",
  onTransport,
  scenarioId,
  onScenario,
  model,
  onModel,
  voiceId,
  onVoice,
  runtime = "livekit",
  onRuntime,
  temperature,
  onTemperature,
  instructions,
  onInstructions,
  onLaunch,
  launching,
  error,
}: {
  options: VoiceOptions | undefined;
  mode: "simulate" | "live";
  onMode: (m: "simulate" | "live") => void;
  /** When the route owns the mode (/simulate, /live), hide the mode toggle. */
  lockMode?: boolean;
  pageTitle?: string;
  /** Live only: how the human plays the payer rep. */
  transport?: "text" | "voice";
  onTransport?: (t: "text" | "voice") => void;
  scenarioId: string;
  onScenario: (id: string) => void;
  model: string;
  onModel: (id: string) => void;
  voiceId: string;
  onVoice: (id: string) => void;
  runtime?: VoiceRuntimeId;
  onRuntime?: (id: VoiceRuntimeId) => void;
  temperature: number;
  onTemperature: (t: number) => void;
  instructions: string;
  onInstructions: (v: string) => void;
  onLaunch: () => void;
  launching: boolean;
  error: string | null;
}) {
  // Live voice needs the agent's TTS voice; text role-play and simulate's TTS
  // both use it too, but a live TEXT session has no speech at all.
  const liveVoice = mode === "live" && transport === "voice";
  const liveText = mode === "live" && transport === "text";
  const [advanced, setAdvanced] = useState(false);
  // On mobile the scenarios stack into one tall column, so collapse to a few and
  // let the user expand. On `sm`+ they sit in a grid, so all are always shown.
  const [showAllScenarios, setShowAllScenarios] = useState(false);
  const MOBILE_SCENARIO_LIMIT = 3;
  const selectedModel = options?.models.find((m) => m.id === model);
  const selectedRuntime = (options?.runtimes ?? []).find((r) => r.id === runtime);
  const ready = !!scenarioId && !!model;
  const scenarioList = options?.scenarios ?? [];
  const hiddenScenarioCount = Math.max(0, scenarioList.length - MOBILE_SCENARIO_LIMIT);
  // Never hide the active scenario behind the fold — expand if it's past the limit.
  const selectedScenarioIndex = scenarioList.findIndex((s) => s.id === scenarioId);
  const scenariosExpanded = showAllScenarios || selectedScenarioIndex >= MOBILE_SCENARIO_LIMIT;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={pageTitle}
        actions={
          lockMode ? null : (
            <div className="inline-flex rounded-full border border-border bg-card/50 p-1">
              <ModeButton active={mode === "simulate"} onClick={() => onMode("simulate")} icon={<Sparkles className="h-3.5 w-3.5" />} label="Simulate" />
              <ModeButton active={mode === "live"} onClick={() => onMode("live")} icon={<Radio className="h-3.5 w-3.5" />} label="Live" />
            </div>
          )
        }
      />

      <p className="-mt-2 max-w-2xl text-sm text-muted-foreground">
        {mode === "live"
          ? "The agent leads the call and you play the payer rep — by text or by voice. Its reasoning over the context graph and its anticipation stream as you talk."
          : "The agent and a simulated payer converse end-to-end. Watch the agent reason over a context graph and anticipate the call."}
      </p>

      {/* Live: choose how you participate (you are the payer rep either way). */}
      {mode === "live" && (
        <section className="flex flex-col gap-3">
          <SectionLabel>How you'll play the rep</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TransportCard
              active={transport === "text"}
              onClick={() => onTransport?.("text")}
              icon={<Keyboard className="h-4 w-4" />}
              title="Text role-play"
              desc="Type the rep's replies. The agent leads and reasons out loud. No mic or keys needed."
            />
            <TransportCard
              active={transport === "voice"}
              onClick={() => onTransport?.("voice")}
              icon={<Mic className="h-4 w-4" />}
              title="Voice call"
              desc="Speak as the rep over the selected realtime runtime. Text role-play uses none."
            />
          </div>
          {(options?.runtimes?.length ?? 0) > 0 && (
            <RuntimePicker
              runtimes={options?.runtimes ?? []}
              runtime={runtime}
              selectedRuntime={selectedRuntime}
              muted={transport !== "voice"}
              note={
                transport !== "voice"
                  ? "Runtime is used when you choose Voice call. Text role-play runs through the backend text loop."
                  : null
              }
              onRuntime={onRuntime}
            />
          )}
          <RoleCard scenarioId={scenarioId} />
        </section>
      )}

      {mode === "simulate" && (options?.runtimes?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-3">
          <RuntimePicker
            runtimes={options?.runtimes ?? []}
            runtime={runtime}
            selectedRuntime={selectedRuntime}
            note="Simulation still runs the backend agent loop; this selects the preferred voice runtime for realtime voice sessions and keeps the setup consistent."
            onRuntime={onRuntime}
          />
        </section>
      )}

      {error && (
        <div className="glass flex items-center gap-2 rounded-2xl border-amber-500/20 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Scenario */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Scenario</SectionLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {scenarioList.map((s, i) => {
            const selected = s.id === scenarioId;
            // Hide items past the limit on mobile only (always visible on sm+).
            const collapsedOnMobile = !scenariosExpanded && i >= MOBILE_SCENARIO_LIMIT;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onScenario(s.id)}
                className={cn("text-left", collapsedOnMobile && "hidden sm:block")}
              >
                <Card
                  className={cn(
                    "flex h-full flex-col gap-2 p-4 transition-all",
                    selected ? "border-brand-500 ring-2 ring-brand-500 ring-offset-1 ring-offset-background dark:bg-brand-500/10" : "hover:border-foreground/20",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{s.payer}</span>
                    <StatusChip tone="slate">{s.category}</StatusChip>
                  </div>
                  <p className="text-xs font-medium text-foreground/90">{s.title}</p>
                  <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{s.objective}</p>
                  <span className="mt-auto pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {s.requiredFields.length} fields to capture
                  </span>
                </Card>
              </button>
            );
          })}
        </div>
        {hiddenScenarioCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAllScenarios((v) => !v)}
            className="self-start text-muted-foreground sm:hidden"
          >
            {scenariosExpanded ? "Show fewer" : `View ${hiddenScenarioCount} more`}
            <ChevronDown className={cn("h-4 w-4 transition-transform", scenariosExpanded && "rotate-180")} />
          </Button>
        )}
      </section>

      {/* Model */}
      <section className="flex flex-col gap-3">
        <SectionLabel>
          Model
          {selectedModel?.reasoning && (
            <StatusChip tone="violet"><Brain className="h-3 w-3" /> reasoning</StatusChip>
          )}
        </SectionLabel>
        <Select value={model} onValueChange={onModel}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Select a model" /></SelectTrigger>
          <SelectContent>
            {(options?.models ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-2">
                  {m.reasoning && <Brain className="h-3.5 w-3.5 text-violet-500" />}
                  {m.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {selectedModel?.reasoning
            ? "This model thinks out loud — its chain-of-thought streams into the reasoning trace, interleaved with the graph walk and predictions."
            : "Pick a reasoning model (qwen3 / gemma) to watch the agent's chain-of-thought stream inline."}
          {mode === "simulate" && " The payer and predictor run on a faster model to keep the simulation responsive."}
          {liveText && " You play the payer, so only the agent and predictor run a model."}
        </p>
      </section>

      {/* Voice picker — simulate's TTS read-aloud, or the live voice call. Hidden
          for text role-play (no speech). */}
      {(mode === "simulate" || liveVoice) && (options?.voices?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-3">
          <SectionLabel>
            Agent voice
            {options?.speechProvider && <StatusChip tone="slate">{options.speechProvider}</StatusChip>}
          </SectionLabel>
          <Select value={voiceId} onValueChange={onVoice}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select a voice" /></SelectTrigger>
            <SelectContent>
              {(options?.voices ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {mode === "simulate"
              ? "Heard in the simulation — the agent speaks this voice and the payer a contrasting one. Mute anytime from the session header."
              : "The agent speaks with this voice on the live call."}
          </p>
        </section>
      )}

      {/* Live VOICE sampling + system prompt (the call's LLM). Text role-play
          uses the orchestrator's prompt, so it's not exposed here. */}
      {liveVoice && (
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setAdvanced((a) => !a)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-180")} />
            Advanced — sampling &amp; system prompt
          </button>
          <CollapsibleContent open={advanced}>
            <div className="flex flex-col gap-4 pt-1">
              <Field label={`Temperature · ${temperature.toFixed(2)}`}>
                <Slider min={0} max={1} step={0.05} value={[temperature]} onValueChange={([t]) => onTemperature(t)} className="py-1" />
              </Field>
              <Field label="System prompt">
                <textarea
                  value={instructions}
                  onChange={(e) => onInstructions(e.target.value)}
                  rows={6}
                  className="scroll-thin w-full resize-y rounded-lg border border-input bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>
          </CollapsibleContent>
          {options?.speechProvider == null && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              No speech provider / agent worker configured — Live voice will connect but may not speak. Simulate shows the full pipeline.
            </p>
          )}
        </section>
      )}

      {/* CTA */}
      <div className="flex justify-center pt-2">
        <motion.div whileTap={{ scale: 0.98 }}>
          <Button onClick={onLaunch} disabled={!ready || launching} size="lg" className="px-8">
            {launching ? (
              <Radio className="h-4 w-4 animate-pulse" />
            ) : liveText ? (
              <Keyboard className="h-4 w-4" />
            ) : liveVoice ? (
              <Mic className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {launching ? "Starting…" : liveText ? "Start role-play" : liveVoice ? "Start call" : "Start simulation"}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

function TransportCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card
        className={cn(
          "flex h-full items-start gap-3 p-4 transition-all",
          active ? "border-brand-500 ring-2 ring-brand-500 ring-offset-1 ring-offset-background dark:bg-brand-500/10" : "hover:border-foreground/20",
        )}
      >
        <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", active ? "bg-brand-500/15 text-brand-600 dark:text-brand-300" : "bg-secondary text-muted-foreground")}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{desc}</p>
        </div>
      </Card>
    </button>
  );
}

function RuntimePicker({
  runtimes,
  runtime,
  selectedRuntime,
  muted = false,
  note,
  onRuntime,
}: {
  runtimes: VoiceRuntimeStatus[];
  runtime: VoiceRuntimeId;
  selectedRuntime: VoiceRuntimeStatus | undefined;
  muted?: boolean;
  note?: string | null;
  onRuntime?: (id: VoiceRuntimeId) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Runtime</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {runtimes.map((r) => (
          <RuntimeCard
            key={r.id}
            runtime={r}
            active={runtime === r.id}
            muted={muted}
            onClick={() => onRuntime?.(r.id)}
          />
        ))}
      </div>
      {note ? (
        <p className="text-[11px] text-muted-foreground">{note}</p>
      ) : selectedRuntime && !selectedRuntime.configured ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {selectedRuntime.label} is selectable, but launch needs {selectedRuntime.missingEnv.join(" or ")}.
        </p>
      ) : null}
    </div>
  );
}

function RuntimeCard({
  runtime,
  active,
  muted = false,
  onClick,
}: {
  runtime: VoiceRuntimeStatus;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card
        className={cn(
          "flex h-full flex-col gap-2 p-4 transition-all",
          active ? "border-brand-500 ring-2 ring-brand-500 ring-offset-1 ring-offset-background dark:bg-brand-500/10" : "hover:border-foreground/20",
          muted && "opacity-70",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">{runtime.label}</span>
          <StatusChip tone={runtime.configured ? "green" : "slate"} dot>
            {runtime.configured ? "configured" : "stub"}
          </StatusChip>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{runtime.detail}</p>
      </Card>
    </button>
  );
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon} {label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>;
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
