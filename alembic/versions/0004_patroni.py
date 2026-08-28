"""connection_profiles: optional Patroni REST API

Revision ID: 9c2d7e1f4a63
Revises: 7a5e0c41d2b8
Create Date: 2026-08-29 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9c2d7e1f4a63"
down_revision: str | None = "7a5e0c41d2b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("connection_profiles") as batch:
        batch.add_column(sa.Column("patroni_url", sa.String(512), nullable=True))
        batch.add_column(sa.Column("patroni_username", sa.String(128), nullable=True))
        batch.add_column(sa.Column("patroni_password_enc", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("connection_profiles") as batch:
        batch.drop_column("patroni_password_enc")
        batch.drop_column("patroni_username")
        batch.drop_column("patroni_url")
