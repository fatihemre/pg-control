# PgControl

Self-hosted PostgreSQL governance panel (users/roles, permissions, effective privileges, config).
See README.md for setup. Roadmap phases and decisions live in the project memory.

## Conventions
- Backend: Python 3.13, FastAPI, psycopg 3 async for managed instances, SQLAlchemy async + Alembic for the SQLite metadata DB. `uv` for everything (`uv run …`).
- Frontend: Vite + React + TS + Tailwind v4 + TanStack Query/Router in `frontend/`; production build served by FastAPI from `frontend/dist`.
- Ports: 74xx block only (7420 app, 7421 vite, 7414–7418 dev PG 14–18). Never use common defaults.
- Git: short English commit messages, no trailers, local only until a remote is given.
- Every catalog query must work on PostgreSQL 14 through 18 (PG16 changed role inheritance: `pg_auth_members.inherit_option`).
- Never build SQL identifiers by string formatting; use `psycopg.sql.Identifier`.
- Writes to managed instances go through "Plan → SQL preview → Apply" and are recorded in `audit_log`.
- Run `uv run ruff check src tests alembic && uv run pytest` before committing; `npm run build` in `frontend/` must pass.
