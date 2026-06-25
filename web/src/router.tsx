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
import { CockpitView } from "@/components/CockpitView";
import { TelephonyView } from "@/components/TelephonyView";
import { AuthScreen } from "@/components/AuthScreen";
import { AmbientBackground } from "@/components/AmbientBackground";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { StatusChip } from "@/components/ui/StatusChip";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { MotionView } from "@/components/ui/motion";
import { useProviderStatus } from "@/state/useProviderStatus";
import { useSession } from "@/lib/auth/client";

const TAB_TITLES: Record<TabId, { title: string; subtitle: string }> = {
  cockpit: { title: "Cockpit", subtitle: "Live two-agent call runtime" },
  analytics: { title: "Analytics", subtitle: "Operations KPIs from real runs" },
  benchmarks: { title: "Benchmarks", subtitle: "Model & provider scorecards" },
  telephony: { title: "Telephony", subtitle: "Providers, dialing & integrations" },
};

// Tabs are now real routes; cockpit lives at "/".
const PATH_BY_TAB = {
  cockpit: "/",
  analytics: "/analytics",
  benchmarks: "/benchmarks",
  telephony: "/telephony",
} as const;

function tabFromPath(pathname: string): TabId {
  if (pathname.startsWith("/analytics")) return "analytics";
  if (pathname.startsWith("/benchmarks")) return "benchmarks";
  if (pathname.startsWith("/telephony")) return "telephony";
  return "cockpit";
}

// Dev/preview only: skip the auth gate so the screenshot harness can render the
// cockpit without a running Better Auth host. Never set in production builds.
const PREVIEW_BYPASS = import.meta.env.VITE_PREVIEW_BYPASS === "1";

function RootShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = tabFromPath(pathname);

  const { data: providerStatus } = useProviderStatus();
  const { data: session, isPending } = useSession();

  const tailnetDemo =
    typeof window !== "undefined" && window.location.hostname.endsWith(".ts.net");
  const previewUser = { name: "Preview", email: "preview@voiceops.local" };
  const user =
    session?.user ?? (tailnetDemo || PREVIEW_BYPASS ? previewUser : null);

  if (isPending && !tailnetDemo && !PREVIEW_BYPASS) {
    return (
      <>
        <AmbientBackground />
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-screen items-center justify-center"
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading…</span>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AmbientBackground />
        <AuthScreen />
      </>
    );
  }

  const meta = TAB_TITLES[tab];
  const llm = providerStatus?.localLLM;

  return (
    <>
      <AmbientBackground />
      <SidebarProvider>
        <AppSidebar
          tab={tab}
          onTab={(t) => navigate({ to: PATH_BY_TAB[t] })}
          providerStatus={providerStatus}
          userName={user.name ?? undefined}
          userEmail={user.email}
        />
        <SidebarInset>
          <header className="liquid-glass sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 rounded-none border-x-0 border-t-0 px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">{meta.title}</h1>
              <p className="hidden truncate text-[11px] text-muted-foreground sm:block">{meta.subtitle}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <StatusChip tone={llm?.ok ? "green" : "red"} dot pulse={llm?.ok} className="hidden md:inline-flex">
                {llm?.ok ? "model online" : "model offline"}
              </StatusChip>
              <StatusChip tone="amber" dot className="hidden lg:inline-flex">
                {providerStatus?.demoMode === false ? "live dialing" : "demo dialing"}
              </StatusChip>
              <ThemeToggle />
            </div>
          </header>

          <div className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-4">
            <AnimatePresence mode="wait">
              <MotionView key={tab}>
                <Outlet />
              </MotionView>
            </AnimatePresence>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}

/* ------------------------------- route tree ------------------------------- */

const rootRoute = createRootRoute({ component: RootShell });

function CockpitRoute() {
  const { data } = useProviderStatus();
  return <CockpitView providerStatus={data} />;
}

function TelephonyRoute() {
  const { data } = useProviderStatus();
  return <TelephonyView providerStatus={data} />;
}

// Cockpit (landing) + Telephony are eager; the recharts-heavy Analytics and
// Benchmarks views are code-split so their chart bundle loads only on demand.
const cockpitRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: CockpitRoute });
const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  component: lazyRouteComponent(() => import("@/components/AnalyticsView"), "AnalyticsView"),
});
const benchmarksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/benchmarks",
  component: lazyRouteComponent(() => import("@/components/BenchmarkView"), "BenchmarkView"),
});
const telephonyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/telephony", component: TelephonyRoute });

const routeTree = rootRoute.addChildren([
  cockpitRoute,
  analyticsRoute,
  benchmarksRoute,
  telephonyRoute,
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
  // Show a spinner immediately while a code-split route's chunk loads, instead
  // of a blank frame.
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
