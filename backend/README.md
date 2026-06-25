# VoiceOps Lab — Backend (FastAPI)

A standalone Python service that runs the **real** VoiceOps call runtime,
extracted from the Next.js app. Two local models (agent + payer) converse, the
agent calls real SQL tools against Neon, a predictor model runs each turn, every
event streams over SSE and persists to Postgres, and analytics aggregate live
runs. Nothing is mocked.

This service owns everything **except authentication** — Better Auth stays in the
Next.js app, which authenticates the user and forwards their id to this service
(see [Auth boundary](#auth-boundary)).

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
chain** are byte-compatible with the original Next.js implementation — the
frontend re-verifies the chain client-side and `tests/test_hash.py` asserts
parity against the original `src/lib/hash.ts` output.

## Auth boundary

This service does **not** verify sessions. The Next.js app (Better Auth) is the
gate. After authenticating, it forwards:

- `x-voiceops-user: <user id>` — attributed to persisted runs (defaults to
  `DEMO_USER_ID` when absent).
- `x-internal-token: <secret>` — required only if `BACKEND_INTERNAL_TOKEN` is set.

### Wiring the Next.js frontend to this backend (two options)

1. **Rewrites** — in `next.config.mjs`, proxy `/api/agent/*`, `/api/analytics`,
   `/api/providers`, `/api/llm`, `/api/telephony`, `/api/scenarios` to
   `http://localhost:8000`, and inject the headers in `middleware.ts` after
   reading the Better Auth session.
2. **Fetch proxy** — keep thin Next.js route handlers that call this service
   server-side, attaching the authenticated user id.

Either way, leave `/api/auth/*` in Next.js. (Switching the frontend over is a
follow-up; this service is drop-in compatible with the existing client calls.)

## Tests

```bash
.venv/bin/python -m pytest          # 28 tests, no DB or model server needed
```

The suite stubs the asyncpg pool and the LLM with a scripted fake, so it covers
the full call stream (`start` → `stream` → ordered events → `done`), run control,
hash-chain parity + verification, JSON extraction, tool SQL behavior, provider
routing/fallback, and the read-only endpoints.

## Not ported (by design)

- **Auth** — stays in Next.js / Better Auth.
- **Deterministic demo engine** (`src/lib/simulation/engine.ts`, `buildLedger`) —
  frontend-only replay code; the live backend builds its ledger incrementally.
- **Real telephony/voice dialing** — kept as honored-kill-switch stubs, as today.
