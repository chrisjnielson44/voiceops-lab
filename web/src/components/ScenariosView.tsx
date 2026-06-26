"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Layers, Target } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionItem, MotionStagger } from "@/components/ui/motion";
import { useSettings } from "@/state/useSettings";

interface ScenarioOpt {
  id: string;
  title: string;
  pack: string;
  packLabel: string;
  payer: string;
  category: string;
  objective: string;
  requiredFields: string[];
}
interface VoiceOptions {
  scenarios: ScenarioOpt[];
}

export function ScenariosView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const setPlaygroundDefaults = useSettings((s) => s.setPlaygroundDefaults);

  const { data, isLoading } = useQuery({
    queryKey: ["voice-options"],
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return (await r.json()) as VoiceOptions;
    },
  });

  // Group scenarios by their pack so the catalog reads like a library.
  const packs = useMemo(() => {
    const map = new Map<string, { label: string; items: ScenarioOpt[] }>();
    for (const s of data?.scenarios ?? []) {
      const entry = map.get(s.pack) ?? { label: s.packLabel, items: [] };
      entry.items.push(s);
      map.set(s.pack, entry);
    }
    return [...map.entries()];
  }, [data]);

  const launch = (id: string) => {
    setPlaygroundDefaults({ scenarioId: id });
    onNavigate("/studio");
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Scenarios"
        actions={
          data && (
            <span className="text-sm text-muted-foreground">
              {data.scenarios.length} scenarios · {packs.length} {packs.length === 1 ? "pack" : "packs"}
            </span>
          )
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-44">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
                <Skeleton className="mt-auto h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        packs.map(([packId, pack]) => (
          <section key={packId} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Layers className="h-4 w-4" />
              {pack.label}
            </div>
            <MotionStagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pack.items.map((s) => (
                <MotionItem key={s.id} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                  <Card className="group flex h-full flex-col">
                    <CardContent className="flex flex-1 flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-foreground">{s.title}</h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">{s.payer}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0 capitalize">
                          {s.category.replace(/-/g, " ")}
                        </Badge>
                      </div>

                      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                        <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="line-clamp-3">{s.objective}</span>
                      </p>

                      {s.requiredFields.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {s.requiredFields.slice(0, 4).map((f) => (
                            <StatusChip key={f} tone="slate">
                              {f.replace(/_/g, " ")}
                            </StatusChip>
                          ))}
                          {s.requiredFields.length > 4 && (
                            <StatusChip tone="slate">+{s.requiredFields.length - 4}</StatusChip>
                          )}
                        </div>
                      )}

                      <div className="mt-auto pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => launch(s.id)}
                        >
                          Launch in Studio
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </MotionItem>
              ))}
            </MotionStagger>
          </section>
        ))
      )}
    </div>
  );
}
