"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Check, Mic, Star } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionItem, MotionStagger } from "@/components/ui/motion";
import { useSettings } from "@/state/useSettings";
import { cn } from "@/lib/cn";

interface VoiceOpt {
  id: string;
  name: string;
  category: string;
}
interface VoiceOptions {
  voices: VoiceOpt[];
  defaults: { voiceId: string | null };
  speechProvider: string | null;
}

export function VoicesView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const playgroundDefaults = useSettings((s) => s.playgroundDefaults);
  const setPlaygroundDefaults = useSettings((s) => s.setPlaygroundDefaults);

  const { data, isLoading } = useQuery({
    queryKey: ["voice-options"],
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return (await r.json()) as VoiceOptions;
    },
  });

  const defaultVoice = playgroundDefaults.voiceId ?? data?.defaults.voiceId ?? data?.voices[0]?.id;
  const voices = useMemo(() => data?.voices ?? [], [data?.voices]);

  const categories = useMemo(() => {
    const set = new Set(voices.map((v) => v.category || "other"));
    return [...set];
  }, [voices]);

  const setDefault = (v: VoiceOpt) => {
    setPlaygroundDefaults({ voiceId: v.id });
    toast.success(`${v.name} set as default voice`);
  };

  const use = (v: VoiceOpt) => {
    setPlaygroundDefaults({ voiceId: v.id });
    onNavigate("/studio");
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Voices"
        actions={
          data?.speechProvider ? (
            <StatusChip tone="green" dot>
              {data.speechProvider} · {voices.length} voices
            </StatusChip>
          ) : (
            <StatusChip tone="amber" dot>
              fallback catalog
            </StatusChip>
          )
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="h-[120px]">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <MotionStagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {voices.map((v) => {
            const isDefault = v.id === defaultVoice;
            return (
              <MotionItem key={v.id} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                <Card className={cn("group h-full", isDefault && "ring-1 ring-brand-500/40")}>
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                        <AudioLines className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold text-foreground">{v.name}</h3>
                          {isDefault && <Star className="h-3.5 w-3.5 shrink-0 fill-brand-500 text-brand-500" />}
                        </div>
                        {v.category && (
                          <Badge variant="secondary" className="mt-1 capitalize">
                            {v.category}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => use(v)}>
                        <Mic className="h-3.5 w-3.5" /> Use
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isDefault}
                        onClick={() => setDefault(v)}
                        aria-label="Set as default voice"
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

      {!isLoading && categories.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Categories: {categories.join(" · ")}
        </p>
      )}
    </div>
  );
}
