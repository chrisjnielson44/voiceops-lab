# Deploying VoiceOps Lab

Target: **SPA on Vercel**, **FastAPI + auth-server on Fly.io**, **Neon** for the DB.
The browser only ever talks to the Vercel origin — `web/vercel.json` rewrites
`/api/auth/*` → the auth Fly app and `/api/*` → the backend Fly app, so Better
Auth cookies stay **same-origin** (no cross-domain cookie pain).

```
Vercel (SPA)  ──/api/auth/*──►  voiceops-auth.fly.dev ─┐
   │                                                   ├─► Neon
   └──────────/api/* ─────────►  voiceops-api.fly.dev ─┘
```

## 0. One-time: git remote + secrets

```bash
gh repo create voiceops-lab --private --source=. --remote=origin --push
```

GitHub → **Settings → Environments** → create `production` and `staging`, each with:
`FLY_API_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

## 1. Fly.io (auth + backend)

```bash
# create the apps (prod; repeat with -staging for the staging env)
flyctl apps create voiceops-auth
flyctl apps create voiceops-api

# auth-server secrets
cd auth-server
flyctl secrets set --app voiceops-auth \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  BETTER_AUTH_URL="https://<your-vercel-domain>" \
  DATABASE_URL_UNPOOLED="postgres://...neon..." \
  BETTER_AUTH_TRUSTED_ORIGINS="https://<your-vercel-domain>" \
  AUTH_CORS_ORIGINS="https://<your-vercel-domain>"
flyctl deploy --app voiceops-auth
flyctl ssh console --app voiceops-auth -C "node migrate.mjs"   # once

# backend secrets — validates the session via the auth app over Fly private net
cd ../backend
flyctl secrets set --app voiceops-api \
  DATABASE_URL_UNPOOLED="postgres://...neon..." \
  REQUIRE_AUTH="true" \
  AUTH_SERVER_URL="http://voiceops-auth.internal:3000" \
  CORS_ORIGINS="https://<your-vercel-domain>" \
  LOCAL_LLM_BASE_URL="..." LOCAL_LLM_MODEL="..." LOCAL_LLM_API_KEY="..."
flyctl deploy --app voiceops-api   # release_command runs `alembic upgrade head`
flyctl ssh console --app voiceops-api -C "python scripts/setup_db.py"   # seed once
```

> The local MLX model server isn't reachable from Fly. For the hosted demo, point
> `LOCAL_LLM_*` at a reachable OpenAI-compatible endpoint (or set `OPENROUTER_API_KEY`
> and use a hosted model) so live calls work off your laptop.

## 2. Vercel (SPA)

1. Import the repo, **Root Directory = `web`** (framework auto-detects Vite).
2. Edit `web/vercel.json` rewrite destinations to your real Fly hostnames
   (`voiceops-auth.fly.dev` / `voiceops-api.fly.dev`).
3. Deploy. Copy the production domain into the Fly secrets above
   (`BETTER_AUTH_URL`, `*_ORIGINS`, `CORS_ORIGINS`) and redeploy the Fly apps.

## 3. CI/CD (already wired)

- `.github/workflows/ci.yml` — pytest + web typecheck/build on every push/PR.
- `.github/workflows/deploy.yml` — push to **`main`** → production, **`develop`**
  → staging (Fly apps suffixed `-staging`; Vercel preview vs `--prod`).

## Notes

- Secrets never live in the repo — `.env*` is gitignored; only `.env.example`
  files are committed.
- The backend enforces auth in prod (`REQUIRE_AUTH=true`): it introspects the
  forwarded session cookie against the auth app and 401s without a valid session.
- Auth tables: `npm run migrate` in `auth-server` (idempotent).
