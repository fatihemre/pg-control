from pathlib import Path

from alembic.config import Config

from alembic import command
from pgcontrol.config import get_settings

ALEMBIC_DIR = Path(__file__).resolve().parents[3] / "alembic"


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", get_settings().sqlalchemy_url)
    return cfg


def upgrade_to_head() -> None:
    settings = get_settings()
    if settings.uses_sqlite:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(), "head")


def downgrade(revision: str) -> None:
    command.downgrade(alembic_config(), revision)


def current_revision() -> str | None:
    """Revision the metadata database is at (None before the first migration)."""
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy import create_engine

    # psycopg's SQLAlchemy dialect works synchronously too; aiosqlite has no sync twin.
    engine = create_engine(get_settings().sqlalchemy_url.replace("+aiosqlite", ""))
    try:
        with engine.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()
