"use client";

import { useQuery } from "@tanstack/react-query";
import { Keyboard, LogOut, Monitor, Moon, Palette, SlidersHorizontal, Sun, User } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";
import { useSettings, type SettingsTab } from "@/state/useSettings";
import { SHORTCUTS } from "@/lib/shortcuts";
import { signOut } from "@/lib/auth/client";

interface VoiceOptions {
  scenarios: { id: string; title: string; payer: string }[];
  voices: { id: string; name: string }[];
  models: { id: string; label: string }[];
  defaults: { scenarioId: string; model: string; voiceId: string | null; temperature: number };
}

const SECTIONS: { value: SettingsTab; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" />, desc: "Theme and visual preferences." },
  { value: "playground", label: "Playground", icon: <SlidersHorizontal className="h-4 w-4" />, desc: "Defaults that seed every new session." },
  { value: "shortcuts", label: "Shortcuts", icon: <Keyboard className="h-4 w-4" />, desc: "Keyboard shortcuts reference." },
  { value: "account", label: "Account", icon: <User className="h-4 w-4" />, desc: "Your signed-in account." },
];

const THEME_OPTS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
  { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
];

export function SettingsDialog({ user }: { user?: { name?: string | null; email?: string | null } }) {
  const { settingsOpen, settingsTab, setSettingsTab, closeSettings } = useSettings();
  const active = SECTIONS.find((s) => s.value === settingsTab) ?? SECTIONS[0];

  return (
    <Dialog open={settingsOpen} onOpenChange={(o) => (o ? null : closeSettings())}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogDescription className="sr-only">Application settings</DialogDescription>
        <div className="flex h-[min(540px,80vh)]">
          {/* ---- Left nav rail ---- */}
          <aside className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border/70 bg-muted/30 p-2.5 sm:w-52">
            <DialogTitle className="px-2 pb-2 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Settings
            </DialogTitle>
            {SECTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSettingsTab(s.value)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                  settingsTab === s.value
                    ? "bg-background text-foreground shadow-sm ring-1 ring-inset ring-border"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className={cn(settingsTab === s.value ? "text-foreground" : "text-muted-foreground")}>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </aside>

          {/* ---- Content panel ---- */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="border-b border-border/70 px-6 py-4">
              <h2 className="text-sm font-semibold text-foreground">{active.label}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{active.desc}</p>
            </header>
            <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">
              {settingsTab === "appearance" && <AppearanceTab />}
              {settingsTab === "playground" && <PlaygroundTab />}
              {settingsTab === "shortcuts" && <ShortcutsTab />}
              {settingsTab === "account" && <AccountTab user={user} />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="divide-y divide-border">
      <Row label="Theme" hint="Light, dark, or follow your system.">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {THEME_OPTS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                theme === o.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      </Row>
    </div>
  );
}

function PlaygroundTab() {
  const { playgroundDefaults, setPlaygroundDefaults } = useSettings();
  const { data, isLoading } = useQuery({
    queryKey: ["voice-options"],
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return (await r.json()) as VoiceOptions;
    },
  });

  if (isLoading || !data) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading options…</p>;
  }

  const model = playgroundDefaults.model ?? data.defaults.model;
  const voiceId = playgroundDefaults.voiceId ?? data.defaults.voiceId ?? data.voices[0]?.id ?? "";
  const scenarioId = playgroundDefaults.scenarioId ?? data.defaults.scenarioId;
  const temperature = playgroundDefaults.temperature ?? data.defaults.temperature;

  return (
    <div className="divide-y divide-border">
      <Row label="Default scenario" hint="Pre-selected when you open the Playground.">
        <Select value={scenarioId} onValueChange={(v) => setPlaygroundDefaults({ scenarioId: v })}>
          <SelectTrigger className="w-[15rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.scenarios.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.payer} — {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Default model">
        <Select value={model} onValueChange={(v) => setPlaygroundDefaults({ model: v })}>
          <SelectTrigger className="w-[15rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Default voice">
        <Select value={voiceId} onValueChange={(v) => setPlaygroundDefaults({ voiceId: v })}>
          <SelectTrigger className="w-[15rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.voices.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label={`Temperature · ${temperature.toFixed(2)}`} hint="Sampling randomness for new sessions.">
        <Slider
          className="w-[15rem]"
          min={0}
          max={1}
          step={0.05}
          value={[temperature]}
          onValueChange={([t]) => setPlaygroundDefaults({ temperature: t })}
        />
      </Row>
    </div>
  );
}

function ShortcutsTab() {
  const groups = ["General", "Navigation"] as const;
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g}</div>
          <div className="divide-y divide-border rounded-xl border border-border">
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-foreground">{s.label}</span>
                <Kbd keys={s.keys} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountTab({ user }: { user?: { name?: string | null; email?: string | null } }) {
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-border p-4">
        <Avatar className="h-11 w-11 rounded-xl">
          <AvatarFallback className="rounded-xl text-base">{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          {user?.name && <div className="truncate text-sm font-medium text-foreground">{user.name}</div>}
          <div className="truncate text-xs text-muted-foreground">{user?.email ?? "Not signed in"}</div>
        </div>
      </div>
      <Button variant="outline" onClick={() => signOut()} className="gap-2">
        <LogOut className="h-4 w-4" />
        Sign out
      </Button>
    </div>
  );
}
