"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AudioLines,
  Box,
  Check,
  Cloud,
  FolderPlus,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Phone,
  Sparkles,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import { Ollama, OpenRouter } from "@lobehub/icons";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";
import { useSettings, type SettingsTab } from "@/state/useSettings";
import { useProviderStatus } from "@/state/useProviderStatus";
import { StatusChip } from "@/components/ui/StatusChip";
import { useProjects } from "@/state/useProjects";
import { useAccentColor } from "@/state/useAccentColor";
import { ACCENT_PRESETS } from "@/lib/accent";
import { SHORTCUTS } from "@/lib/shortcuts";
import { logout, organization, useSession } from "@/lib/auth/client";

interface VoiceOptions {
  scenarios: { id: string; title: string; payer: string }[];
  voices: { id: string; name: string }[];
  models: { id: string; label: string }[];
  defaults: { scenarioId: string; model: string; voiceId: string | null; temperature: number };
}

const TABS: { value: SettingsTab; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "appearance", label: "Appearance" },
  { value: "playground", label: "Playground" },
  { value: "integrations", label: "Integrations" },
  { value: "projects", label: "Projects" },
  { value: "shortcuts", label: "Shortcuts" },
];

const THEME_OPTS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
  { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
];

export function SettingsView() {
  const { settingsTab, setSettingsTab } = useSettings();
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>

      {/* Horizontal tab nav — ChatGPT dev portal style. Scrolls horizontally on
          narrow screens so the tabs never overflow the page. */}
      <div className="mt-6 border-b border-border">
        <nav className="scroll-thin -mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSettingsTab(tab.value)}
              className={cn(
                "shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                settingsTab === tab.value
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="mt-8">
        {settingsTab === "appearance" && <AppearanceTab />}
        {settingsTab === "playground" && <PlaygroundTab />}
        {settingsTab === "integrations" && <IntegrationsTab />}
        {settingsTab === "projects" && <ProjectsTab />}
        {settingsTab === "shortcuts" && <ShortcutsTab />}
        {settingsTab === "account" && <AccountTab user={user} />}
      </div>
    </div>
  );
}

function SectionRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Integrations ────────────────────────────────────────────────────────────
// Read-only view of every external service the backend is wired to (it reads
// env at request time and reports status via /api/providers). Grouped by role:
// language models, voice, telephony.

const ICON = 20;

function integrationIcon(id: string): React.ReactNode {
  switch (id) {
    case "demo":
      return <Sparkles className="h-5 w-5 text-brand-500" />;
    case "openrouter":
      return <OpenRouter size={ICON} className="text-foreground" />;
    case "mlx":
      return <Ollama size={ICON} className="text-foreground" />;
    case "elevenlabs":
      return <AudioLines className="h-5 w-5 text-foreground" />;
    case "livekit":
    case "twilio":
      return <Phone className="h-5 w-5 text-foreground" />;
    default:
      return <Cloud className="h-5 w-5 text-muted-foreground" />;
  }
}

interface IntegrationRow {
  id: string;
  label: string;
  detail: string;
  configured: boolean;
  missingEnv: string[];
  tags?: string[];
}

function IntegrationGroup({ title, items }: { title: string; items: IntegrationRow[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border rounded-xl border border-border">
        {items.map((it) => (
          <div key={it.id} className="flex items-start gap-3 px-5 py-4">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/60 ring-1 ring-inset ring-border/60">
              {integrationIcon(it.id)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{it.label}</span>
                {it.tags?.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px] uppercase tracking-wide">
                    {t}
                  </Badge>
                ))}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{it.detail}</p>
              {it.missingEnv.length > 0 && (
                <p className="mt-1 font-mono text-[11px] text-amber-600 dark:text-amber-400">
                  missing: {it.missingEnv.join(", ")}
                </p>
              )}
            </div>
            <StatusChip tone={it.configured ? "green" : "slate"} dot={it.configured}>
              {it.configured ? "connected" : "not configured"}
            </StatusChip>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const { data, error } = useProviderStatus();

  if (error) {
    return (
      <div className="rounded-xl border border-border px-5 py-8 text-center text-sm text-muted-foreground">
        Couldn’t load integration status — {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-border px-5 py-8 text-center text-sm text-muted-foreground">
        Loading integrations…
      </div>
    );
  }

  const models: IntegrationRow[] = data.llm.map((p) => ({
    id: p.id,
    label: p.label,
    detail: p.detail,
    configured: p.configured,
    missingEnv: p.missingEnv ?? [],
    tags: p.kind ? [p.kind] : undefined,
  }));
  const voice: IntegrationRow[] = data.voice.map((p) => ({
    id: p.id,
    label: p.label,
    detail: p.detail,
    configured: p.configured,
    missingEnv: p.missingEnv ?? [],
    tags: p.capabilities,
  }));
  const telephony: IntegrationRow[] = data.telephony.map((p) => ({
    id: p.id,
    label: p.label,
    detail: p.detail,
    configured: p.configured,
    missingEnv: p.missingEnv ?? [],
    tags: p.demoMode ? ["demo"] : undefined,
  }));

  return (
    <div className="flex flex-col gap-8">
      <p className="-mt-2 text-sm text-muted-foreground">
        Services the backend is connected to. Status reflects the server’s environment
        — set the matching keys (e.g. <code className="rounded bg-muted px-1 py-0.5 text-xs">OPENROUTER_API_KEY</code>)
        to enable a provider.
      </p>
      <IntegrationGroup title="Language models" items={models} />
      <IntegrationGroup title="Voice" items={voice} />
      <IntegrationGroup title="Telephony" items={telephony} />
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { accentColor, setAccentColor } = useAccentColor();

  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      {/* Theme */}
      <div className="px-5">
        <SectionRow label="Theme" hint="Light, dark, or follow your system.">
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
        </SectionRow>
      </div>

      {/* Accent color */}
      <div className="px-5">
        <SectionRow label="Accent color" hint="Brand color used for buttons and active states.">
          <div className="flex items-center gap-1.5">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                onClick={() => setAccentColor(preset.value)}
                className={cn(
                  "relative flex h-7 w-7 items-center justify-center rounded-full ring-offset-background transition-all",
                  accentColor === preset.value
                    ? "ring-2 ring-offset-2 ring-foreground/40"
                    : "hover:scale-110",
                )}
                style={{ backgroundColor: `hsl(${preset.dot})` }}
              >
                {accentColor === preset.value && (
                  <Check
                    className="h-3.5 w-3.5 drop-shadow"
                    style={{
                      color: preset.value === "amber" ? "hsl(240 6% 10%)" : "hsl(0 0% 98%)",
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        </SectionRow>
      </div>
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
    return <p className="py-6 text-sm text-muted-foreground">Loading options…</p>;
  }

  const model = playgroundDefaults.model ?? data.defaults.model;
  const voiceId = playgroundDefaults.voiceId ?? data.defaults.voiceId ?? data.voices[0]?.id ?? "";
  const scenarioId = playgroundDefaults.scenarioId ?? data.defaults.scenarioId;
  const temperature = playgroundDefaults.temperature ?? data.defaults.temperature;

  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      <div className="px-5">
        <SectionRow label="Default scenario" hint="Pre-selected when you open the Studio.">
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
        </SectionRow>
      </div>
      <div className="px-5">
        <SectionRow label="Default model">
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
        </SectionRow>
      </div>
      <div className="px-5">
        <SectionRow label="Default voice">
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
        </SectionRow>
      </div>
      <div className="px-5">
        <SectionRow
          label={`Temperature · ${temperature.toFixed(2)}`}
          hint="Sampling randomness for new sessions."
        >
          <Slider
            className="w-[15rem]"
            min={0}
            max={1}
            step={0.05}
            value={[temperature]}
            onValueChange={([t]) => setPlaygroundDefaults({ temperature: t })}
          />
        </SectionRow>
      </div>
    </div>
  );
}

function ShortcutsTab() {
  const groups = ["General", "Navigation"] as const;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g}</div>
          <div className="divide-y divide-border rounded-xl border border-border">
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3">
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

function AccountTab({
  user,
}: {
  user?: { name?: string | null; email?: string | null; role?: string | null } | null;
}) {
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  const isAdmin = user?.role === "admin";

  // The current user's workspace + team membership (Better Auth org plugin).
  const { data: membership } = useQuery({
    queryKey: ["my-membership"],
    enabled: !!user?.email,
    queryFn: async () => {
      const [teamsRes, orgsRes] = await Promise.all([
        organization.listUserTeams(),
        organization.list(),
      ]);
      return {
        teams: ((teamsRes.data as { id: string; name: string }[] | null) ?? []),
        orgs: ((orgsRes.data as { id: string; name: string }[] | null) ?? []),
      };
    },
  });

  const org = membership?.orgs?.[0];
  const teams = membership?.teams ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-border p-4">
        <Avatar className="h-11 w-11 rounded-xl">
          <AvatarFallback className="rounded-xl text-base">{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {user?.name && <div className="truncate text-sm font-medium text-foreground">{user.name}</div>}
          <div className="truncate text-xs text-muted-foreground">{user?.email ?? "Not signed in"}</div>
        </div>
        <Badge variant={isAdmin ? "default" : "secondary"} className="shrink-0 capitalize">
          {user?.role ?? "member"}
        </Badge>
      </div>

      {/* Workspace + team membership */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" /> Workspace
        </div>
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Organization</span>
            <span className="font-medium text-foreground">{org?.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Team</span>
            {teams.length ? (
              <div className="flex flex-wrap justify-end gap-1.5">
                {teams.map((t) => (
                  <Badge key={t.id} variant="secondary">
                    {t.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">Not assigned to a team</span>
            )}
          </div>
        </div>
      </div>

      <Button variant="outline" onClick={() => void logout()} className="gap-2">
        <LogOut className="h-4 w-4" />
        Sign out
      </Button>
    </div>
  );
}

function ProjectsTab() {
  const projects = useProjects((s) => s.projects);
  const activeId = useProjects((s) => s.activeId);
  const setActive = useProjects((s) => s.setActive);
  const addProject = useProjects((s) => s.addProject);
  const renameProject = useProjects((s) => s.renameProject);
  const deleteProject = useProjects((s) => s.deleteProject);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const create = () => {
    if (!newName.trim()) return;
    addProject(newName);
    setNewName("");
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };
  const commitEdit = () => {
    if (editingId) renameProject(editingId, editName);
    setEditingId(null);
    setEditName("");
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Projects group your sessions, scenarios, and runs. Switch the active project from the
        sidebar; create, rename, and remove them here.
      </p>

      <div className="divide-y divide-border rounded-xl border border-border">
        {projects.map((p) => {
          const isActive = p.id === activeId;
          const isDefault = p.id === "default";
          const editing = editingId === p.id;
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                <Box className="h-4 w-4" />
              </span>
              {editing ? (
                <Input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={commitEdit}
                  className="h-8 max-w-[18rem]"
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                    {isActive && <Badge variant="secondary">Active</Badge>}
                  </div>
                </div>
              )}

              <div className="ml-auto flex shrink-0 items-center gap-1">
                {!isActive && (
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setActive(p.id)}>
                    Set active
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="Rename"
                  onClick={() => startEdit(p.id, p.name)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-40"
                  title={isDefault ? "The default project can't be deleted" : "Delete"}
                  disabled={isDefault || projects.length <= 1}
                  onClick={() => {
                    if (confirm(`Delete project "${p.name}"?`)) deleteProject(p.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="new-project">New project</Label>
          <Input
            id="new-project"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="e.g. Q3 Payer Pilot"
          />
        </div>
        <Button onClick={create} disabled={!newName.trim()} className="gap-1.5">
          <FolderPlus className="h-4 w-4" /> Create
        </Button>
      </div>
    </div>
  );
}
