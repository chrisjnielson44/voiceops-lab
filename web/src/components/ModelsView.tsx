"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Cloud, Cpu, Server, Star, Zap } from "lucide-react";
import { toast } from "sonner";

import { getModelProvider } from "@/lib/modelProvider";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionItem, MotionStagger } from "@/components/ui/motion";
import { useProviderStatus } from "@/state/useProviderStatus";
import { useSettings } from "@/state/useSettings";
import { cn } from "@/lib/cn";

interface ModelOpt {
  id: string;
  label: string;
  kind: string;
}
interface VoiceOptions {
  models: ModelOpt[];
  defaults: { model: string };
}

function shortId(id: string): string {
  return (id.split("/").pop() ?? id).replace(/-4bit$/i, "").replace(/-Instruct/i, "");
}

// ── View ──────────────────────────────────────────────────────────────────────

export function ModelsView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const playgroundDefaults = useSettings((s) => s.playgroundDefaults);
  const setPlaygroundDefaults = useSettings((s) => s.setPlaygroundDefaults);
  const { data: providers } = useProviderStatus();

  const { data, isLoading } = useQuery({
    queryKey: ["voice-options"],
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return (await r.json()) as VoiceOptions;
    },
  });

  const models = data?.models ?? [];
  const defaultModel = playgroundDefaults.model ?? data?.defaults.model ?? models[0]?.id;
  const localOk = providers?.localLLM?.ok;

  const setDefault = (m: ModelOpt) => {
    setPlaygroundDefaults({ model: m.id });
    toast.success(`${shortId(m.id)} set as default model`);
  };
  const use = (m: ModelOpt) => {
    setPlaygroundDefaults({ model: m.id });
    onNavigate("/simulate");
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Models"
        actions={
          providers?.localLLM && (
            <StatusChip tone={localOk ? "green" : "red"} dot pulse={localOk}>
              <Cpu className="h-3 w-3" /> {localOk ? "runtime online" : "runtime offline"}
            </StatusChip>
          )
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-2.5 w-16" />
                  </div>
                </div>
                <Skeleton className="h-8 w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <MotionStagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {models.map((m) => {
            const isLocal = m.kind === "local";
            const isDefault = m.id === defaultModel;
            const provider = getModelProvider(m.id, isLocal);
            return (
              <MotionItem key={m.id} whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                <Card
                  className={cn(
                    "group flex h-full flex-col transition-colors",
                    isDefault && "ring-1 ring-brand-500/40",
                  )}
                >
                  <CardContent className="flex flex-1 flex-col gap-3 p-4">
                    {/* Identity: logo + name + provider */}
                    <div className="flex items-start gap-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/60 ring-1 ring-inset ring-border/60">
                        {provider.logo}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold text-foreground">{shortId(m.id)}</h3>
                          {isDefault && <Star className="h-3 w-3 shrink-0 fill-brand-500 text-brand-500" />}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{provider.name}</p>
                      </div>
                    </div>

                    {/* Meta: status + environment */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {isLocal ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              localOk ? "bg-emerald-500" : "bg-red-500",
                            )}
                          />
                          {localOk ? "ready" : "offline"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                          hosted
                        </span>
                      )}
                      <span className="text-border">·</span>
                      <span className="inline-flex items-center gap-1">
                        {isLocal ? <Server className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                        {isLocal ? "MLX local" : "cloud"}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="mt-auto flex gap-2 pt-0.5">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => use(m)}>
                        <Zap className="h-3.5 w-3.5" /> Use
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isDefault}
                        onClick={() => setDefault(m)}
                        aria-label="Set as default model"
                      >
                        {isDefault ? <Check className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </MotionItem>
            );
          })}
        </MotionStagger>
      )}

      {providers?.llm && providers.llm.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Providers</h2>
          <MotionStagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providers.llm.map((p) => (
              <MotionItem key={p.id}>
                <Card className="h-full">
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{p.label}</span>
                      <StatusChip tone={p.configured ? "green" : "slate"} dot={p.configured}>
                        {p.configured ? "configured" : "not configured"}
                      </StatusChip>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.detail}</p>
                    {p.missingEnv.length > 0 && (
                      <p className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                        missing: {p.missingEnv.join(", ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </MotionItem>
            ))}
          </MotionStagger>
        </section>
      )}
    </div>
  );
}
