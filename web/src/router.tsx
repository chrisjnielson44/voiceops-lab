import { Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
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
import { AuthScreen } from "@/components/AuthScreen";
import { CommandPalette } from "@/components/CommandPalette";
import { SettingsDialog } from "@/components/SettingsDialog";
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
  studio: "/studio",
  scenarios: "/scenarios",
  voices: "/voices",
  models: "/models",
  analytics: "/analytics",
  calls: "/calls",
  logs: "/logs",
  integrations: "/integrations",
};

function tabFromPath(pathname: string): TabId {
  // /playground and /simulator are legacy aliases of the merged Studio.
  if (pathname.startsWith("/studio") || pathname.startsWith("/playground") || pathname.startsWith("/simulator")) return "studio";
  if (pathname.startsWith("/scenarios")) return "scenarios";
  if (pathname.startsWith("/voices")) return "voices";
  if (pathname.startsWith("/models")) return "models";
  if (pathname.startsWith("/analytics")) return "analytics";
  if (pathname.startsWith("/calls")) return "calls";
  if (pathname.startsWith("/logs")) return "logs";
  if (pathname.startsWith("/integrations")) return "integrations";
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

  const { data: session, isPending } = useSession();

  const tailnetDemo =
    typeof window !== "undefined" && window.location.hostname.endsWith(".ts.net");
  const previewUser = { name: "Preview", email: "preview@voiceops.local" };
  const user =
    session?.user ?? (tailnetDemo || PREVIEW_BYPASS ? previewUser : null);

  if (isPending && !tailnetDemo && !PREVIEW_BYPASS) {
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
      />
      <SidebarInset>
        {/* No top bar — search lives in the sidebar (OpenAI-style). A floating
            trigger on mobile opens the off-canvas sidebar. */}
        <SidebarTrigger className="fixed left-3 top-3 z-30 h-9 w-9 rounded-lg border border-border bg-background/80 backdrop-blur md:hidden" />

        <div className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <MotionView key={tab}>
              <Outlet />
            </MotionView>
          </AnimatePresence>
        </div>
      </SidebarInset>

      {/* Global overlays driven by the settings store. */}
      <CommandPalette navigate={(path) => navigate({ to: path })} />
      <SettingsDialog user={user} />
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
// The merged Studio (live voice + simulate). /playground and /simulator are
// legacy aliases so existing links/shortcuts keep working.
const studioLazy = lazyRouteComponent(() => import("@/components/StudioView"), "StudioView");
// `?runId=` opens a stored/live session for replay (from Call History).
const validateStudioSearch = (search: Record<string, unknown>): { runId?: string } => ({
  runId: typeof search.runId === "string" ? search.runId : undefined,
});
const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: "/studio", component: studioLazy, validateSearch: validateStudioSearch });
const playgroundRoute = createRoute({ getParentRoute: () => rootRoute, path: "/playground", component: studioLazy });
const simulatorRoute = createRoute({ getParentRoute: () => rootRoute, path: "/simulator", component: studioLazy });
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

const routeTree = rootRoute.addChildren([
  homeRoute,
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
  // Show a spinner immediately while a code-split route's chunk loads.
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
