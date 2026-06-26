"use client";

import { useState } from "react";
import { ChevronRight, Database, Loader2 } from "lucide-react";

import { CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/cn";

/** "Used N records" — the context-graph provenance behind an answer. */
export function Sources({ items, label = "context records" }: { items: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">
          Grounded on {items.length} {label}
        </span>
      </button>
      <CollapsibleContent open={open}>
        <ol className="space-y-1 border-t border-border px-3 py-2">
          {items.map((s, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <span className="tabular shrink-0 text-muted-foreground/60">{i + 1}.</span>
              <span className="min-w-0">{s}</span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </div>
  );
}

/** A horizontal row of clickable suggested next utterances (predicted turns). */
export function Suggestions({
  items,
  onPick,
}: {
  items: { label: string; hint?: string }[];
  onPick?: (label: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ScrollArea className="w-full">
      <div className="flex gap-2 pb-1">
        {items.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick?.(s.label)}
            className="shrink-0 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
            title={s.hint}
          >
            {s.label}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

export function Loader({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}
