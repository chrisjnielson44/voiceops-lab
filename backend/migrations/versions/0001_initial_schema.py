"""initial schema: payer ground-truth + call persistence tables

Revision ID: 0001
Revises:
Create Date: 2026-06-24

Uses IF NOT EXISTS so it is a safe no-op against the existing Neon database
(which was first created by the legacy scripts/setup-db.mjs); on a fresh DB it
creates everything. This migration is the canonical schema source of truth.
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# One statement per entry — asyncpg's protocol rejects multiple commands in a
# single execute. IF NOT EXISTS keeps this idempotent against the existing DB.
UPGRADE = [
    """CREATE TABLE IF NOT EXISTS members (
  member_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  dob           DATE NOT NULL,
  payer         TEXT NOT NULL,
  payer_id      TEXT NOT NULL,
  plan_type     TEXT,
  group_number  TEXT
)""",
    """CREATE TABLE IF NOT EXISTS coverage (
  member_id        TEXT PRIMARY KEY REFERENCES members(member_id),
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  effective_date   DATE,
  copay_pcp        NUMERIC(8,2),
  copay_spec       NUMERIC(8,2),
  deductible_total NUMERIC(10,2),
  deductible_met   NUMERIC(10,2),
  oop_max          NUMERIC(10,2),
  oop_met          NUMERIC(10,2)
)""",
    """CREATE TABLE IF NOT EXISTS claims (
  claim_id              TEXT PRIMARY KEY,
  member_id             TEXT REFERENCES members(member_id),
  dos                   DATE,
  billed_amount         NUMERIC(10,2),
  cpt                   TEXT,
  status                TEXT,
  carc_code             TEXT,
  denial_reason         TEXT,
  resubmission_path     TEXT,
  timely_filing_deadline DATE
)""",
    """CREATE TABLE IF NOT EXISTS prior_auths (
  auth_id                 TEXT PRIMARY KEY,
  member_id               TEXT REFERENCES members(member_id),
  cpt                     TEXT,
  status                  TEXT,
  clinical_criteria_unmet TEXT,
  reviewer                TEXT,
  determination           TEXT
)""",
    """CREATE TABLE IF NOT EXISTS call_runs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  scenario_id     TEXT,
  payer           TEXT,
  model           TEXT,
  status          TEXT,
  outcome         TEXT,
  completion_prob NUMERIC(5,4),
  escalation_risk NUMERIC(5,4),
  started_at      TIMESTAMPTZ DEFAULT now(),
  ended_at        TIMESTAMPTZ
)""",
    """CREATE TABLE IF NOT EXISTS call_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      TEXT REFERENCES call_runs(id) ON DELETE CASCADE,
  seq         INT,
  type        TEXT,
  at_ms       BIGINT,
  actor       TEXT,
  summary     TEXT,
  model       TEXT,
  tool        TEXT,
  phi         BOOLEAN DEFAULT FALSE,
  phi_scope   TEXT,
  redaction   TEXT,
  hash        TEXT,
  prev_hash   TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
)""",
    "CREATE INDEX IF NOT EXISTS idx_call_events_run ON call_events(run_id, seq)",
]

DOWNGRADE = [
    "DROP TABLE IF EXISTS call_events",
    "DROP TABLE IF EXISTS call_runs",
    "DROP TABLE IF EXISTS prior_auths",
    "DROP TABLE IF EXISTS claims",
    "DROP TABLE IF EXISTS coverage",
    "DROP TABLE IF EXISTS members",
]


def upgrade() -> None:
    for stmt in UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE:
        op.execute(stmt)
