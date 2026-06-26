import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";

import { AppSidebar, type TabId } from "@/components/AppSidebar";
import { TelephonyView } from "@/components/TelephonyView";
import { HomeView } from "@/components/HomeView";
import { ScenariosView } from "@/components/ScenariosView";
import { VoicesView } from "@/components/VoicesView";
import { ModelsView } from "@/components/ModelsView";
import { LogsView } from "@/components/LogsView";
import { TeamView } from "@/components/TeamView";
import { AuthScreen } from "@/components/AuthScreen";
import { CommandPalette } from "@/components/CommandPalette";
import { SettingsView } from "@/components/SettingsView";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { MotionView } from "@/components/ui/motion";
import { useProviderStatus } from "@/state/useProviderStatus";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSession } from "@/lib/auth/client";

// Tabs are real routes; the Home overview is the landing page at "/".
const PATH_BY_TAB: Record<TabId, string> = {
  home: "/",
  simulate: "/simulate",
  live: "/live",
  scenarios: "/scenarios",
  voices: "/voices",
  models: "/models",
  analytics: "/analytics",
  calls: "/calls",
  logs: "/logs",
  integrations: "/integrations",
  team: "/team",
  settings: "/settings",
};

function tabFromPath(pathname: string): TabId {
  if (pathname.startsWith("/live")) return "live";
  // /studio, /playground, /simulator are legacy routes that redirect to /simulate.
  if (pathname.startsWith("/simulate") || pathname.startsWith("/studio") || pathname.startsWith("/playground") || pathname.startsWith("/simulator")) return "simulate";
  if (pathname.startsWith("/scenarios")) return "scenarios";
  if (pathname.startsWith("/voices")) return "voices";
  if (pathname.startsWith("/models")) return "models";
  if (pathname.startsWith("/analytics")) return "analytics";
  if (pathname.startsWith("/calls")) return "calls";
  if (pathname.startsWith("/logs")) return "logs";
  if (pathname.startsWith("/integrations")) return "integrations";
  if (pathname.startsWith("/team")) return "team";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
}

// Dev/preview only: skip the auth gate so the screenshot harness can render
// without a running Better Auth host. Never set in production builds.
const PREVIEW_BYPASS = import.meta.env.VITE_PREVIEW_BYPASS === "1";

function RootShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = tabFromPath(pathname);

  // Global keyboard shortcuts (⌘K, ⌘,, ⇧D, g-then-key navigation).
  useKeyboardShortcuts((path) => navigate({ to: path }));

  // Warm the code-split route chunks once the app is idle so switching pages is
  // instant — no loader flash between the fade-out and the new view.
  useEffect(() => {
    const warm = () => {
      void import("@/components/StudioView");
      void import("@/components/AnalyticsView");
      void import("@/components/CallHistoryView");
    };
    const w = window as typeof window & { requestIdleCallback?: (cb: () => void) => number };
    if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(warm);
    else setTimeout(warm, 400);
  }, []);

  const { data: session, isPending } = useSession();

  // The only auth bypass is the explicit screenshot-harness flag (never set in
  // dev/prod). Real auth is always enforced otherwise — no implicit tailnet
  // auto-login, so sign-out returns to the gate and only provisioned accounts in.
  const previewUser = { name: "Preview", email: "preview@voiceops.local" };
  const user = session?.user ?? (PREVIEW_BYPASS ? previewUser : null);
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  if (isPending && !PREVIEW_BYPASS) {
    return (
      <div role="status" aria-live="polite" className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <SidebarProvider>
      <AppSidebar
        tab={tab}
        onTab={(t) => navigate({ to: PATH_BY_TAB[t] })}
        userName={user.name ?? undefined}
        userEmail={user.email}
        isAdmin={isAdmin}
      />
      <SidebarInset>
        {/* No top bar — search lives in the sidebar (OpenAI-style). A floating
            trigger on mobile opens the off-canvas sidebar. */}
        <SidebarTrigger className="fixed left-3 top-3 z-30 h-9 w-9 rounded-lg border border-border bg-background/80 backdrop-blur md:hidden" />

        {/* Single gentle fade: the outgoing page is removed and the incoming one
            fades up (keyed remount) — no overlap/ghosting, no loader flash.
            Extra top padding below `md` reserves a strip for the floating mobile
            trigger so it never overlaps a page header. */}
        <div className="mx-auto w-full min-w-0 max-w-[1500px] flex-1 px-4 pb-6 pt-16 sm:px-6 md:pt-6 lg:px-8">
          <MotionView key={tab}>
            <Outlet />
          </MotionView>
        </div>
      </SidebarInset>

      {/* Global overlays driven by the settings store. */}
      <CommandPalette navigate={(path) => navigate({ to: path })} isAdmin={isAdmin} />
      <Toaster />
    </SidebarProvider>
  );
}

