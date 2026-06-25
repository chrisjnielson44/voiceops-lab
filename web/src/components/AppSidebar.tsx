"use client";

import {
  AudioWaveform,
  Radio,
  BarChart3,
  Mic,
  PhoneCall,
  LogOut,
  Cpu,
  User,
  ChevronsUpDown,
} from "lucide-react";

import type { ProviderStatusResponse } from "@/state/useProviderStatus";
import { signOut } from "@/lib/auth/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
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
import { cn } from "@/lib/cn";

export type TabId = "cockpit" | "analytics" | "voice" | "telephony";

const NAV: { id: TabId; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "cockpit", label: "Cockpit", icon: <Radio className="h-4 w-4" />, hint: "Live call runtime" },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" />, hint: "Operations KPIs" },
  { id: "voice", label: "Voice", icon: <Mic className="h-4 w-4" />, hint: "Live browser voice call" },
  { id: "telephony", label: "Telephony", icon: <PhoneCall className="h-4 w-4" />, hint: "Providers & dialing" },
];

function modelLabel(id?: string): string {
  if (!id) return "local model";
  return (id.split("/").pop() ?? id).replace(/-4bit$/i, "").replace(/-Instruct/i, "");
}

export function AppSidebar({
  tab,
  onTab,
  providerStatus,
  userName,
  userEmail,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  providerStatus: ProviderStatusResponse | null;
  userName?: string;
  userEmail?: string;
}) {
  const { setOpenMobile, isMobile } = useSidebar();
  const llm = providerStatus?.localLLM;
  const online = Boolean(llm?.ok);
  const initial = (userName || userEmail || "?").trim().charAt(0).toUpperCase();

  const go = (id: TabId) => {
    onTab(id);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-primary text-primary-foreground shadow-sm">
            <AudioWaveform className="relative h-5 w-5" />
          </span>
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <div className="text-sm font-semibold text-foreground">Voice Labs</div>
            <div className="text-[11px] text-muted-foreground">Voice-Agent Sandbox</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = tab === item.id;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      onClick={() => go(item.id)}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent>
            <div className="glass-inset flex flex-col gap-2 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "relative flex h-2 w-2",
                  )}
                >
                  {online && (
                    <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-500 opacity-60" />
                  )}
                  <span
                    className={cn(
                      "relative inline-flex h-2 w-2 rounded-full",
                      online ? "bg-emerald-500" : "bg-red-500",
                    )}
                  />
                </span>
                <span className="text-xs font-medium text-foreground">
                  {online ? "Model online" : "Model offline"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Cpu className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{modelLabel(llm?.model)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    providerStatus?.demoMode === false ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                {providerStatus?.demoMode === false ? "Live dialing" : "Demo dialing"}
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent"
                >
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
              <DropdownMenuContent
                side="right"
                align="end"
                className="min-w-[14rem]"
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
                <DropdownMenuItem onSelect={() => signOut()}>
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
