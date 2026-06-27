"use client";

import {
  AudioLines,
  BarChart3,
  Boxes,
  ChevronsUpDown,
  History,
  Home,
  Layers,
  LogOut,
  Monitor,
  Moon,
  Plug,
  Radio,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  User as UserIcon,
  Users,
} from "lucide-react";

import { logout } from "@/lib/auth/client";
import { useSettings } from "@/state/useSettings";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/cn";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { WaveMark } from "@/components/ui/WaveMark";
import { Kbd } from "@/components/ui/kbd";

export type TabId =
  | "home"
  | "simulate"
  | "live"
  | "scenarios"
  | "voices"
  | "models"
  | "analytics"
  | "calls"
  | "logs"
  | "audit"
  | "integrations"
  | "team"
  | "settings";

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

// Flat, stacked nav — no section headers (cleaner, console-style).
const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: <Home className="h-4 w-4" /> },
  { id: "simulate", label: "Simulation", icon: <Sparkles className="h-4 w-4" /> },
  { id: "live", label: "Live", icon: <Radio className="h-4 w-4" /> },
  { id: "scenarios", label: "Scenarios", icon: <Layers className="h-4 w-4" /> },
  { id: "voices", label: "Voices", icon: <AudioLines className="h-4 w-4" /> },
  { id: "models", label: "Models", icon: <Boxes className="h-4 w-4" /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "calls", label: "Call History", icon: <History className="h-4 w-4" /> },
  { id: "logs", label: "Logs", icon: <ScrollText className="h-4 w-4" /> },
  { id: "audit", label: "Audit", icon: <ShieldCheck className="h-4 w-4" /> },
  { id: "integrations", label: "Integrations", icon: <Plug className="h-4 w-4" /> },
  // Admin-only — filtered out for non-admins in the render below.
  { id: "team", label: "Team", icon: <Users className="h-4 w-4" />, adminOnly: true },
];

export function AppSidebar({
  tab,
  onTab,
  userName,
  userEmail,
  isAdmin = false,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  userName?: string;
  userEmail?: string;
  isAdmin?: boolean;
}) {
  const { setOpenMobile, isMobile } = useSidebar();
  const setSettingsTab = useSettings((s) => s.setSettingsTab);
  const setCommandOpen = useSettings((s) => s.setCommandOpen);
  const { theme, setTheme } = useTheme();
  const initial = (userName || userEmail || "?").trim().charAt(0).toUpperCase();

  const openSearch = () => {
    setCommandOpen(true);
    if (isMobile) setOpenMobile(false);
  };

  const go = (id: TabId) => {
    onTab(id);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-2.5 px-1 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="logo-mark relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-primary text-primary-foreground shadow-sm">
            <WaveMark className="h-5 w-5" />
          </span>
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <div className="text-sm font-semibold text-foreground">Voice Labs</div>
          </div>
          <SidebarTrigger className="ml-auto h-7 w-7 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </div>

        {/* Project switcher (console-style) */}
        <ProjectSwitcher />

        {/* OpenAI-style search: opens the ⌘K command palette */}
        <button
          type="button"
          onClick={openSearch}
          aria-label="Search"
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:hover:bg-accent"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="group-data-[collapsible=icon]:hidden">Search</span>
          <Kbd className="ml-auto group-data-[collapsible=icon]:hidden" keys={["⌘", "K"]} />
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={tab === item.id}
                    tooltip={item.label}
                    onClick={() => go(item.id)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton isActive={tab === "settings"} tooltip="Settings" onClick={() => go("settings")}>
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{initial}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    {userName && (
                      <span className="truncate text-sm font-medium text-foreground">{userName}</span>
                    )}
                    <span className="truncate text-[11px] text-muted-foreground">{userEmail}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto h-4 w-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              {/* On mobile the sidebar is a full-width overlay, so a right-side
                  menu would open off-screen — pop it upward and match the
                  trigger width instead. */}
              <DropdownMenuContent
                side={isMobile ? "top" : "right"}
                align="end"
                sideOffset={4}
                className="min-w-[14rem] max-w-[calc(100vw-2rem)] md:w-auto"
              >
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarFallback className="rounded-lg">{initial}</AvatarFallback>
                    </Avatar>
                    <div className="grid min-w-0">
                      {userName && (
                        <span className="truncate text-sm font-medium text-foreground">{userName}</span>
                      )}
                      <span className="truncate text-[11px] font-normal text-muted-foreground">{userEmail}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { setSettingsTab("account"); go("settings"); }}>
                  <UserIcon />
                  Account
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => go("settings")}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Theme toggle — Vercel style inline picker */}
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-sm text-muted-foreground">Theme</span>
                  <div className="flex items-center rounded-md border border-border bg-muted p-0.5 gap-0.5">
                    {([
                      { value: "light", icon: <Sun className="h-3.5 w-3.5" /> },
                      { value: "system", icon: <Monitor className="h-3.5 w-3.5" /> },
                      { value: "dark", icon: <Moon className="h-3.5 w-3.5" /> },
                    ] as const).map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setTheme(o.value)}
                        className={cn(
                          "rounded p-1 transition-colors",
                          theme === o.value
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {o.icon}
                      </button>
                    ))}
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
