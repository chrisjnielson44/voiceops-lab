# VoiceOps Lab — Auth Server

A tiny standalone **Better Auth** host (Node + `better-auth/node`), replacing the
old Next.js `/api/auth/*` route. Better Auth's *client* runs in the Vite SPA, but
[its docs require a server-side handler](https://www.better-auth.com/docs/installation)
to manage sessions, the database, and secure cookies — this is that server, in
~30 lines, with no Next.js.

- `auth.mjs` — Better Auth config (Neon pg pool, email/password + autoSignIn,
  7-day sessions), ported verbatim from the old `src/lib/auth/auth.ts`. Loads env
  from `./.env` then the repo-root `.env.local`.
- `server.mjs` — Node HTTP server mounting `toNodeHandler(auth)` at `/api/auth/*`
  on port 3000 (+ `/healthz`). CORS is a safety net; in dev the Vite proxy makes
  `/api/auth` same-origin so cookies "just work".
- `migrate.mjs` — creates the `user`/`session`/`account`/`verification` tables.

## Run

```bash
cd auth-server
npm install
cp .env.example .env   # or rely on the repo-root .env.local
npm run migrate        # once, to create auth tables (idempotent)
npm run dev            # http://localhost:3000  (/api/auth/*)
```

The Vite SPA (`../web`) proxies `/api/auth` → `:3000`; the FastAPI backend
(`../backend`) handles everything else. The cockpit gates on a Better Auth
session via `better-auth/react` (`web/src/lib/auth/client.ts`).

For a split-origin production deploy, set `BETTER_AUTH_URL`, `AUTH_CORS_ORIGINS`,
and `BETTER_AUTH_TRUSTED_ORIGINS`, and point the SPA at this origin via
`VITE_AUTH_BASE_URL`.
