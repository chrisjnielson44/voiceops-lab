"use client";

import { motion } from "framer-motion";
import { Bot, User } from "lucide-react";

import { cn } from "@/lib/cn";

export type MessageRole = "agent" | "user" | "payer" | "system";

const ROLE_LABEL: Record<MessageRole, string> = {
  agent: "Agent",
  user: "You",
  payer: "Payer",
  system: "System",
};

/**
 * A single conversation turn. The autonomous agent renders full-width and flat
 * (assistant), while the human/payer side renders as a right-aligned pill —
 * the Vercel AI Elements message convention.
 */
export function Message({
  role,
  children,
  latencyMs,
}: {
  role: MessageRole;
  children: React.ReactNode;
  latencyMs?: number | null;
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
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">{ROLE_LABEL[role]}</span>
          {latencyMs != null && latencyMs > 0 && (
            <span className="tabular text-[10px] text-muted-foreground/70">{latencyMs}ms</span>
          )}
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
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
          <User className="h-4 w-4" />
        </span>
      )}
    </motion.div>
  );
}

/** Streaming-tolerant text renderer (markdown-lite: preserves line breaks). */
export function Response({ children }: { children: string }) {
  return <div className="whitespace-pre-wrap break-words">{children}</div>;
}
