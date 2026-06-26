"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  Mic,
  Play,
  Radio,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

export interface ScenarioOpt { id: string; title: string; payer: string; category: string; objective: string; requiredFields: string[]; }
export interface VoiceOpt { id: string; name: string; category: string; }
export interface ModelOpt { id: string; label: string; kind: string; reasoning?: boolean; }
export interface VoiceOptions {
  scenarios: ScenarioOpt[];
  voices: VoiceOpt[];
  models: ModelOpt[];
  defaults: { scenarioId: string; model: string; voiceId: string | null; temperature: number };
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
  scenarioId,
  onScenario,
  model,
  onModel,
  voiceId,
  onVoice,
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
  scenarioId: string;
  onScenario: (id: string) => void;
  model: string;
  onModel: (id: string) => void;
  voiceId: string;
  onVoice: (id: string) => void;
  temperature: number;
  onTemperature: (t: number) => void;
  instructions: string;
  onInstructions: (v: string) => void;
  onLaunch: () => void;
  launching: boolean;
  error: string | null;
}) {
  const [advanced, setAdvanced] = useState(false);
  const selectedModel = options?.models.find((m) => m.id === model);
  const ready = !!scenarioId && !!model;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 py-6">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Wand2 className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Configure a session</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a scenario and a model, then watch the agent reason over a context graph and anticipate the call.
          </p>
        </div>
      </div>

      {/* Mode */}
      <div className="mx-auto inline-flex rounded-full border border-border bg-card/50 p-1">
        <ModeButton active={mode === "simulate"} onClick={() => onMode("simulate")} icon={<Sparkles className="h-3.5 w-3.5" />} label="Simulate" />
        <ModeButton active={mode === "live"} onClick={() => onMode("live")} icon={<Radio className="h-3.5 w-3.5" />} label="Live voice" />
      </div>

      {error && (
        <div className="glass flex items-center gap-2 rounded-2xl border-amber-500/20 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Scenario */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Scenario</SectionLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(options?.scenarios ?? []).map((s) => {
            const selected = s.id === scenarioId;
            return (
              <button key={s.id} type="button" onClick={() => onScenario(s.id)} className="text-left">
                <Card
                  className={cn(
                    "flex h-full flex-col gap-2 p-4 transition-all",
                    selected ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-background" : "hover:border-foreground/20",
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
        </p>
      </section>

      {/* Voice — heard in BOTH modes (Simulate plays it via TTS; Live speaks it) */}
      {(options?.voices?.length ?? 0) > 0 && (
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

      {/* Live-only sampling controls */}
      {mode === "live" && (
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
            ) : mode === "live" ? (
              <Mic className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {launching ? "Starting…" : mode === "live" ? "Start session" : "Start simulation"}
          </Button>
        </motion.div>
      </div>
    </div>
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
