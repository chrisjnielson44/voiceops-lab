export type AccentColor = "default" | "purple" | "blue" | "green" | "amber" | "rose" | "orange";

export interface AccentPreset {
  value: AccentColor;
  label: string;
  /** HSL triplet used only for the swatch dot in the picker UI */
  dot: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { value: "default", label: "Default", dot: "240 5% 60%" },
  { value: "purple", label: "Purple", dot: "263.4 70% 50.4%" },
  { value: "blue", label: "Blue", dot: "217 91% 55%" },
  { value: "green", label: "Green", dot: "142 65% 42%" },
  { value: "amber", label: "Amber", dot: "38 92% 52%" },
  { value: "rose", label: "Rose", dot: "343 80% 56%" },
  { value: "orange", label: "Orange", dot: "25 95% 55%" },
];

export const DEFAULT_ACCENT: AccentColor = "purple";

export const ACCENT_STORAGE_KEY = "voiceops-accent";
