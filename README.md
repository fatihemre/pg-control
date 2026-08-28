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
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL 14–18 + pg16 replica, user postgres/postgres, seeded sample data
uv sync
cp .env.example .env && $EDITOR .env
uv run pgcontrol serve --reload                  # API on :7420
cd frontend && npm install && npm run dev        # UI on :7421, proxies /api to :7420
```

Tests and lint:

```sh
uv run pytest
uv run ruff check src tests alembic
```

Connect PgControl to a dev instance with host `127.0.0.1`, port `7416` (PG 16), user
`postgres`, password `postgres`. The `reservations` database contains the sample roles
(`reservation_api`, `reservation_read`, `reservation_write`, …) used throughout development.

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
```
