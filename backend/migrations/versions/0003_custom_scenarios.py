"""custom user-authored scenarios

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-26

Stores user-created scenarios as a full Scenario wire payload (JSONB) plus a few
queryable columns. These are surfaced through the CustomPack and run on the
generic, facts-backed pack seam (no Neon ground-truth tables required).
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

UPGRADE = [
    """CREATE TABLE IF NOT EXISTS custom_scenarios (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  title       TEXT NOT NULL,
  payer       TEXT NOT NULL,
  category    TEXT,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
)""",
    "CREATE INDEX IF NOT EXISTS idx_custom_scenarios_user ON custom_scenarios(user_id)",
]

DOWNGRADE = [
    "DROP TABLE IF EXISTS custom_scenarios",
]


def upgrade() -> None:
    for stmt in UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE:
        op.execute(stmt)
