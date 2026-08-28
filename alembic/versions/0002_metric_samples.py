"""metric samples

Revision ID: 3f1c2a9d7b04
Revises: 94bbc7c51a9e
Create Date: 2026-08-29 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "3f1c2a9d7b04"
down_revision: str | None = "94bbc7c51a9e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "metric_samples",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("connections", sa.Integer(), nullable=False),
        sa.Column("active", sa.Integer(), nullable=False),
        sa.Column("idle_in_transaction", sa.Integer(), nullable=False),
        sa.Column("waiting", sa.Integer(), nullable=False),
        sa.Column("longest_xact_seconds", sa.Float(), nullable=False),
        sa.Column("xact_commit", sa.BigInteger(), nullable=False),
        sa.Column("xact_rollback", sa.BigInteger(), nullable=False),
        sa.Column("blks_hit", sa.BigInteger(), nullable=False),
        sa.Column("blks_read", sa.BigInteger(), nullable=False),
        sa.Column("deadlocks", sa.BigInteger(), nullable=False),
        sa.Column("temp_bytes", sa.BigInteger(), nullable=False),
        sa.Column("db_bytes", sa.BigInteger(), nullable=False),
        sa.Column("wal_bytes", sa.BigInteger(), nullable=False),
        sa.Column("standby_count", sa.Integer(), nullable=False),
        sa.Column("lag_bytes", sa.BigInteger(), nullable=True),
        sa.Column("oldest_xid_age", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["connection_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_metric_samples_profile_time", "metric_samples", ["profile_id", "taken_at"])


def downgrade() -> None:
    op.drop_index("ix_metric_samples_profile_time", table_name="metric_samples")
    op.drop_table("metric_samples")
