"use client";

import { useEffect } from "react";
import { useAccentColor } from "@/state/useAccentColor";

/** Syncs the persisted accent color preference to document.documentElement[data-accent]. */
export function AccentProvider() {
  const accentColor = useAccentColor((s) => s.accentColor);

  useEffect(() => {
    const root = document.documentElement;
    if (accentColor === "default") {
      root.removeAttribute("data-accent");
    } else {
      root.setAttribute("data-accent", accentColor);
    }
  }, [accentColor]);

  return null;
}
