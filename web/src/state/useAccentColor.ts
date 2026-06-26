"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type AccentColor, ACCENT_STORAGE_KEY, DEFAULT_ACCENT } from "@/lib/accent";

interface AccentState {
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
}

export const useAccentColor = create<AccentState>()(
  persist(
    (set) => ({
      accentColor: DEFAULT_ACCENT,
      setAccentColor: (color) => set({ accentColor: color }),
    }),
    {
      name: ACCENT_STORAGE_KEY,
    },
  ),
);
