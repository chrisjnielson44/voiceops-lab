# VoiceOps Lab

A local-first **healthcare voice-agent operations** platform. Two local models
(an autonomous agent + a payer rep) hold a real, unscripted call; the agent runs
real SQL tools against Neon, a predictor forecasts each turn, everything streams
over SSE and persists, and analytics/benchmarks aggregate real runs.

> Formerly a single Next.js app. Now split into focused services — **fully off
> Next.js**: a Vite SPA, a FastAPI backend, and a tiny Better Auth host.

## Services

| Dir | Stack | Port | Role |
| --- | ----- | ---- | ---- |
| [`web/`](web) | Vite + React + TanStack Router/Query | 5173 | Cockpit SPA (the UI) |
| [`backend/`](backend) | Python + FastAPI | 8000 | Call runtime, SSE stream, analytics, providers, telephony, scenarios |
| [`auth-server/`](auth-server) | Node + Better Auth | 3000 | Hosts `/api/auth/*` (sessions, email/password) on Neon |
| [`agent/`](agent) | Python + LiveKit | — | Deployable voice agent (optional; not wired into the web flow) |

The browser only ever talks to the Vite origin; in dev `web/vite.config.ts`
proxies `/api/auth/*` → the auth server and all other `/api/*` → FastAPI, so
Better Auth cookies stay same-origin. In production, front the built SPA with an
ingress that routes those two prefixes the same way.

```
            ┌──────────── /api/auth/* ─────────────► auth-server :3000 ──┐
browser ──► Vite SPA :5173 ─┤                                            ├─► Neon Postgres
            └──────────── /api/* (everything else) ─► FastAPI :8000 ─────┘
```

## Run it (dev — three processes)

```bash
# 1) Auth host (Better Auth) — once: npm install && npm run migrate
cd auth-server && npm run dev               # :3000

# 2) Backend (real call runtime). Needs Neon creds + a local model server (MLX/Ollama).
cd backend && uv pip install -e ".[dev]" && uvicorn app.main:app --port 8000

# 3) Cockpit SPA
cd web && npm install && npm run dev        # :5173  → open this
```

Local model server (the agent/payer/predictor inference path):

```bash
~/.voiceops-mlx-venv/bin/mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8080
```

## Configuration

Secrets live in the repo-root **`.env.local`** (gitignored): Neon connection
strings, `BETTER_AUTH_SECRET`, and `LOCAL_LLM_*`. The auth server reads it as a
fallback; the backend reads `backend/.env`; the SPA reads `web/.env`. Each
service has its own `.env.example`.

## Verify

- Backend tests: `cd backend && python -m pytest` (28 tests, no external deps).
- UI build: `cd web && npm run build` (typecheck + code-split production bundle).
- Visual: `cd web && npm run shots` (Playwright screenshots → `web/design-preview/`).

See each service's `README.md` for details.
