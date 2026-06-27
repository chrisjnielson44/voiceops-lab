"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Mic, Database, Sparkles, Check } from "lucide-react";

import { useCallStore, type FeedItem } from "@/state/useCallStore";
import { Conversation, ConversationEmptyState } from "@/components/ai/Conversation";
import { Message, Response, type MessageRole } from "@/components/ai/Message";
import { AgentActivity } from "@/components/ai/AgentActivity";
import type { LiveReasoning, LiveTool, LiveTurn, ReasoningSegment } from "@/lib/agent/types";
import type { Speaker } from "@/lib/simulation/types";

/** A ChatGPT/Claude-style typing indicator while the next turn is generating. */
function ThinkingRow({ label }: { label: string }) {
  return (
    <div className="flex w-full items-center gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
        <Bot className="h-4 w-4" />
      </span>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function roleOf(speaker: Speaker): MessageRole {
  return speaker === "ivr" ? "system" : speaker;
}

/**
 * Typewriter reveal for the latest live agent turn. The backend can't stream the
 * spoken text token-by-token (it's embedded in a JSON action that's only valid
 * once complete), so we animate the reveal client-side when the turn lands —
 * giving the agent's reply the same "typing out" feel as its streamed reasoning.
 * `key` is the turn id being streamed (null = show full text, no animation).
 */
function useTypewriter(text: string, key: string | null): string {
  const [shown, setShown] = useState(text);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!key || !text) {
      setShown(text);
      return;
    }
    let cancelled = false;
    const len = text.length;
    const duration = Math.min(1600, Math.max(350, len * 14));
    const start = performance.now();
    setShown("");
    const tick = (now: number) => {
      if (cancelled) return;
      const p = Math.min(1, (now - start) / duration);
      setShown(text.slice(0, Math.floor(len * p)));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else setShown(text);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [text, key]);
  return key ? shown : text;
}

export interface LiveMessage {
  id: string;
  role: MessageRole;
  text: string;
}

/** A grouped thread item: a dialogue turn, plus (for agent turns) the internal
 *  activity that produced it — its reasoning and any tool calls. */
type Group =
  | { type: "turn"; turn: LiveTurn; reasoning?: LiveReasoning; tools: LiveTool[] }
  | { type: "activity"; id: string; reasoning?: LiveReasoning; tools: LiveTool[] };

/** Merge an agent turn's (possibly multi-step) reasoning blocks into one: the
 *  latest graph walk + latest weighed predictions + the full chain-of-thought. */
function mergeReasoning(list: LiveReasoning[]): LiveReasoning | undefined {
  if (list.length === 0) return undefined;
  const last = list[list.length - 1];
  if (list.length === 1) return last;
  const latestSeg = (phase: ReasoningSegment["phase"]): ReasoningSegment | undefined => {
    for (let i = list.length - 1; i >= 0; i--) {
      const seg = list[i].segments.find((s) => s.phase === phase);
      if (seg) return seg;
    }
    return undefined;
  };
  const thinkText = list
    .flatMap((r) => r.segments.filter((s) => s.phase === "think").map((s) => s.text))
    .filter(Boolean)
    .join("\n\n");
  const segments: ReasoningSegment[] = [];
  const retrieve = latestSeg("retrieve");
  const anticipate = latestSeg("anticipate");
  if (retrieve) segments.push(retrieve);
  if (anticipate) segments.push(anticipate);
  if (thinkText) segments.push({ phase: "think", title: "Reasoned over the call", text: thinkText });
  return { ...last, segments };
}

/** Fold the flat feed into a two-party thread, attaching each agent turn's
 *  preceding reasoning + tool calls to that turn as collapsible activity. */
function groupFeed(items: FeedItem[]): Group[] {
  const groups: Group[] = [];
  let reasonings: LiveReasoning[] = [];
  let tools: LiveTool[] = [];
  const flushActivity = (key: string) => {
    if (reasonings.length || tools.length) {
      groups.push({ type: "activity", id: `act-${key}`, reasoning: mergeReasoning(reasonings), tools });
      reasonings = [];
      tools = [];
    }
  };
  for (const it of items) {
    if (it.kind === "reasoning") {
      reasonings.push(it.reasoning);
    } else if (it.kind === "tool") {
      tools.push(it.tool);
    } else {
      const role = roleOf(it.turn.speaker);
      const agentSide = role === "agent" || role === "system";
      if (agentSide) {
        groups.push({ type: "turn", turn: it.turn, reasoning: mergeReasoning(reasonings), tools });
        reasonings = [];
        tools = [];
      } else {
        // The payer doesn't own preceding agent activity — surface it standalone.
        flushActivity(it.turn.id);
        groups.push({ type: "turn", turn: it.turn, tools: [] });
      }
    }
  }
  flushActivity("tail");
  return groups;
}

/** Per-agent-turn metadata: how many records grounded it, how many were
 *  anticipated, and whether anticipation actually paid off (a prefetch hit). */
function TurnChips({ turn, tools }: { turn: LiveTurn; tools: LiveTool[] }) {
  const grounded = turn.grounded ?? 0;
  const anticipated = turn.anticipated ?? 0;
  const hit = tools.some((t) => t.prefetchHit);
  if (!grounded && !anticipated && !hit) return null;
  return (
    <>
      {grounded > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <Database className="h-2.5 w-2.5" /> {grounded} grounded
        </span>
      )}
      {anticipated > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-300">
          <Sparkles className="h-2.5 w-2.5" /> {anticipated} anticipated
        </span>
      )}
      {hit && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
          <Check className="h-2.5 w-2.5" /> anticipation hit
        </span>
      )}
    </>
  );
}

