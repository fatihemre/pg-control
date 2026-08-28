from pathlib import Path

from alembic.config import Config

from alembic import command
from pgcontrol.config import get_settings

ALEMBIC_DIR = Path(__file__).resolve().parents[3] / "alembic"


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    return cfg


def upgrade_to_head() -> None:
    get_settings().data_dir.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(), "head")
