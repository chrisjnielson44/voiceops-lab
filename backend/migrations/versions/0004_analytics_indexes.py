"""analytics + per-user scoping indexes

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-26

The analytics aggregates GROUP BY payer/model and the call-history list orders by
started_at, optionally filtered by user_id (non-admins are scoped to their own
runs). The phi.access / tool.call counts filter call_events by type. These
indexes back those access paths. IF NOT EXISTS keeps the migration idempotent
against the existing Neon database.
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

UPGRADE = [
    # Call-history list: per-user scope + most-recent-first ordering.
    "CREATE INDEX IF NOT EXISTS idx_call_runs_user_started ON call_runs(user_id, started_at DESC)",
    # Admin (unscoped) list ordering.
    "CREATE INDEX IF NOT EXISTS idx_call_runs_started ON call_runs(started_at DESC)",
    # Analytics GROUP BY dimensions.
    "CREATE INDEX IF NOT EXISTS idx_call_runs_payer ON call_runs(payer)",
    "CREATE INDEX IF NOT EXISTS idx_call_runs_model ON call_runs(model)",
    # phi.access / tool.call event-type counts.
    "CREATE INDEX IF NOT EXISTS idx_call_events_type ON call_events(type)",
]

DOWNGRADE = [
    "DROP INDEX IF EXISTS idx_call_events_type",
    "DROP INDEX IF EXISTS idx_call_runs_model",
    "DROP INDEX IF EXISTS idx_call_runs_payer",
    "DROP INDEX IF EXISTS idx_call_runs_started",
    "DROP INDEX IF EXISTS idx_call_runs_user_started",
]


def upgrade() -> None:
    for stmt in UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE:
        op.execute(stmt)
