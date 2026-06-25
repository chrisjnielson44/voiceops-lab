"use client";

import { ChevronDown, Layers, ShieldCheck, Cpu, Server } from "lucide-react";
import { useCallStore } from "@/state/useCallStore";
import type { ProviderStatusResponse } from "@/state/useProviderStatus";
import { SCENARIOS, getScenario } from "@/lib/simulation/scenarios";
import { Dropdown, DropdownItem } from "@/components/ui/Dropdown";
import { StatusChip } from "@/components/ui/StatusChip";
import { cn } from "@/lib/cn";

function modelLabel(id?: string): string {
  if (!id) return "local model";
  return (id.split("/").pop() ?? id).replace(/-4bit$/i, "").replace(/-Instruct/i, "");
}

export function ModelRouterBar({ providerStatus }: { providerStatus: ProviderStatusResponse | null }) {
  const scenarioId = useCallStore((s) => s.scenarioId);
  const status = useCallStore((s) => s.status);
  const selectScenario = useCallStore((s) => s.selectScenario);

  const scenario = getScenario(scenarioId);
  const llm = providerStatus?.localLLM;
  const locked = status === "active" || status === "dialing" || status === "paused";

  return (
    <div className="glass flex flex-wrap items-stretch gap-2 rounded-2xl p-2 shadow-glass">
      {/* Scenario selector */}
      <Dropdown
        widthClass="w-[23rem]"
        button={
          <div className={cn("glass-inset flex items-center gap-2 rounded-xl px-3 py-2 transition", locked ? "opacity-60" : "hover:bg-accent")}>
            <Layers className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Scenario</div>
              <div className="truncate text-sm font-semibold text-foreground">
                {scenario.payer} · {scenario.title}
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>
        }
      >
        <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Payer scenarios
        </div>
        {SCENARIOS.map((s) => (
          <DropdownItem key={s.id} active={s.id === scenarioId} onClick={() => !locked && selectScenario(s.id)}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground">{s.title}</span>
                <StatusChip tone={s.outcome === "escalated" ? "amber" : "green"}>{s.difficulty}</StatusChip>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{s.payer}</span>
                <span className="text-muted-foreground">·</span>
                <span className="capitalize">{s.category.replace("-", " ")}</span>
              </div>
            </div>
          </DropdownItem>
        ))}
        <p className="px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          The scenario sets the task (payer, member, objective). The call itself is run live by local models —
          nothing is scripted.
        </p>
      </Dropdown>

      {/* Active local model */}
      <div className="glass-inset flex items-center gap-2 rounded-xl px-3 py-2">
        <Server className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Runtime model</div>
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{modelLabel(llm?.model)}</span>
            <StatusChip tone="violet">MLX · local</StatusChip>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex flex-wrap items-center gap-2">
        <div className="glass-inset flex items-center gap-1.5 rounded-xl px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">prompt</span>
          <span className="font-mono text-xs font-medium text-foreground">
            {providerStatus?.promptVersion ?? "payer-ops-v4.0"}
          </span>
        </div>
        <StatusChip tone={llm?.ok ? "green" : "red"} dot pulse={llm?.ok}>
          <Cpu className="h-3 w-3" />
          {llm?.ok ? "model online" : "model offline"}
        </StatusChip>
        <StatusChip tone="amber" dot>
          {providerStatus?.demoMode === false ? "live dialing" : "demo dialing"}
        </StatusChip>
      </div>
    </div>
  );
}
