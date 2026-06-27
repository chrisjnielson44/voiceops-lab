"use client";

import { motion } from "framer-motion";
import { Bot, Headset } from "lucide-react";

import { cn } from "@/lib/cn";

export type MessageRole = "agent" | "user" | "payer" | "system";

const ROLE_LABEL: Record<MessageRole, string> = {
  agent: "VoiceOps agent",
  user: "You",
  payer: "Payer rep",
  system: "System",
};

function clockOf(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A single conversation turn. The autonomous agent (our side) renders full-width
 * and flat (assistant), while the counterparty — the payer rep we're calling —
 * renders as a right-aligned pill. `chips` carries per-turn metadata (e.g. how
 * many records grounded the turn); `atMs` shows the call-relative clock.
 */
export function Message({
  role,
  children,
  latencyMs,
  atMs,
  chips,
}: {
  role: MessageRole;
  children: React.ReactNode;
  latencyMs?: number | null;
  atMs?: number;
  chips?: React.ReactNode;
}) {
  const isAgent = role === "agent" || role === "system";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex w-full gap-3", isAgent ? "justify-start" : "justify-end")}
    >
      {isAgent && (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Bot className="h-4 w-4" />
        </span>
      )}
      <div className={cn("min-w-0 max-w-[85%]", !isAgent && "flex flex-col items-end")}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">{ROLE_LABEL[role]}</span>
          {atMs != null && <span className="tabular text-[10px] text-muted-foreground/60">{clockOf(atMs)}</span>}
          {latencyMs != null && latencyMs > 0 && (
            <span className="tabular text-[10px] text-muted-foreground/70">{latencyMs}ms</span>
          )}
          {chips}
        </div>
        <div
          className={cn(
            "text-sm leading-relaxed",
            isAgent
              ? "text-foreground"
              : "rounded-2xl rounded-tr-sm bg-secondary px-3.5 py-2 text-secondary-foreground",
          )}
        >
          {children}
        </div>
      </div>
      {!isAgent && (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
          <Headset className="h-4 w-4" />
        </span>
      )}
    </motion.div>
  );
}

/** Streaming-tolerant text renderer (markdown-lite: preserves line breaks).
 *  When `streaming`, a blinking caret trails the revealed text. */
export function Response({ children, streaming }: { children: string; streaming?: boolean }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      {children}
      {streaming && (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current align-baseline" aria-hidden />
      )}
    </div>
  );
}
