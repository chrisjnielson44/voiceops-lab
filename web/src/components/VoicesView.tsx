"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Check, Loader2, Mic, Play, Square, Star } from "lucide-react";
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

// What a previewed voice says — a short, on-brand line for a clinic call.
function sampleLine(name: string): string {
  return `Hi, I'm ${name}. Thanks for calling — how can I help you today?`;
}

// Turn a failed /api/voice/tts response into a message that names the real
// cause. The backend wraps ElevenLabs upstream errors in a 502 whose `detail`
// carries the original code (e.g. quota_exceeded, invalid api key), so we sniff
// the body text rather than rely on the outer status alone.
async function previewErrorMessage(res: Response): Promise<string> {
  if (res.status === 503) return "Speech provider isn't configured.";
  const detail = (await res.text().catch(() => "")).toLowerCase();
  if (/quota|credits|exceeds your quota/.test(detail))
    return "ElevenLabs quota exceeded — add credits or use a new API key.";
  if (/api[_ ]?key|unauthorized|invalid|401/.test(detail))
    return "ElevenLabs rejected the request — check the API key.";
  if (/rate.?limit|429/.test(detail)) return "ElevenLabs is rate-limiting — try again shortly.";
  return "Voice preview failed — the speech service is unavailable.";
}

// null = idle; otherwise the voice currently loading or playing.
type Preview = { id: string; phase: "loading" | "playing" } | null;

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
  const canPreview = Boolean(data?.speechProvider);

  const categories = useMemo(() => {
    const set = new Set(voices.map((v) => v.category || "other"));
    return [...set];
  }, [voices]);

  // ── Audio preview ───────────────────────────────────────────────────────────
  // One sample plays at a time. We keep the <audio> element, its blob URL, and an
  // AbortController in refs so switching voices (or unmounting) cancels cleanly.
  const [preview, setPreview] = useState<Preview>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const teardown = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  // Stop everything on unmount.
  useEffect(() => () => teardown(), []);

  const stopPreview = () => {
    teardown();
    setPreview(null);
  };

  const playPreview = async (v: VoiceOpt) => {
    // Clicking the voice that's already loading/playing stops it (toggle).
    if (preview?.id === v.id) {
      stopPreview();
      return;
    }
    if (!canPreview) {
      toast.error("Voice preview needs a speech provider configured.");
      return;
    }

    teardown();
    setPreview({ id: v.id, phase: "loading" });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let res: Response;
    try {
      res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sampleLine(v.name), voiceId: v.id }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // superseded by another click
      setPreview(null);
      toast.error("Couldn't reach the speech service.");
      return;
    }

    if (ctrl.signal.aborted) return;
    if (!res.ok) {
      setPreview(null);
      toast.error(await previewErrorMessage(res));
      return;
    }

    let url: string;
    try {
      url = URL.createObjectURL(await res.blob());
    } catch {
      setPreview(null);
      return;
    }
    if (ctrl.signal.aborted) {
      URL.revokeObjectURL(url);
      return;
    }

    urlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => stopPreview();
    audio.onerror = () => stopPreview();
    try {
      await audio.play();
      // A late abort (user clicked elsewhere) may have torn this down already.
      if (audioRef.current === audio) setPreview({ id: v.id, phase: "playing" });
    } catch {
      stopPreview();
    }
  };

  const setDefault = (v: VoiceOpt) => {
    setPlaygroundDefaults({ voiceId: v.id });
    toast.success(`${v.name} set as default voice`);
  };

  const use = (v: VoiceOpt) => {
    setPlaygroundDefaults({ voiceId: v.id });
    onNavigate("/simulate");
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
            const phase = preview?.id === v.id ? preview.phase : null;
            const isPlaying = phase === "playing";
            const isLoadingPreview = phase === "loading";
            return (
              <MotionItem key={v.id} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                <Card
                  className={cn(
                    "group h-full transition-shadow",
                    isDefault && "ring-1 ring-brand-500/40",
                    phase && "ring-1 ring-brand-500/60",
                  )}
                >
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-center gap-3">
                      {/* The avatar doubles as the preview play/stop button. */}
                      <button
                        type="button"
                        onClick={() => playPreview(v)}
                        disabled={!canPreview}
                        aria-label={
                          !canPreview
                            ? "Voice preview unavailable"
                            : isPlaying
                              ? `Stop preview of ${v.name}`
                              : `Preview ${v.name}`
                        }
                        title={canPreview ? "Hear this voice" : "Speech provider not configured"}
                        className={cn(
                          "relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl transition-colors",
                          phase
                            ? "bg-brand-500/15 text-brand-600 dark:text-brand-400"
                            : "bg-secondary text-muted-foreground",
                          canPreview && "hover:bg-brand-500/15 hover:text-brand-600 dark:hover:text-brand-400",
                          !canPreview && "cursor-not-allowed opacity-60",
                        )}
                      >
                        {isLoadingPreview ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : isPlaying ? (
                          <Square className="h-4 w-4 fill-current" />
                        ) : (
                          <>
                            {/* Idle: waveform; on hover (when previewable): play. */}
                            <AudioLines className={cn("h-5 w-5", canPreview && "group-hover:opacity-0")} />
                            {canPreview && (
                              <Play className="absolute h-4 w-4 fill-current opacity-0 transition-opacity group-hover:opacity-100" />
                            )}
                          </>
                        )}
                      </button>
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
