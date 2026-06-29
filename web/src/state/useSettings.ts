"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SettingsTab =
  | "appearance"
  | "playground"
  | "integrations"
  | "projects"
  | "shortcuts"
  | "account";

/** Defaults that seed a new Playground session (overridable per session). */
export interface PlaygroundDefaults {
  model: string;
  voiceId: string;
  runtime: "livekit" | "vercel";
  scenarioId: string;
  temperature: number;
}

interface SettingsState {
  playgroundDefaults: Partial<PlaygroundDefaults>;
  setPlaygroundDefaults: (patch: Partial<PlaygroundDefaults>) => void;

  // Text-to-speech is OFF by default so ElevenLabs credits are never spent
  // without an explicit opt-in (read-aloud in Simulate, voice previews, etc.).
  ttsEnabled: boolean;
  setTtsEnabled: (on: boolean) => void;

  // Ephemeral UI state (not persisted) — lets the sidebar, top bar, and ⌘K
  // palette all drive the same dialogs.
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;

  settingsOpen: boolean;
  settingsTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setSettingsTab: (tab: SettingsTab) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      playgroundDefaults: {},
      setPlaygroundDefaults: (patch) =>
        set((s) => ({ playgroundDefaults: { ...s.playgroundDefaults, ...patch } })),

      ttsEnabled: false,
      setTtsEnabled: (on) => set({ ttsEnabled: on }),

      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),

      settingsOpen: false,
      settingsTab: "account",
      openSettings: (tab) =>
        set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
      closeSettings: () => set({ settingsOpen: false }),
      setSettingsTab: (tab) => set({ settingsTab: tab }),
    }),
    {
      name: "voiceops-settings",
      // Only persist user preferences — never the transient dialog/palette flags.
      partialize: (s) => ({ playgroundDefaults: s.playgroundDefaults, ttsEnabled: s.ttsEnabled }),
    },
  ),
);
