from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Map a user-facing database URL onto the async SQLAlchemy driver PgControl ships.

    ``postgresql://`` / ``postgres://`` → psycopg 3, ``sqlite://`` → aiosqlite. URLs that
    already name a supported async driver are returned unchanged.
    """
    url = url.strip()
    scheme, sep, rest = url.partition("://")
    if not sep:
        raise ValueError("PGCONTROL_DATABASE_URL must look like postgresql://user:pw@host/db")
    scheme = scheme.lower()
    if scheme in ("postgresql", "postgres"):
        return f"postgresql+psycopg://{rest}"
    if scheme == "sqlite":
        return f"sqlite+aiosqlite://{rest}"
    if scheme in ("postgresql+psycopg", "sqlite+aiosqlite"):
        return f"{scheme}://{rest}"
    raise ValueError(f"Unsupported metadata database URL scheme {scheme!r}")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PGCONTROL_", env_file=".env", extra="ignore")

    secret_key: str
    admin_password: str | None = None
    host: str = "127.0.0.1"
    port: int = 7420
    data_dir: Path = Path("./data")
    # Metadata database. Default: SQLite file in data_dir; set a postgresql:// URL to keep
    # PgControl's own data (users, profiles, audit log, metrics) in PostgreSQL instead.
    database_url: str | None = None
    static_dir: Path | None = None
    session_ttl_hours: int = 12
    secure_cookies: bool = False  # set when served over HTTPS
    # Trust X-Forwarded-For / X-Forwarded-Proto from these proxies ("*" = any) so client
    # IPs (used for login rate limiting) and redirect URLs are right behind a reverse proxy.
    proxy_headers: bool = False
    forwarded_allow_ips: str = "127.0.0.1"
    # Login brute-force protection: after max_attempts failures per client IP or username
    # within window seconds, further attempts are refused for lockout seconds (0 disables).
    login_max_attempts: int = 5
    login_window_seconds: int = 300
    login_lockout_seconds: int = 300
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
    def sqlalchemy_url(self) -> str:
        if self.database_url and self.database_url.strip():
            return normalize_database_url(self.database_url)
        return f"sqlite+aiosqlite:///{self.database_path}"

    @property
    def uses_sqlite(self) -> bool:
        return self.sqlalchemy_url.startswith("sqlite")

    def resolve_static_dir(self) -> Path | None:
        if self.static_dir is not None:
            return self.static_dir if self.static_dir.is_dir() else None
        candidate = Path("frontend/dist")
        return candidate if candidate.is_dir() else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
