"use client";

import { Bot, Mic } from "lucide-react";

import { useCallStore } from "@/state/useCallStore";
import { Conversation, ConversationEmptyState } from "@/components/ai/Conversation";
import { Message, Response, type MessageRole } from "@/components/ai/Message";
import { Tool } from "@/components/ai/Tool";
import { ReasoningTrace } from "@/components/ai/ReasoningTrace";
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

export interface LiveMessage {
  id: string;
  role: MessageRole;
  text: string;
}

/**
 * Renders the unified agent transcript in the Vercel-AI-Elements style. In
 * SIMULATE mode it maps the call store's feed (turns + tool calls interleaved)
 * into Message / Tool parts; in LIVE mode it renders the LiveKit transcriptions
 * passed in `messages` — so one Conversation shell serves both modes.
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
  // Only show what the playback has revealed (voice on) or everything (off).
  const visible = revealCount == null ? feed : feed.slice(0, Math.max(0, revealCount));
  const caughtUp = revealCount == null || revealCount >= feed.length;

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

  return (
    <Conversation deps={`${visible.length}:${thinking}:${streamSig}:${revealCount ?? -1}`}>
      {feed.length === 0 && !thinking ? (
        <ConversationEmptyState icon={<Mic className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {visible.map((item) =>
            item.kind === "turn" ? (
              <Message key={item.turn.id} role={roleOf(item.turn.speaker)} latencyMs={item.turn.latencyMs}>
                <Response>{item.turn.text}</Response>
              </Message>
            ) : item.kind === "tool" ? (
              <Tool key={item.tool.id} tool={item.tool} />
            ) : (
              <ReasoningTrace key={item.reasoning.id} reasoning={item.reasoning} />
            ),
          )}
          {showThinking && <ThinkingRow label={thinkingLabel} />}
        </>
      )}
    </Conversation>
  );
}
