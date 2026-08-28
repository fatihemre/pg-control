# PgControl

Self-hosted PostgreSQL governance panel (users/roles, permissions, effective privileges,
configuration, performance, cluster/Patroni). Setup and architecture: README.md; rules for
contributors: CONTRIBUTING.md; environment variables: docs/configuration.md.

## Conventions
- Backend: Python 3.13, FastAPI, psycopg 3 async for managed instances, SQLAlchemy async + Alembic for the metadata DB (SQLite default, PostgreSQL optional). `uv` for everything (`uv run …`).
- Frontend: Vite + React + TS + Tailwind v4 + TanStack Query/Router in `frontend/`; production build served by FastAPI from `frontend/dist`.
- Ports: 74xx block only (7420 app, 7421 vite, 7414–7418 dev PG 14–18, 7419 replica, 7431–7434 Patroni). Never use common defaults.
- Git: short English commit messages in the imperative, no trailers.
- Every catalog query must work on PostgreSQL 14 through 18 (PG16 changed role inheritance: `pg_auth_members.inherit_option`).
- Never build SQL identifiers by string formatting; use `psycopg.sql.Identifier`.
- Writes to managed instances go through "Plan → SQL preview → Apply" and are recorded in `audit_log`.
- Before committing: `uv run ruff check src tests alembic && uv run ruff format --check src tests alembic && uv run pytest`; `npm run lint && npm run build` in `frontend/`.
