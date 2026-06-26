"use client";

import { useEffect, useRef } from "react";

import { useCallStore } from "@/state/useCallStore";
import { useSettings } from "@/state/useSettings";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Estimated time to "say" a turn, used to pace Listen mode when TTS audio isn't
 *  available (no key / failure) so the conversation still reads back-and-forth at
 *  a human cadence instead of racing at generation speed. ~156 wpm, clamped. */
function estimateSpeechMs(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ms = (words / 2.6) * 1000;
  return Math.min(12000, Math.max(900, ms)) / (rate || 1);
}

/**
 * Drives Simulate-mode playback so the visible conversation stays in lockstep
 * with the ElevenLabs read-aloud: it reveals feed items in order, and for each
 * spoken turn it synthesizes the audio and WAITS for it to finish before
 * revealing the next item. The transcript renders only `playbackReveal` items, so
 * the text never races ahead of the voice. When muted, everything is revealed
 * immediately (no gating). Side-effect only.
 */
export function SimVoicePlayer({
  enabled,
  rate = 1,
  agentVoiceId,
  payerVoiceId,
}: {
  enabled: boolean;
  rate?: number;
  agentVoiceId: string;
  payerVoiceId: string;
}) {
  const feed = useCallStore((s) => s.feed);
  const setReveal = useCallStore((s) => s.setPlaybackReveal);
  // ElevenLabs only fires when the user has opted in — otherwise Listen mode
  // paces by estimated time (no audio, no credits).
  const ttsEnabled = useSettings((s) => s.ttsEnabled);
  const ttsRef = useRef(ttsEnabled);
  ttsRef.current = ttsEnabled;

  const feedRef = useRef(feed);
  feedRef.current = feed;
  // Resume from wherever playback already is — so navigating away and back
  // doesn't replay the conversation/audio from the top.
  const cursorRef = useRef(useCallStore.getState().playbackReveal);
  const runningRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const setRevealRef = useRef(setReveal);
  setRevealRef.current = setReveal;
  const feedIsEmpty = feed.length === 0;

  // Speed changes apply to the clip currently playing.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  // New run: reset the cursor.
  useEffect(() => {
    if (feedIsEmpty) {
      cursorRef.current = 0;
      setReveal(0);
    }
  }, [feedIsEmpty, setReveal]);

  // Muted → no gating: reveal everything and stop any audio.
  useEffect(() => {
    if (enabled) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    cursorRef.current = feedRef.current.length;
    setReveal(feedRef.current.length);
  }, [enabled, feed.length, setReveal]);

  // Driver loop: reveal items in order, gating spoken turns on their audio.
  useEffect(() => {
    if (!enabled || runningRef.current) return;
    runningRef.current = true;
    (async () => {
      while (enabledRef.current) {
        const f = feedRef.current;
        if (cursorRef.current >= f.length) break;
        const item = f[cursorRef.current];
        setRevealRef.current(cursorRef.current + 1);
        if (item.kind === "turn") {
          const t = item.turn;
          const voiceId = t.speaker === "agent" ? agentVoiceId : t.speaker === "payer" ? payerVoiceId : "";
          const text = (t.text || "").trim();
          if (voiceId && text) await speak(text, voiceId);
          else await delay(150);
        } else {
          // reasoning / tool — a brief beat so the trace lands before the speech
          await delay(220);
        }
        cursorRef.current++;
      }
      runningRef.current = false;
    })();
  }, [enabled, feed.length, agentVoiceId, payerVoiceId]);

  async function speak(text: string, voiceId: string) {
    // When real audio can't play, hold for the estimated speaking time instead of
    // racing ahead — so Listen mode keeps its cadence with or without a TTS key.
    const fallbackMs = estimateSpeechMs(text, rateRef.current);
    // TTS disabled → pace silently, never call ElevenLabs (credit guard).
    if (!ttsRef.current) {
      await delay(fallbackMs);
      return;
    }
    let res: Response | null = null;
    try {
      res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
    } catch {
      res = null;
    }
    if (!enabledRef.current) return;
    if (!res || !res.ok) {
      await delay(fallbackMs); // no audio (e.g. no ElevenLabs key) → timed pacing
      return;
    }
    try {
      const url = URL.createObjectURL(await res.blob());
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audio.playbackRate = rateRef.current;
        audioRef.current = audio;
        let settled = false;
        const done = (waitMs = 0) => {
          if (settled) return;
          settled = true;
          clearTimeout(safety);
          URL.revokeObjectURL(url);
          if (waitMs > 0) setTimeout(resolve, waitMs);
          else resolve();
        };
        // Safety: never let a stuck clip freeze the conversation.
        const safety = setTimeout(() => done(), 30000);
        audio.onended = () => done();
        // Playback failed after we got bytes — still pace by the estimate.
        audio.onerror = () => done(fallbackMs);
        audio.play().catch(() => done(fallbackMs));
      });
    } catch {
      await delay(fallbackMs);
    }
  }

  return null;
}
