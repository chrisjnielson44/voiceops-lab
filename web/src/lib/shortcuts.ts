/**
 * Canonical keyboard-shortcut reference. The implementation lives in
 * `useKeyboardShortcuts`; the Settings → Shortcuts tab renders this list. Keep
 * the two in sync.
 */
export interface ShortcutDef {
  id: string;
  keys: string[];
  label: string;
  group: "General" | "Navigation";
}

// Routes for the "g then key" leader navigation.
export const NAV_SHORTCUTS: { key: string; path: string; label: string }[] = [
  { key: "h", path: "/", label: "Home" },
  { key: "s", path: "/studio", label: "Studio" },
  { key: "n", path: "/scenarios", label: "Scenarios" },
  { key: "v", path: "/voices", label: "Voices" },
  { key: "m", path: "/models", label: "Models" },
  { key: "a", path: "/analytics", label: "Analytics" },
  { key: "c", path: "/calls", label: "Call History" },
  { key: "l", path: "/logs", label: "Logs & Audit" },
  { key: "i", path: "/integrations", label: "Integrations" },
];

export const SHORTCUTS: ShortcutDef[] = [
  { id: "command", keys: ["⌘", "K"], label: "Open search / command palette", group: "General" },
  { id: "settings", keys: ["⌘", ","], label: "Open settings", group: "General" },
  { id: "theme", keys: ["⇧", "D"], label: "Toggle light / dark", group: "General" },
  ...NAV_SHORTCUTS.map((n) => ({
    id: `nav-${n.key}`,
    keys: ["G", n.key.toUpperCase()],
    label: `Go to ${n.label}`,
    group: "Navigation" as const,
  })),
];
