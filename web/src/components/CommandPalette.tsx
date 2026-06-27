"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AudioLines,
  BarChart3,
  Boxes,
  History,
  Home,
  Layers,
  Mic,
  Moon,
  Plug,
  Radio,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useSettings } from "@/state/useSettings";
import { useTheme } from "@/components/theme/ThemeProvider";

interface ScenarioOpt {
  id: string;
  title: string;
  payer: string;
}

const NAV = [
  { path: "/", label: "Home", icon: <Home /> },
  { path: "/simulate", label: "Simulation", icon: <Sparkles /> },
  { path: "/live", label: "Live", icon: <Radio /> },
  { path: "/scenarios", label: "Scenarios", icon: <Layers /> },
  { path: "/voices", label: "Voices", icon: <AudioLines /> },
  { path: "/models", label: "Models", icon: <Boxes /> },
  { path: "/analytics", label: "Analytics", icon: <BarChart3 /> },
  { path: "/calls", label: "Call History", icon: <History /> },
  { path: "/logs", label: "Logs", icon: <ScrollText /> },
  { path: "/audit", label: "Audit", icon: <ShieldCheck /> },
  { path: "/integrations", label: "Integrations", icon: <Plug /> },
];

const ADMIN_NAV = [{ path: "/team", label: "Team", icon: <Users /> }];

export function CommandPalette({
  navigate,
  isAdmin = false,
}: {
  navigate: (path: string) => void;
  isAdmin?: boolean;
}) {
  const { commandOpen, setCommandOpen, openSettings, setPlaygroundDefaults } = useSettings();
  const { resolvedTheme, setTheme } = useTheme();

  // Scenario quick-pick — only fetched while the palette is open.
  const { data } = useQuery({
    queryKey: ["voice-options-scenarios"],
    enabled: commandOpen,
    queryFn: async () => {
      const r = await fetch("/api/voice/options");
      if (!r.ok) throw new Error(`options ${r.status}`);
      return (await r.json()) as { scenarios: ScenarioOpt[] };
    },
  });

  const run = (fn: () => void) => {
    setCommandOpen(false);
    fn();
  };

  return (
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
      <CommandInput placeholder="Search scenarios, pages, and actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {[...NAV, ...(isAdmin ? ADMIN_NAV : [])].map((n) => (
            <CommandItem key={n.path} value={`go ${n.label}`} onSelect={() => run(() => navigate(n.path))}>
              {n.icon}
              <span>{n.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {data?.scenarios?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Scenarios">
              {data.scenarios.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`scenario ${s.payer} ${s.title}`}
                  onSelect={() =>
                    run(() => {
                      setPlaygroundDefaults({ scenarioId: s.id });
                      navigate("/simulate");
                    })
                  }
                >
                  <Mic />
                  <span>
                    {s.payer} — {s.title}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="open settings" onSelect={() => run(() => openSettings())}>
            <SettingsIcon />
            <span>Open settings</span>
            <CommandShortcut>
              <Kbd keys={["⌘", ","]} />
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            value="toggle theme dark light"
            onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            <span>Toggle {resolvedTheme === "dark" ? "light" : "dark"} mode</span>
            <CommandShortcut>
              <Kbd keys={["⇧", "D"]} />
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
