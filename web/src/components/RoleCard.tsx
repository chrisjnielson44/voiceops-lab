"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Headset, Lock } from "lucide-react";

import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/StatusChip";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";

interface RoleCardData {
  scenarioId: string;
  payer: string;
  payerId: string;
  category: string;
  objective: string;
  requiredFields: string[];
  patient: { name: string; memberId: string };
  records: string[];
}

/**
 * Briefs the human who plays the payer rep in a text role-play: who they are,
 * who's calling and why, and — collapsibly — what's on file so they can answer
 * accurately. Data comes from GET /api/scenarios/{id}/role-card (the same ground
 * truth the agent is grounded on, so the two sides stay consistent).
 */
export function RoleCard({ scenarioId }: { scenarioId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["role-card", scenarioId],
    enabled: !!scenarioId,
    queryFn: async () => {
      const r = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}/role-card`);
      if (!r.ok) throw new Error(`role-card ${r.status}`);
      return (await r.json()) as RoleCardData;
    },
  });

  if (!scenarioId || isLoading || !data) return null;

  return (
    <Card className="shrink-0 border-sky-500/30 bg-sky-500/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300">
          <Headset className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            You're the {data.payer} provider-services rep
          </p>
          <p className="text-xs text-muted-foreground">
            A VoiceOps agent is calling about {data.patient.name} ({data.patient.memberId}). It leads — authenticate
            it, then answer from your records.
          </p>
        </div>
        <StatusChip tone="slate" className="ml-auto capitalize">{data.category.replace("-", " ")}</StatusChip>
      </div>

      {data.records.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            <Lock className="h-3 w-3" /> What's on file ({data.records.length})
          </button>
          <CollapsibleContent open={open}>
            <ul className="mt-2 space-y-1 border-t border-sky-500/20 pt-2">
              {data.records.map((r, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-foreground/85">{r}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </>
      )}
    </Card>
  );
}
