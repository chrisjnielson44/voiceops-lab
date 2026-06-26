"use client";

import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";

import { CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";

/**
 * Collapsible chain-of-thought / rationale block. Pulses "Thinking…" while
 * streaming, settles to "Reasoning" once content has arrived.
 */
export function Reasoning({
  children,
  streaming = false,
  defaultOpen = false,
  label = "Reasoning",
}: {
  children: React.ReactNode;
  streaming?: boolean;
  defaultOpen?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <Brain className={cn("h-3.5 w-3.5 shrink-0", streaming && "animate-pulse")} />
        <span className="text-xs font-medium">{streaming ? "Thinking…" : label}</span>
      </button>
      <CollapsibleContent open={open}>
        <div className="border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </CollapsibleContent>
    </div>
  );
}
