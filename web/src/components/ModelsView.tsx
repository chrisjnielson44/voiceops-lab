"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Cloud, Cpu, Server, Star, Zap } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
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
    onNavigate("/studio");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Models</h1>
        {providers?.localLLM && (
          <StatusChip tone={localOk ? "green" : "red"} dot pulse={localOk}>
            <Cpu className="h-3 w-3" /> {localOk ? "runtime online" : "runtime offline"}
          </StatusChip>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-44">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-auto h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <MotionStagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {models.map((m) => {
            const isLocal = m.kind === "local";
            const isDefault = m.id === defaultModel;
            return (
              <MotionItem key={m.id} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                <Card className={cn("group flex h-full flex-col", isDefault && "ring-1 ring-brand-500/40")}>
                  <CardContent className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn(
                          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                          isLocal ? "bg-violet-500/10 text-violet-500" : "bg-brand-500/10 text-brand-500",
                        )}
                      >
                        {isLocal ? <Server className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
                      </span>
                      <StatusChip tone={isLocal ? "violet" : "blue"}>
                        {isLocal ? "MLX · local" : "hosted"}
                      </StatusChip>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-sm font-semibold text-foreground">{shortId(m.id)}</h3>
                        {isDefault && <Star className="h-3.5 w-3.5 shrink-0 fill-brand-500 text-brand-500" />}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{m.id}</p>
                    </div>

                    {isLocal && (
                      <StatusChip tone={localOk ? "green" : "red"} dot>
                        {localOk ? "ready" : "offline"}
                      </StatusChip>
                    )}

                    <div className="mt-auto flex gap-2 pt-1">
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

      {/* Provider configuration — what's live and what needs env to go online. */}
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
