# VoiceOps Lab — Backend (FastAPI)

A standalone Python service that runs the **real** VoiceOps call runtime,
extracted from the Next.js app. Two local models (agent + payer) converse, the
agent calls real SQL tools against Neon, a predictor model runs each turn, every
event streams over SSE and persists to Postgres, and analytics aggregate live
runs. Nothing is mocked.

This service owns everything **except authentication** — Better Auth runs in the
standalone auth-server (`../auth-server`), which authenticates the user; this
service validates the forwarded session cookie against it (see
[Auth boundary](#auth-boundary)).

## Layout

```
app/
  main.py            FastAPI app, CORS, asyncpg lifespan, router mounting
  config.py          env-driven settings (pydantic-settings)
  db.py              asyncpg pool + query()/query_one()
  core/              hash.py (cyrb53 chain, exact JS port) · format.py
  schemas/           pydantic wire models (camelCase JSON)
  llm/local_llm.py   OpenAI-compatible client for the local model server
  agent/             tools · personas · run_store · orchestrator (the live loop)
  providers/         registry + demo/mlx/openrouter adapters + router
  voice/             elevenlabs/livekit/twilio status adapters (demo kill-switch)
  simulation/        scenario library
  routers/           /api/agent/* · /api/analytics · /api/providers · /api/llm
                     · /api/telephony · /api/scenarios · /healthz
migrations/          Alembic — schema source of truth (0001 = initial schema)
scripts/setup_db.py  seeds the demo payer data (schema comes from Alembic)
tests/               pytest suite (runs with no external services)
```

## Quick start

```bash
cd backend
uv venv && uv pip install -e ".[dev]"      # or: python -m venv .venv && pip install -e ".[dev]"
cp .env.example .env                        # fill in DATABASE_URL_UNPOOLED + LOCAL_LLM_*

# one-time DB setup: schema via Alembic, then seed the demo payer data
.venv/bin/alembic upgrade head
.venv/bin/python scripts/setup_db.py

# start a local model server (MLX preferred), then run the API
~/.voiceops-mlx-venv/bin/mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8080
.venv/bin/uvicorn app.main:app --reload --port 8000
```

## Train Anticipation From Local Sims

The anticipation learner is trained by running real local-model simulations and
persisting prefetch hit/miss feedback into Postgres. This is online ranking
training for anticipation priors, not fine-tuning the LLM weights.

```bash
cd backend
.venv/bin/alembic upgrade head

# In another shell, keep a local OpenAI-compatible model server running.
~/.voiceops-mlx-venv/bin/mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8080

# Run training sims. Repeat --scenario to focus training on a subset.
.venv/bin/python scripts/train_anticipation.py --runs 12 --model mlx-community/Qwen2.5-7B-Instruct-4bit
.venv/bin/python scripts/train_anticipation.py --runs 8 --scenario elig-aetna --scenario claim-uhc
```

The script reports learner stats before/after plus each run's prediction hit,
miss, saved-ms, and wasted-prefetch counts.

Open **http://localhost:8000/docs** for the OpenAPI explorer.

## Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/api/agent/start` | Create a run, fire the orchestrator, return `runId` |
| GET  | `/api/agent/stream?runId=` | SSE: replay + live `AgentEvent` stream |
| POST | `/api/agent/control` | `pause` / `resume` / `stop` a run |
| GET  | `/api/analytics` | Aggregated metrics from persisted runs |
| GET  | `/api/providers` | Local-LLM health + LLM/voice/telephony status |
| POST | `/api/llm` | Model-agnostic chat routing (falls back to demo engine) |
| POST | `/api/telephony` | Place call (honors demo kill-switch — never dials in demo) |
| GET  | `/api/scenarios` · `/api/scenarios/{id}` | Scenario catalog (backend = source of truth) |
| GET  | `/healthz` · `/readyz` | Liveness / dependency health |

The SSE event shapes, JSON keys (camelCase), DB schema, and the **audit hash
chain** are byte-compatible with the original Next.js implementation (this
runtime was ported from it) — the frontend re-verifies the chain client-side and
`tests/test_hash.py` asserts parity against the original `src/lib/hash.ts` output.

## Auth boundary

Authentication lives in the standalone **Better Auth server** (`../auth-server`),
not in this service. The browser authenticates there (`/api/auth/*`), and this
backend **validates** the caller by introspecting the forwarded session cookie
against `AUTH_SERVER_URL`'s `/api/auth/get-session` — it does not blindly trust a
client-supplied header (see `app/routers/_deps.py`).

- App data/action routes depend on `require_user`: with `REQUIRE_AUTH=true`
  (production) an unauthenticated request 401s; with `REQUIRE_AUTH=false`
  (local/dev/tests) it falls back to an optional `x-voiceops-user` hint or
  `DEMO_USER_ID`, attributed to persisted runs.
- Health checks (`/healthz`, `/readyz`) stay public.
- `x-internal-token: <secret>` is an optional extra shared-secret gate, enforced
  only when `BACKEND_INTERNAL_TOKEN` is set.

In dev the web SPA's Vite proxy routes `/api/auth/*` → the auth-server and the
rest of `/api/*` → this backend on one origin, so session cookies flow through.

## Tests

```bash
.venv/bin/python -m pytest          # 28 tests, no DB or model server needed
```

The suite stubs the asyncpg pool and the LLM with a scripted fake, so it covers
the full call stream (`start` → `stream` → ordered events → `done`), run control,
hash-chain parity + verification, JSON extraction, tool SQL behavior, provider
routing/fallback, and the read-only endpoints.

## Not ported (by design)

- **Auth** — runs in the standalone auth-server (`../auth-server`, Better Auth).
- **Deterministic demo engine** (`src/lib/simulation/engine.ts`, `buildLedger`) —
  frontend-only replay code; the live backend builds its ledger incrementally.
- **Real telephony/voice dialing** — kept as honored-kill-switch stubs, as today.
