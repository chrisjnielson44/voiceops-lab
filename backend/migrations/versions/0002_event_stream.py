"""call_runs.event_stream: persist the full agent event stream for replay

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-25

Stores the complete buffered SSE event stream (turns, tools, reasoning, graph,
predictions, audit) as JSONB so a finished call can be replayed in full from
Call History — not just its audit timeline. IF NOT EXISTS keeps it idempotent.
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

UPGRADE = [
    "ALTER TABLE call_runs ADD COLUMN IF NOT EXISTS event_stream JSONB",
]

DOWNGRADE = [
    "ALTER TABLE call_runs DROP COLUMN IF EXISTS event_stream",
]


def upgrade() -> None:
    for stmt in UPGRADE:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE:
        op.execute(stmt)
