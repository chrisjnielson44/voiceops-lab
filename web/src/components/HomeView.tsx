"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  AudioLines,
  BarChart3,
  Clock,
  Cloud,
  History,
  Mic,
  PhoneCall,
  Plug,
  Radio,
  ScrollText,
  Server,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionItem, MotionStagger } from "@/components/ui/motion";
import { useSettings } from "@/state/useSettings";
import { useCallStore } from "@/state/useCallStore";
import { useProviderStatus } from "@/state/useProviderStatus";
import { useSession } from "@/lib/auth/client";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";

interface AnalyticsResponse {
  hasData: boolean;
  totals?: {
    totalCalls: number;
    completionRate: number;
    escalationRate: number;
    avgHandleTimeSec: number;
  };
}
interface CallSummary {
  id: string;
  payer: string | null;
  scenarioId: string | null;
  outcome: string | null;
  status: string | null;
  durationSec: number | null;
  startedAt: string | null;
}
interface ScenarioOpt {
  id: string;
  title: string;
  payer: string;
  category: string;
}
interface ModelOpt {
  id: string;
  label: string;
  kind: string;
}
interface VoiceOptions {
  scenarios: ScenarioOpt[];
  models: ModelOpt[];
}

function outcomeVariant(o: string | null): "success" | "warning" | "destructive" | "secondary" {
  if (o === "completed") return "success";
  if (o === "escalated") return "warning";
  if (o === "failed" || o === "abandoned") return "destructive";
  return "secondary";
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function shortModel(id: string): string {
  return (id.split("/").pop() ?? id).replace(/-4bit$/i, "").replace(/-Instruct/i, "");
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const setPlaygroundDefaults = useSettings((s) => s.setPlaygroundDefaults);
  const setMode = useCallStore((s) => s.setMode);
  const { data: session } = useSession();
  const { data: providers } = useProviderStatus();
  const firstName = (session?.user?.name ?? "").trim().split(/\s+/)[0];

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const r = await fetch("/api/analytics");
      if (!r.ok) throw new Error(`analytics ${r.status}`);
      return (await r.json()) as AnalyticsResponse;
    },
  });
  const { data: callsData, isLoading: callsLoading } = useQuery({
    queryKey: ["calls"],
    queryFn: async () => {
      const r = await fetch("/api/calls");
      if (!r.ok) throw new Error(`calls ${r.status}`);
      return (await r.json()) as { hasData: boolean; calls: CallSummary[] };
    },
  });
  const { data: options, isLoading: optionsLoading } = useQuery({
    queryKey: ["voice-options"],
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return (await r.json()) as VoiceOptions;
    },
  });

  const t = analytics?.totals;
  const recent = (callsData?.calls ?? []).slice(0, 5);
  const scenarios = (options?.scenarios ?? []).slice(0, 6);
  const models = (options?.models ?? []).slice(0, 3);
  const localOk = providers?.localLLM?.ok;

  const startScenario = (id: string) => {
    setPlaygroundDefaults({ scenarioId: id });
    setMode("simulate");
    onNavigate("/studio");
  };

  const kpis = [
    { label: "Total calls", value: t ? t.totalCalls.toLocaleString() : "0", icon: <PhoneCall className="h-4 w-4" /> },
    { label: "Completion", value: t ? formatPercent(t.completionRate) : "—", icon: <TrendingUp className="h-4 w-4" /> },
    { label: "Escalation", value: t ? formatPercent(t.escalationRate) : "—", icon: <BarChart3 className="h-4 w-4" /> },
    { label: "Avg handle time", value: t?.avgHandleTimeSec ? fmtDuration(t.avgHandleTimeSec) : "—", icon: <Clock className="h-4 w-4" /> },
  ];

  const resources = [
    { label: "Analytics", desc: "Outcomes & volume", icon: <BarChart3 className="h-4 w-4" />, path: "/analytics" },
    { label: "Logs & Audit", desc: "Event stream & ledger", icon: <ScrollText className="h-4 w-4" />, path: "/logs" },
    { label: "Voices", desc: "ElevenLabs catalog", icon: <AudioLines className="h-4 w-4" />, path: "/voices" },
    { label: "Integrations", desc: "Telephony & providers", icon: <Plug className="h-4 w-4" />, path: "/integrations" },
  ];

  return (
    <div className="flex flex-col gap-7">
      {/* Greeting + primary actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="logo-mark grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Mic className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {greeting()}{firstName ? `, ${firstName}` : ""}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <StatusChip tone={localOk ? "green" : "slate"} dot pulse={localOk}>
                {localOk ? "runtime online" : "runtime offline"}
              </StatusChip>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { setMode("live"); onNavigate("/studio"); }}>
            <Mic className="h-4 w-4" /> New session
          </Button>
          <Button variant="outline" onClick={() => { setMode("simulate"); onNavigate("/studio"); }}>
            <Radio className="h-4 w-4" /> Run a simulation
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <MotionStagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <MotionItem key={k.label} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
            <Card className="h-full">
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">{k.label}</span>
                  {k.icon}
                </div>
                {analyticsLoading && !t ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <div className="tabular text-2xl font-semibold text-foreground">{k.value}</div>
                )}
              </CardContent>
            </Card>
          </MotionItem>
        ))}
      </MotionStagger>

      {/* Models — like a dev console's model cards */}
      {(optionsLoading || models.length > 0) && (
        <section className="flex flex-col gap-3">
          <SectionHead title="Models" actionLabel="All models" onAction={() => onNavigate("/models")} />
          {optionsLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="h-[74px]">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-20 rounded-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
          <MotionStagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((m) => {
              const isLocal = m.kind === "local";
              return (
                <MotionItem key={m.id} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                  <button type="button" onClick={() => onNavigate("/models")} className="block w-full text-left">
                    <Card className="group h-full">
                      <CardContent className="flex items-center gap-3 p-4">
                        <span
                          className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                            isLocal ? "bg-violet-500/10 text-violet-500" : "bg-brand-500/10 text-brand-500",
                          )}
                        >
                          {isLocal ? <Server className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-foreground">{shortModel(m.id)}</div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <StatusChip tone={isLocal ? "violet" : "blue"}>{isLocal ? "MLX · local" : "hosted"}</StatusChip>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </CardContent>
                    </Card>
                  </button>
                </MotionItem>
              );
            })}
          </MotionStagger>
          )}
        </section>
      )}

      {/* Two-column: quick-start scenarios + recent activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <section className="flex flex-col gap-3">
          <SectionHead title="Start a session" actionLabel="All scenarios" onAction={() => onNavigate("/scenarios")} />
          <MotionStagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {optionsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="h-[68px]">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Skeleton className="h-9 w-9 rounded-lg" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : scenarios.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-xs text-muted-foreground">No scenarios available.</CardContent>
              </Card>
            ) : (
              scenarios.map((s) => (
                <MotionItem key={s.id} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                  <button type="button" onClick={() => startScenario(s.id)} className="block w-full text-left">
                    <Card className="group h-full">
                      <CardContent className="flex items-start gap-3 p-4">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                          <Sparkles className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{s.title}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{s.payer}</div>
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </CardContent>
                    </Card>
                  </button>
                </MotionItem>
              ))
            )}
          </MotionStagger>

          {/* Resource links */}
          <SectionHead title="Explore" className="mt-3" />
          <MotionStagger className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {resources.map((r) => (
              <MotionItem key={r.path} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                <button type="button" onClick={() => onNavigate(r.path)} className="block w-full text-left">
                  <Card className="h-full">
                    <CardContent className="flex flex-col gap-2 p-4">
                      <span className="text-muted-foreground">{r.icon}</span>
                      <div>
                        <div className="text-sm font-medium text-foreground">{r.label}</div>
                        <div className="text-[11px] text-muted-foreground">{r.desc}</div>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              </MotionItem>
            ))}
          </MotionStagger>
        </section>

        {/* Recent activity */}
        <section className="flex flex-col gap-3">
          <SectionHead title="Recent calls" actionLabel="View all" onAction={() => onNavigate("/calls")} />
          <Card className="flex flex-col">
            <CardContent className="p-2">
              {callsLoading ? (
                <ul className="divide-y divide-border">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-2 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <div className="flex flex-col gap-1.5">
                          <Skeleton className="h-3.5 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </li>
                  ))}
                </ul>
              ) : recent.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-center text-xs text-muted-foreground">
                  No calls yet — start a session to see activity.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-2 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                          <History className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{c.payer ?? "Call"}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{c.scenarioId ?? ""}</div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular text-[11px] text-muted-foreground">{fmtDuration(c.durationSec)}</span>
                        <Badge variant={outcomeVariant(c.outcome)}>{c.outcome ?? c.status ?? "—"}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function SectionHead({
  title,
  actionLabel,
  onAction,
  className,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {actionLabel} <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
