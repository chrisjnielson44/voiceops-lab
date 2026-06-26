"use client";

import { useState } from "react";
import { ChevronRight, Wrench, Zap, Lock } from "lucide-react";

import type { LiveTool } from "@/lib/agent/types";
import { Badge } from "@/components/ui/badge";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";

function statusVariant(status: LiveTool["status"]): "success" | "warning" | "destructive" {
  if (status === "error") return "destructive";
  if (status === "warn") return "warning";
  return "success";
}

/**
 * A tool invocation rendered inline in the conversation as a collapsible
 * activity card — the heart of "show what the agent does". Surfaces the call
 * arguments, the result, PHI/latency, and whether it was served from the
 * speculative prefetch cache.
 */
export function Tool({ tool }: { tool: LiveTool }) {
  const [open, setOpen] = useState(tool.status === "error");

  return (
    <div className="mx-auto w-full rounded-xl border border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium text-foreground">{tool.tool}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {tool.prefetchHit && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-300">
              <Zap className="h-3 w-3" /> cached{tool.savedMs ? ` · saved ${tool.savedMs}ms` : ""}
            </span>
          )}
          {tool.phi && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">
              <Lock className="h-3 w-3" /> PHI
            </span>
          )}
          <span className="tabular text-[10px] text-muted-foreground">{tool.latencyMs}ms</span>
          <Badge variant={statusVariant(tool.status)}>{tool.status}</Badge>
        </div>
      </button>

      <CollapsibleContent open={open}>
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {tool.args && Object.keys(tool.args).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Input</div>
              <pre className="scroll-thin overflow-x-auto rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-foreground/85">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Result</div>
            <div className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/85">
              {tool.result}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </div>
  );
}
