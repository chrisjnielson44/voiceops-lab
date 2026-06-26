"use client";

import { useEffect, useRef } from "react";

import { useSettings } from "@/state/useSettings";
import { useTheme } from "@/components/theme/ThemeProvider";
import { NAV_SHORTCUTS } from "@/lib/shortcuts";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global keyboard shortcuts. Mounted once in the app shell.
 *  - ⌘K / Ctrl+K   toggle command palette
 *  - ⌘, / Ctrl+,   open settings
 *  - ⇧D            toggle light/dark
 *  - g then p/s/a/c/i  navigate (vim-style leader)
 */
export function useKeyboardShortcuts(navigate: (path: string) => void) {
  const { toggleCommand, openSettings } = useSettings();
  const { resolvedTheme, setTheme } = useTheme();
  // Refs so the listener stays stable while reading fresh values.
  const themeRef = useRef({ resolvedTheme, setTheme });
  themeRef.current = { resolvedTheme, setTheme };

  useEffect(() => {
    let leader = 0; // timestamp of a recent "g" press

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleCommand();
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        openSettings();
        return;
      }

      if (isTypingTarget(e.target) || mod || e.altKey) return;

      if (e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const { resolvedTheme: cur, setTheme: set } = themeRef.current;
        set(cur === "dark" ? "light" : "dark");
        return;
      }

      // Leader: "g" then a nav key within 1s.
      if (e.key.toLowerCase() === "g") {
        leader = e.timeStamp;
        return;
      }
      if (leader && e.timeStamp - leader < 1000) {
        const hit = NAV_SHORTCUTS.find((n) => n.key === e.key.toLowerCase());
        leader = 0;
        if (hit) {
          e.preventDefault();
          navigate(hit.path);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleCommand, openSettings]);
}
