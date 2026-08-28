from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PGCONTROL_", env_file=".env", extra="ignore")

    secret_key: str
    admin_password: str | None = None
    host: str = "127.0.0.1"
    port: int = 7420
    data_dir: Path = Path("./data")
    static_dir: Path | None = None
    session_ttl_hours: int = 12
    secure_cookies: bool = False
    log_level: str = "info"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "pgcontrol.db"

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.database_path}"

    def resolve_static_dir(self) -> Path | None:
        if self.static_dir is not None:
            return self.static_dir if self.static_dir.is_dir() else None
        candidate = Path("frontend/dist")
        return candidate if candidate.is_dir() else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
