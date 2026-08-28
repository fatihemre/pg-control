# PgControl

Self-hosted governance panel for PostgreSQL. Not a query tool — PgControl answers
questions like *"why can't `reservation_api` insert into `sch_reservation.reservations`?"*
by showing the full chain: role membership → inherited privileges → schema → object → **final access**.

Scope: users & roles, permissions, effective privileges, server configuration,
extensions, performance views, cluster overview with health checks and metric trends,
replication (standbys, slots, publications/subscriptions).

## Run (Docker)

```sh
cp .env.example .env            # set PGCONTROL_SECRET_KEY (openssl rand -base64 32)
docker compose up -d --build
open http://localhost:7420      # user: admin — password from PGCONTROL_ADMIN_PASSWORD or the container log
```

PgControl keeps its own metadata (users, connection profiles, audit log) in a SQLite
database under the `/data` volume. Stored PostgreSQL passwords are encrypted with
AES-256-GCM using a key derived from `PGCONTROL_SECRET_KEY` — losing that key means
re-entering every password.

## Ports

PgControl uses the `74xx` range to avoid clashing with common defaults:

| Port | Service |
|------|---------|
| 7420 | PgControl UI + API |
| 7421 | Vite dev server (development only) |
| 7414–7418 | Development PostgreSQL 14–18 (`docker-compose.dev.yml`) |
| 7419 | Development streaming replica of PG 16 (`pg16-replica`) |
| 7431–7432 | Development Patroni REST API (`patroni1`, `patroni2`) |
| 7433–7434 | Development Patroni PostgreSQL 16 nodes (`patroni1`, `patroni2`) |

## Metadata database

PgControl keeps its own data (accounts, connection profiles, audit log, metric history)
separate from the instances it manages. By default that is a SQLite file in
`PGCONTROL_DATA_DIR` (`/data` in the container — keep it on a volume). Set
`PGCONTROL_DATABASE_URL=postgresql://user:password@host:5432/pgcontrol` to use a
PostgreSQL database instead; the schema is created and migrated automatically at startup.

```sh
pgcontrol db current                 # show the migration revision
pgcontrol db upgrade                 # apply pending migrations (also done at startup)
pgcontrol db backup [FILE] [--keep N]  # online-safe copy of the SQLite file (default: data/backups/)
pgcontrol db restore FILE            # replace the SQLite file with a backup (stop PgControl first)
```

In Docker: `docker exec pgcontrol /app/.venv/bin/pgcontrol db backup`. With PostgreSQL as
the metadata database use `pg_dump` / `pg_restore` as usual.

## Metrics history

A background task samples every registered instance (connections, transaction and WAL
rates, cache hit, database size, replication lag, XID age) and keeps the history in the
metadata database. Tune with `PGCONTROL_METRICS_INTERVAL_SECONDS` (default 60, `0`
disables) and `PGCONTROL_METRICS_RETENTION_HOURS` (default 72).

## PgControl accounts

Administration → Users lets an admin create local accounts, change roles (`viewer`,
`operator`, `admin`), reset passwords and delete accounts; the last admin cannot be
demoted or removed. Every user can change their own password from the sidebar. Single
sign-on accounts have no local password and keep the role mapped from the identity
provider.

## Patroni

Tick "Managed by Patroni" on a connection and enter the REST API URL of any node
(e.g. `http://patroni1:8008`) plus the `restapi.authentication` credentials if the
cluster requires them. Cluster → Patroni then shows the members (role, state, timeline,
replication lag, tags, pending restarts), the timeline history and the DCS configuration,
and offers switchover (immediate or scheduled), failover, pause/resume, and per-member
reload, restart, and reinitialize. Every operation is confirmed in the UI, sent to the
node addresses Patroni itself reports, and recorded in the audit log as `patroni` /
`patroni_failed`. Read-only connections and viewer accounts can only look.

## Security notes

- Passwords are hashed with Argon2id; connection and Patroni passwords are encrypted with
  `PGCONTROL_SECRET_KEY` (losing the key means re-entering them).
