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
    metrics_interval_seconds: int = 60  # 0 disables the background sampler
    metrics_retention_hours: int = 72

    # OpenID Connect single sign-on (optional; enabled when issuer and client_id are set)
    oidc_issuer: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_scopes: str = "openid profile email"
    oidc_display_name: str = "Single sign-on"
    oidc_redirect_url: str | None = None  # public callback URL when behind a proxy
    oidc_username_claim: str = "preferred_username"
    oidc_role_claim: str | None = None  # claim holding groups/roles (string or list)
    oidc_role_map: str = ""  # "idp-group:admin,other-group:operator"
    oidc_default_role: str | None = "viewer"  # None = users without a mapped role are denied
    oidc_auto_create: bool = True

    @property
    def oidc_enabled(self) -> bool:
        return bool(self.oidc_issuer and self.oidc_client_id)

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
