"""users: optional password, auth provider and subject

Revision ID: 7a5e0c41d2b8
Revises: 3f1c2a9d7b04
Create Date: 2026-08-29 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "7a5e0c41d2b8"
down_revision: str | None = "3f1c2a9d7b04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.alter_column("password_hash", existing_type=sa.String(255), nullable=True)
        batch.add_column(
            sa.Column("auth_provider", sa.String(16), nullable=False, server_default="local")
        )
        batch.add_column(sa.Column("subject", sa.String(255), nullable=True))
        batch.create_unique_constraint("uq_users_provider_subject", ["auth_provider", "subject"])


def downgrade() -> None:
    op.execute("DELETE FROM users WHERE password_hash IS NULL")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_provider_subject", type_="unique")
        batch.drop_column("subject")
        batch.drop_column("auth_provider")
        batch.alter_column("password_hash", existing_type=sa.String(255), nullable=False)