/* ------------------------------- route tree ------------------------------- */

const rootRoute = createRootRoute({ component: RootShell });

function HomeRoute() {
  const navigate = useNavigate();
  return <HomeView onNavigate={(path) => navigate({ to: path })} />;
}

function IntegrationsRoute() {
  const { data } = useProviderStatus();
  return <TelephonyView providerStatus={data} />;
}

function ScenariosRoute() {
  const navigate = useNavigate();
  return <ScenariosView onNavigate={(path) => navigate({ to: path })} />;
}
function VoicesRoute() {
  const navigate = useNavigate();
  return <VoicesView onNavigate={(path) => navigate({ to: path })} />;
}
function ModelsRoute() {
  const navigate = useNavigate();
  return <ModelsView onNavigate={(path) => navigate({ to: path })} />;
}

// Home is the eager landing. Playground (LiveKit), Analytics (recharts), and
// Call History are code-split so their bundles load only on demand.
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomeRoute });
// Simulation (autonomous agent↔payer LLM) and Live (agent-led role-play: you
// play the payer rep, by text or voice) are now distinct pages. Both mount the
// shared Studio engine via a thin mode-locked wrapper. `?runId=` opens a stored
// session for replay (from Call History).
const simulateLazy = lazyRouteComponent(() => import("@/components/StudioView"), "SimulateView");
const liveLazy = lazyRouteComponent(() => import("@/components/StudioView"), "LiveView");
const validateStudioSearch = (search: Record<string, unknown>): { runId?: string } => ({
  runId: typeof search.runId === "string" ? search.runId : undefined,
});
const simulateRoute = createRoute({ getParentRoute: () => rootRoute, path: "/simulate", component: simulateLazy, validateSearch: validateStudioSearch });
const liveRoute = createRoute({ getParentRoute: () => rootRoute, path: "/live", component: liveLazy, validateSearch: validateStudioSearch });
// Legacy routes redirect to Simulation, preserving any ?runId= deep link.
const legacyRedirect = (search: { runId?: string }) => {
  throw redirect({ to: "/simulate", search });
};
const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: "/studio", validateSearch: validateStudioSearch, beforeLoad: ({ search }) => legacyRedirect(search) });
const playgroundRoute = createRoute({ getParentRoute: () => rootRoute, path: "/playground", beforeLoad: () => legacyRedirect({}) });
const simulatorRoute = createRoute({ getParentRoute: () => rootRoute, path: "/simulator", beforeLoad: () => legacyRedirect({}) });
const scenariosRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scenarios", component: ScenariosRoute });
const voicesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/voices", component: VoicesRoute });
const modelsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/models", component: ModelsRoute });
const logsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/logs", component: LogsView });
const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  component: lazyRouteComponent(() => import("@/components/AnalyticsView"), "AnalyticsView"),
});
const callsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calls",
  component: lazyRouteComponent(() => import("@/components/CallHistoryView"), "CallHistoryView"),
});
const integrationsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/integrations", component: IntegrationsRoute });
const teamRoute = createRoute({ getParentRoute: () => rootRoute, path: "/team", component: TeamView });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsView });

const routeTree = rootRoute.addChildren([
  homeRoute,
  simulateRoute,
  liveRoute,
  studioRoute,
  playgroundRoute,
  simulatorRoute,
  scenariosRoute,
  voicesRoute,
  modelsRoute,
  analyticsRoute,
  callsRoute,
  logsRoute,
  integrationsRoute,
  teamRoute,
  settingsRoute,
]);

function RoutePending() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export const router = createRouter({
  routeTree,
  // Preload route chunks on hover/touch so navigation is instant.
  defaultPreload: "intent",
  defaultPreloadDelay: 30,
  // Only show the loader if a chunk genuinely takes a while — chunks are warmed
  // on idle (see RootShell), so in practice the loader never flashes.
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 400,
  defaultPendingMinMs: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
