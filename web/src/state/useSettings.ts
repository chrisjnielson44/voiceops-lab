"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SettingsTab = "appearance" | "playground" | "shortcuts" | "account";

/** Defaults that seed a new Playground session (overridable per session). */
export interface PlaygroundDefaults {
  model: string;
  voiceId: string;
  scenarioId: string;
  temperature: number;
}

interface SettingsState {
  playgroundDefaults: Partial<PlaygroundDefaults>;
  setPlaygroundDefaults: (patch: Partial<PlaygroundDefaults>) => void;

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

      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),

      settingsOpen: false,
      settingsTab: "appearance",
      openSettings: (tab) =>
        set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
      closeSettings: () => set({ settingsOpen: false }),
      setSettingsTab: (tab) => set({ settingsTab: tab }),
    }),
    {
      name: "voiceops-settings",
      // Only persist user preferences — never the transient dialog/palette flags.
      partialize: (s) => ({ playgroundDefaults: s.playgroundDefaults }),
    },
  ),
);
