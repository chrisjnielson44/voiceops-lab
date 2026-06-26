# VoiceOps Lab — Web (Vite + React + TanStack)

The cockpit UI, migrated off Next.js to a **Vite + React SPA**. It talks to the
**FastAPI backend** (`../backend`) for all app data + the live SSE call stream,
and to the standalone **auth-server** (`../auth-server`) purely as the
**Better Auth** host. Every
component, the iOS-26 liquid-glass design system, and the data contracts are
carried over unchanged — only the entry/shell and data-fetch plumbing changed.

## Why Vite (vs. staying on Next.js)

This is a gated, real-time dashboard with no SEO/SSR needs, so Next's App
Router/RSC/streaming-HTML machinery was dead weight. As a static SPA it ships a
smaller, faster bundle, and:

- **TanStack Router** turns the 4 cockpit tabs into real, deep-linkable routes
  (`/`, `/analytics`, `/benchmarks`, `/telephony`).
- **TanStack Query** caches/dedupes/retries the REST reads (`/api/providers`,
  `/api/analytics`); the SSE call stream stays in the zustand store
  (`EventSource`, `src/state/useCallStore.ts`).
- **Code-splitting**: the recharts-heavy Analytics & Benchmarks views load on
  demand, so the cockpit landing doesn't ship ~440 KB of charting.

## Architecture

```
Browser ─┬─ /api/auth/*  → auth-server (Better Auth, Neon)    ../auth-server (3000)
         ├─ /api/agent/* → FastAPI  (SSE call runtime)        ../backend (8000)
         └─ /api/{analytics,providers,telephony,scenarios} → FastAPI
```

In **dev**, `vite.config.ts` proxies those prefixes (so cookies stay
same-origin — no CORS). In **prod**, front the built SPA with an ingress that
routes `/api/auth` → the auth host and `/api/*` → FastAPI on one origin.

## Run (dev)

Three processes:

```bash
# 1) Auth host (Better Auth) — from ../auth-server
npm run dev                    # auth-server on :3000  (serves /api/auth/*)

# 2) Backend — from ../backend
.venv/bin/uvicorn app.main:app --port 8000

# 3) This SPA
cd web && npm install && npm run dev      # Vite on :5173
```

Open http://localhost:5173 and sign in (Better Auth account, e.g. the
`design-preview@voiceops.local` preview user).

## Scripts

| Command | What |
| ------- | ---- |
| `npm run dev` | Vite dev server (:5173) with the auth/API proxy |
| `npm run build` | `tsc --noEmit` + `vite build` (code-split production bundle) |
| `npm run preview` | Serve the production build (:4173) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run shots` | Playwright screenshots of all tabs × themes → `design-preview/` |

## What changed vs. the Next.js source (everything else is verbatim)

| Next.js | Vite |
| ------- | ---- |
| `src/app/layout.tsx` (Metadata, themeInitScript in `<head>`) | `index.html` (static meta + inline blocking theme script) + `src/main.tsx` |
| `src/app/page.tsx` → `<AppShell/>` (useState tabs) | `src/router.tsx` — TanStack Router root shell + 4 routes |
| `useProviderStatus` (useEffect fetch) | TanStack Query (`useQuery`) |
| `AnalyticsView` live-ops `useEffect` fetch | TanStack Query |
| `lib/voice/types.ts` (had `process.env` `isDemoMode`) | types-only client copy |
| `lib/auth/client.ts` | adds `VITE_AUTH_BASE_URL` for split-origin prod |

Only the **15 client-safe `lib` modules** were copied (the server-only agent
runtime / DB / provider adapters now live in the Python backend).

## Preview bypass

`VITE_PREVIEW_BYPASS=1` skips the auth gate so `npm run shots` can render the
cockpit without a running auth host. **Never set it in a production build.**
