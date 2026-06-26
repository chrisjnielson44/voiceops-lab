"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight, Wrench } from "lucide-react";

import type { LiveReasoning, LiveTool } from "@/lib/agent/types";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { ReasoningSegments } from "@/components/ai/ReasoningTrace";
import { Tool } from "@/components/ai/Tool";
import { Shimmer } from "@/components/ai/Shimmer";
import { cn } from "@/lib/cn";

/**
 * The agent's internal work for one turn — its reasoning (graph walk → chain-of-
 * thought → weighed predictions) and any tool calls — collapsed behind a single
 * "worked on this" disclosure so the dialogue stays a clean two-party thread.
 * Auto-opens while the model streams, then settles closed (AI-Elements behavior).
 */
export function AgentActivity({
  reasoning,
  tools,
  streaming,
}: {
  reasoning?: LiveReasoning;
  tools: LiveTool[];
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(!!streaming);
  const userToggled = useRef(false);

  useEffect(() => {
    if (userToggled.current) return;
    if (streaming) {
      setOpen(true);
      return;
    }
    const id = setTimeout(() => {
      if (!userToggled.current) setOpen(false);
    }, 1400);
    return () => clearTimeout(id);
  }, [streaming]);

  if (!reasoning && tools.length === 0) return null;

  const seconds = reasoning?.durationMs != null ? Math.max(1, Math.round(reasoning.durationMs / 1000)) : null;
  const summary = streaming ? (
    <Shimmer className="text-xs font-medium">Working…</Shimmer>
  ) : (
    <span className="text-xs font-medium text-foreground">{seconds != null ? `Worked for ${seconds}s` : "Agent activity"}</span>
  );

  return (
    <div className="ml-10 rounded-2xl border border-dashed border-border bg-card/30">
      <button
        type="button"
        onClick={() => {
          userToggled.current = true;
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Brain className={cn("h-3.5 w-3.5 shrink-0 text-brand-500", streaming && "animate-pulse")} />
        {summary}
        {tools.length > 0 && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <Wrench className="h-3 w-3" />
            {tools.length} tool{tools.length === 1 ? "" : "s"}
          </span>
        )}
      </button>

      <CollapsibleContent open={open}>
        <div className="space-y-2 border-t border-border px-3 py-3">
          {reasoning && <ReasoningSegments reasoning={reasoning} streaming={streaming} />}
          {tools.map((t) => (
            <Tool key={t.id} tool={t} />
          ))}
        </div>
      </CollapsibleContent>
    </div>
  );
}
