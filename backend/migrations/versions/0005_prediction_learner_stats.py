"""persist anticipation learner feedback

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-02

Stores aggregate hit/miss feedback from simulation prefetch outcomes so the
anticipation learner survives backend restarts and improves across runs.
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

UPGRADE = [
    """CREATE TABLE IF NOT EXISTS prediction_learner_stats (
  scenario_id TEXT NOT NULL,
  tool        TEXT NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0,
  misses      INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scenario_id, tool)
)""",
    "CREATE INDEX IF NOT EXISTS idx_prediction_learner_stats_updated ON prediction_learner_stats(updated_at DESC)",
]

DOWNGRADE = [
    "DROP INDEX IF EXISTS idx_prediction_learner_stats_updated",
    "DROP TABLE IF EXISTS prediction_learner_stats",
]


def upgrade() -> None:
    for stmt in UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE:
        op.execute(stmt)
