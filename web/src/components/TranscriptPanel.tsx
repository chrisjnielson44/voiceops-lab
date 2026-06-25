"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Headphones,
  Voicemail,
  Activity,
  UserSearch,
  ShieldCheck,
  FileSearch,
  ClipboardCheck,
  ArrowUpRight,
  NotebookPen,
  Captions,
  PhoneCall,
  Lock,
  Wrench,
} from "lucide-react";
import { useCallStore } from "@/state/useCallStore";
import { getScenario } from "@/lib/simulation/scenarios";
import type { LiveTool, LiveTurn } from "@/lib/agent/types";
import type { Speaker } from "@/lib/simulation/types";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";

const SPEAKER: Record<Speaker, { label: string; icon: React.ReactNode; bubble: string; badge: string }> = {
  agent: { label: "Agent", icon: <Bot className="h-4 w-4" />, bubble: "bg-secondary/60 border-border", badge: "bg-primary text-primary-foreground" },
  payer: { label: "Payer rep", icon: <Headphones className="h-4 w-4" />, bubble: "glass-inset border-border", badge: "bg-secondary text-foreground" },
  ivr: { label: "IVR", icon: <Voicemail className="h-4 w-4" />, bubble: "bg-violet-500/10 border-violet-500/20", badge: "bg-violet-500 text-white" },
  system: { label: "System", icon: <Activity className="h-4 w-4" />, bubble: "bg-emerald-500/10 border-emerald-500/20", badge: "bg-emerald-500 text-white" },
};

const TOOL_ICON: Record<string, React.ReactNode> = {
  lookup_patient: <UserSearch className="h-4 w-4" />,
  verify_eligibility: <ShieldCheck className="h-4 w-4" />,
  verify_claim: <FileSearch className="h-4 w-4" />,
  record_status: <ClipboardCheck className="h-4 w-4" />,
  escalate: <ArrowUpRight className="h-4 w-4" />,
  summarize: <NotebookPen className="h-4 w-4" />,
};

const TOOL_TONE: Record<"ok" | "warn" | "error", Tone> = { ok: "green", warn: "amber", error: "red" };

function Equalizer() {
  return (
    <span className="flex h-3 items-end gap-0.5 text-brand-500">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="eq-bar h-3 animate-bar-bounce" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

const rowMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
};

function ToolRow({ tool }: { tool: LiveTool }) {
  return (
    <motion.div layout {...rowMotion} className="flex items-start gap-3">
      <div className="flex w-14 shrink-0 justify-end pt-1">
        <span className="tabular text-[11px] text-muted-foreground">T+{formatClock(tool.atMs)}</span>
      </div>
      <div className="glass-inset flex-1 rounded-2xl px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-foreground ring-1 ring-inset ring-border">
            {TOOL_ICON[tool.tool] ?? <Wrench className="h-4 w-4" />}
          </span>
          <span className="font-mono text-xs font-semibold text-foreground">{tool.tool}</span>
          <StatusChip tone={TOOL_TONE[tool.status]}>{tool.status}</StatusChip>
          {tool.phi && (
            <StatusChip tone="violet">
              <Lock className="h-3 w-3" /> PHI
            </StatusChip>
          )}
          <span className="ml-auto tabular text-[11px] text-muted-foreground">{tool.latencyMs}ms</span>
        </div>
        {Object.keys(tool.args).length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground">
            {Object.entries(tool.args).map(([k, v]) => (
              <span key={k} className="rounded-md bg-secondary/60 px-1.5 py-0.5 ring-1 ring-inset ring-border">
                {k}=<span className="text-foreground">{String(v)}</span>
              </span>
            ))}
          </div>
        )}
        <div className="mt-1.5 text-xs text-muted-foreground">
          <span className="text-muted-foreground">→ </span>
          {tool.result}
        </div>
      </div>
    </motion.div>
  );
}

function SpeechRow({ turn, speaking }: { turn: LiveTurn; speaking: boolean }) {
  const s = SPEAKER[turn.speaker];
  return (
    <motion.div layout {...rowMotion} className="flex items-start gap-3">
      <div className="flex w-14 shrink-0 justify-end pt-1">
        <span className="tabular text-[11px] text-muted-foreground">T+{formatClock(turn.atMs)}</span>
      </div>
      <div className="flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", s.badge)}>{s.icon}</span>
          <span className="text-xs font-semibold text-foreground">{s.label}</span>
          {speaking && <Equalizer />}
        </div>
        <div className={cn("rounded-2xl border px-3 py-2 text-sm leading-relaxed text-foreground", s.bubble)}>{turn.text}</div>
      </div>
    </motion.div>
  );
}

export function TranscriptPanel() {
  const feed = useCallStore((s) => s.feed);
  const status = useCallStore((s) => s.status);
  const scenarioId = useCallStore((s) => s.scenarioId);
  const scenario = getScenario(scenarioId);
  const scrollRef = useRef<HTMLDivElement>(null);

  let lastTurnId: string | null = null;
  for (let i = feed.length - 1; i >= 0; i--) {
    const f = feed[i];
    if (f.kind === "turn") {
      lastTurnId = f.turn.id;
      break;
    }
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  return (
    <Panel className="h-full">
      <PanelHeader
        title="Live transcript"
        icon={<Captions className="h-4 w-4" />}
        subtitle={`${scenario.payer} · real two-agent call · ${feed.length} events`}
        right={
          <StatusChip tone={status === "active" ? "green" : status === "dialing" ? "blue" : "slate"} dot pulse={status === "active" || status === "dialing"}>
            {status === "active" ? "streaming" : status === "dialing" ? "connecting" : status === "paused" ? "paused" : "standby"}
          </StatusChip>
        }
      />
      <div ref={scrollRef} className="scroll-thin min-h-[440px] flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {feed.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex h-[440px] flex-col items-center justify-center text-center"
          >
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-border">
              <PhoneCall className="h-7 w-7" />
            </span>
            <p className="text-sm font-medium text-foreground">Ready to dial {scenario.payer}</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Press <span className="font-medium text-foreground">Start call</span> — a local model runs the agent while a
              second model plays the payer rep. Captions, real tool calls, and predictions stream live.
            </p>
          </motion.div>
        ) : (
          <AnimatePresence initial={false}>
            {feed.map((item) =>
              item.kind === "tool" ? (
                <ToolRow key={item.tool.id} tool={item.tool} />
              ) : (
                <SpeechRow key={item.turn.id} turn={item.turn} speaking={status === "active" && item.turn.id === lastTurnId} />
              ),
            )}
          </AnimatePresence>
        )}
      </div>
    </Panel>
  );
}