/**
 * Renders the unified agent transcript in the Vercel-AI-Elements style: a clean
 * two-party dialogue (agent ↔ payer rep) where each agent turn's reasoning and
 * tool calls are folded into a collapsible "worked on this" activity block, so
 * the conversation stays legible while the full activity is one click away. In
 * LIVE mode it can also render raw LiveKit transcriptions via `messages`.
 */
export function StudioTranscript({
  messages,
  emptyTitle = "Ready to run",
  emptyDescription,
  thinking = false,
  revealCount,
}: {
  messages?: LiveMessage[];
  emptyTitle?: string;
  emptyDescription?: string;
  thinking?: boolean;
  /** When set (voice on), only this many feed items are shown — paced to the
   *  read-aloud so the transcript never runs ahead of the audio. */
  revealCount?: number;
}) {
  const feed = useCallStore((s) => s.feed);
  const status = useCallStore((s) => s.status);
  // Only show what the playback has revealed (voice on) or everything (off).
  const visible = revealCount == null ? feed : feed.slice(0, Math.max(0, revealCount));
  const caughtUp = revealCount == null || revealCount >= feed.length;

  // Stream the agent's spoken text as it lands. Target the most recent feed item
  // only when it's an agent turn, the call is live, and we're not pacing to audio
  // (Read mode) — replays and finished calls render instantly.
  const live = status === "active" || status === "dialing";
  const lastFeed = visible[visible.length - 1];
  const streamTurn =
    revealCount == null && live && lastFeed?.kind === "turn" && (lastFeed.turn.speaker === "agent" || lastFeed.turn.speaker === "ivr")
      ? lastFeed.turn
      : null;
  const revealed = useTypewriter(streamTurn?.text ?? "", streamTurn?.id ?? null);

  // Derive a live activity label from who spoke last among VISIBLE turns.
  let thinkingLabel = "Agent is working";
  for (let i = visible.length - 1; i >= 0; i--) {
    const it = visible[i];
    if (it.kind === "turn") {
      thinkingLabel = it.turn.speaker === "payer" ? "Agent is thinking" : "Payer is responding";
      break;
    }
  }

  if (messages) {
    return (
      <Conversation deps={messages.length}>
        {messages.length === 0 ? (
          <ConversationEmptyState icon={<Mic className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} />
        ) : (
          messages.map((m) => (
            <Message key={m.id} role={m.role}>
              <Response>{m.text}</Response>
            </Message>
          ))
        )}
      </Conversation>
    );
  }

  // Track streaming reasoning growth so auto-scroll stays pinned while the
  // last visible block grows in place (its length changes, not the count).
  const lastItem = visible[visible.length - 1];
  const streamSig =
    lastItem && lastItem.kind === "reasoning"
      ? lastItem.reasoning.segments.reduce((a, s) => a + s.text.length, 0)
      : 0;
  const showThinking = thinking && caughtUp;
  const groups = groupFeed(visible);

  return (
    <Conversation deps={`${visible.length}:${thinking}:${streamSig}:${revealCount ?? -1}:${revealed.length}`}>
      {feed.length === 0 && !thinking ? (
        <ConversationEmptyState icon={<Mic className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {groups.map((g) => {
            if (g.type === "activity") {
              return <AgentActivity key={g.id} reasoning={g.reasoning} tools={g.tools} streaming={g.reasoning?.streaming} />;
            }
            const role = roleOf(g.turn.speaker);
            const agentSide = role === "agent" || role === "system";
            return (
              <div key={g.turn.id} className="flex flex-col gap-2">
                {agentSide && (g.reasoning || g.tools.length > 0) && (
                  <AgentActivity reasoning={g.reasoning} tools={g.tools} streaming={g.reasoning?.streaming} />
                )}
                <Message
                  role={role}
                  latencyMs={g.turn.latencyMs}
                  atMs={g.turn.atMs}
                  chips={agentSide ? <TurnChips turn={g.turn} tools={g.tools} /> : undefined}
                >
                  <Response streaming={streamTurn?.id === g.turn.id}>
                    {streamTurn?.id === g.turn.id ? revealed : g.turn.text}
                  </Response>
                </Message>
              </div>
            );
          })}
          {showThinking && <ThinkingRow label={thinkingLabel} />}
        </>
      )}
    </Conversation>
  );
}
