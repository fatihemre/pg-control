# Configuration reference

PgControl is configured entirely through environment variables (or a `.env` file in the
working directory). All variables carry the `PGCONTROL_` prefix. Boolean values accept
`true`/`false`, `1`/`0`, `yes`/`no`.

## Core

| Variable | Default | Description |
|---|---|---|
| `PGCONTROL_SECRET_KEY` | *(required)* | Random string (`openssl rand -base64 32`). Derives the AES-256-GCM key that encrypts stored PostgreSQL and Patroni passwords. Losing it means re-entering every password. |
| `PGCONTROL_ADMIN_PASSWORD` | *(empty)* | Password of the initial `admin` account, used only when no users exist yet. If empty, a random password is generated and printed to the log once. |
| `PGCONTROL_HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Listen address. |
| `PGCONTROL_PORT` | `7420` | Listen port. |
| `PGCONTROL_DATA_DIR` | `./data` (`/data` in the image) | Directory for the SQLite metadata database and backups. Keep it on a volume. |
| `PGCONTROL_DATABASE_URL` | *(empty → SQLite)* | `postgresql://user:password@host:5432/pgcontrol` to keep PgControl's own data in PostgreSQL. The schema is created and migrated automatically at startup. |
| `PGCONTROL_STATIC_DIR` | `frontend/dist` if present | Directory with the built UI; the Docker image sets `/app/static`. |
| `PGCONTROL_LOG_LEVEL` | `info` | uvicorn log level (`debug`, `info`, `warning`, `error`). |

## Sessions and login protection

| Variable | Default | Description |
|---|---|---|
| `PGCONTROL_SESSION_TTL_HOURS` | `12` | Lifetime of a login session. Expired sessions are purged on login and at startup. |
| `PGCONTROL_SECURE_COOKIES` | `false` | Send the session cookie with the `Secure` flag. Set to `true` when served over HTTPS. |
| `PGCONTROL_LOGIN_MAX_ATTEMPTS` | `5` | Failed logins allowed per client IP and per username inside the window; `0` disables rate limiting. |
| `PGCONTROL_LOGIN_WINDOW_SECONDS` | `300` | Sliding window for counting failures. |
| `PGCONTROL_LOGIN_LOCKOUT_SECONDS` | `300` | How long further attempts are refused (HTTP 429 with `Retry-After`) after the limit is hit. A `login_locked` audit entry is written. |

## Reverse proxy

| Variable | Default | Description |
|---|---|---|
| `PGCONTROL_PROXY_HEADERS` | `false` | Trust `X-Forwarded-For` / `X-Forwarded-Proto` from the proxy so client IPs (rate limiting, audit) and generated URLs (OIDC callback) are correct. |
| `PGCONTROL_FORWARDED_ALLOW_IPS` | `127.0.0.1` | Comma-separated proxy addresses whose forwarded headers are trusted; `*` trusts any upstream. Only used when `PROXY_HEADERS` is true. |

## Metrics history

| Variable | Default | Description |
|---|---|---|
| `PGCONTROL_METRICS_INTERVAL_SECONDS` | `60` | Seconds between samples of every registered instance (connections, TPS, WAL rate, cache hit, size, replication lag, XID age). `0` disables the sampler. |
| `PGCONTROL_METRICS_RETENTION_HOURS` | `72` | How much history to keep in the metadata database. |

## OpenID Connect single sign-on

SSO is enabled when both `ISSUER` and `CLIENT_ID` are set. The authorization-code flow with
PKCE is used; ID tokens are validated against the provider's JWKS. Register
`https://<host>/api/auth/oidc/callback` as the redirect URI.

| Variable | Default | Description |
|---|---|---|
| `PGCONTROL_OIDC_ISSUER` | *(empty)* | Issuer URL, e.g. `https://login.example.com/realms/main`. Discovery is read from `<issuer>/.well-known/openid-configuration`. |
| `PGCONTROL_OIDC_CLIENT_ID` | *(empty)* | Client id registered at the provider. |
| `PGCONTROL_OIDC_CLIENT_SECRET` | *(empty)* | Client secret for confidential clients; leave empty for public clients. |
| `PGCONTROL_OIDC_SCOPES` | `openid profile email` | Scopes requested. |
| `PGCONTROL_OIDC_DISPLAY_NAME` | `Single sign-on` | Label of the login button ("Continue with …"). |
| `PGCONTROL_OIDC_REDIRECT_URL` | derived from the request | Public callback URL; set it when the proxy hides the external host name. |
| `PGCONTROL_OIDC_USERNAME_CLAIM` | `preferred_username` | ID-token claim used as the PgControl username. |
| `PGCONTROL_OIDC_ROLE_CLAIM` | *(empty)* | Claim (string or list) holding groups/roles, e.g. `groups`. |
| `PGCONTROL_OIDC_ROLE_MAP` | *(empty)* | `idp-group:pgcontrol-role,…` mapping, e.g. `pgcontrol-admins:admin,pgcontrol-operators:operator`. The highest matching role wins. |
| `PGCONTROL_OIDC_DEFAULT_ROLE` | `viewer` | Role for users without a mapped group. Set to an empty value to deny them. |
| `PGCONTROL_OIDC_AUTO_CREATE` | `true` | Create PgControl accounts on first SSO login. When false, only pre-created accounts can sign in. |

## Command-line interface

The image runs `pgcontrol serve`. Other commands (`docker exec pgcontrol /app/.venv/bin/pgcontrol …`
inside the container, `uv run pgcontrol …` from a checkout):

```
pgcontrol serve [--host H] [--port P] [--reload]   run the server
pgcontrol create-user NAME [--role admin|operator|viewer] [--password PW]
                                                   create or update a local account
pgcontrol db upgrade                               apply pending migrations (also done at startup)
pgcontrol db current                               show the migration revision
pgcontrol db backup [FILE] [--keep N]              online-safe copy of the SQLite database
pgcontrol db restore FILE                          replace the SQLite database (stop the server first)
```

With PostgreSQL as the metadata database use `pg_dump` / `pg_restore` instead of
`db backup` / `db restore`.

## Health endpoint

`GET /api/health` returns `{"status": "ok", "version": "…"}` without authentication and
is used by the Docker `HEALTHCHECK`.