- Login is rate limited: after `PGCONTROL_LOGIN_MAX_ATTEMPTS` (5) failures for a client IP
  or a username within `PGCONTROL_LOGIN_WINDOW_SECONDS` (300), further attempts are refused
  for `PGCONTROL_LOGIN_LOCKOUT_SECONDS` (300) and a `login_locked` audit entry is written.
  Set the attempts to `0` to disable.
- Sessions are HttpOnly, SameSite=Lax cookies that expire after `PGCONTROL_SESSION_TTL_HOURS`
  (12). Cross-site requests are rejected, responses carry `X-Frame-Options`, a strict
  `Content-Security-Policy` and `Cache-Control: no-store` on the API.
- Roles: `viewer` reads everything, `operator` may apply changes and run Patroni
  operations, `admin` also manages PgControl accounts.

## Running behind a reverse proxy (HTTPS)

Terminate TLS in your proxy (Caddy, nginx, Traefik, …) and forward to port 7420, then set

```sh
PGCONTROL_SECURE_COOKIES=true     # cookies only over HTTPS
PGCONTROL_PROXY_HEADERS=true      # trust X-Forwarded-For / X-Forwarded-Proto …
PGCONTROL_FORWARDED_ALLOW_IPS=*   # … from these proxy addresses ("*" = any)
```

`PROXY_HEADERS` makes login rate limiting see the real client address and lets the OIDC
callback URL be derived correctly. Without a proxy PgControl serves plain HTTP; do not
expose it to the internet like that.

## Single sign-on (OpenID Connect)

Set `PGCONTROL_OIDC_ISSUER` and `PGCONTROL_OIDC_CLIENT_ID` (plus `_CLIENT_SECRET` for
confidential clients) and the login page offers "Continue with …". The authorization
code flow with PKCE is used; ID tokens are verified against the provider's JWKS. Users
are created on first login (`PGCONTROL_OIDC_AUTO_CREATE`) and their PgControl role comes
from `PGCONTROL_OIDC_ROLE_CLAIM` + `PGCONTROL_OIDC_ROLE_MAP`
(e.g. `groups` and `pgcontrol-admins:admin,pgcontrol-operators:operator`), falling back
to `PGCONTROL_OIDC_DEFAULT_ROLE`. Register `https://<host>/api/auth/oidc/callback` as
the redirect URI (`PGCONTROL_OIDC_REDIRECT_URL` when running behind a proxy). Local
accounts keep working alongside SSO.

## Development

```sh
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL 14–18 + pg16 replica + 2-node Patroni cluster, user postgres/postgres, seeded sample data
uv sync
cp .env.example .env && $EDITOR .env
uv run pgcontrol serve --reload                  # API on :7420
cd frontend && npm install && npm run dev        # UI on :7421, proxies /api to :7420
```

Tests and lint:

```sh
uv run pytest
uv run ruff check src tests alembic
cd frontend && npm run lint && npm run build
```

`PGCONTROL_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:7416/pgcontrol_test uv run pytest`
runs the same suite with PostgreSQL as the metadata database (the database is created and
wiped for each run).

Connect PgControl to a dev instance with host `127.0.0.1`, port `7416` (PG 16), user
`postgres`, password `postgres`. The `reservations` database contains the sample roles
(`reservation_api`, `reservation_read`, `reservation_write`, …) used throughout development.

The Patroni cluster (`patroni1`, `patroni2`, etcd) exposes PostgreSQL on `7433`/`7434` and
its REST API on `http://127.0.0.1:7431` / `7432`, REST credentials `patroni` / `patroni`.

## Layout

```
src/pgcontrol/      FastAPI application
  api/              HTTP routers and schemas
  db/               metadata DB (SQLAlchemy models, Alembic runner)
  pg/               connections to managed PostgreSQL instances (psycopg 3)
  security/         password hashing, secret encryption, sessions
alembic/            metadata DB migrations
frontend/           Vite + React + TypeScript UI
docker/dev-init/    sample data for the dev PostgreSQL instances
docker/dev-patroni/ image and config for the dev Patroni cluster
```
