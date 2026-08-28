# Contributing to PgControl

Thanks for taking the time to contribute. Bug reports, documentation fixes, new
catalog views and PostgreSQL-version compatibility fixes are all welcome.

## Ground rules

- **Correctness of effective privileges comes first.** `has_*_privilege()` on the
  managed instance is the ground truth; anything PgControl displays must agree with it.
- **PostgreSQL 14 through 18 are supported.** Every catalog query must run on all of
  them. Watch out for PG 16's role-inheritance change (`pg_auth_members.inherit_option`)
  and for columns that appear or disappear between versions.
- **Never build SQL identifiers by string formatting.** Use `psycopg.sql.Identifier` /
  `psycopg.sql.SQL` and parameters.
- **Writes to managed instances go through Plan → SQL preview → Apply** and are recorded
  in `audit_log`. New change types belong in `pgcontrol.changes`, not in ad-hoc endpoints.
- Keep the UI in English and keep it small: no new UI libraries without a discussion.

## Development setup

```sh
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL 14–18, a pg16 replica and a 2-node Patroni cluster
uv sync
cp .env.example .env                             # set PGCONTROL_SECRET_KEY
uv run pgcontrol serve --reload                  # API on http://127.0.0.1:7420
cd frontend && npm install && npm run dev        # UI on http://127.0.0.1:7421 (proxies /api)
```

The dev instances use `postgres` / `postgres` on ports 7414–7418 and are seeded with the
`reservations` sample (`docker/dev-init/01-seed.sql`). See the README for the full port
table — PgControl only uses ports in the `74xx` range, never common defaults.

## Before you open a pull request

```sh
uv run ruff check src tests alembic
uv run ruff format --check src tests alembic
uv run pytest                                    # add PGCONTROL_TEST_DATABASE_URL=… to also run on PostgreSQL
cd frontend && npm run lint && npm run build
```

`tests/test_catalog_integration.py` runs against the dev containers when they are up and
is skipped otherwise; run it whenever you touch `src/pgcontrol/pg/catalog`.

Metadata-DB schema changes need an Alembic migration:
`uv run alembic revision -m "short description"` → edit `alembic/versions/…` → the app
applies it at startup. Migrations must work on both SQLite and PostgreSQL.

## Pull requests

- One topic per PR; keep refactors separate from behaviour changes.
- Short English commit messages in the imperative ("Add sequence privileges page").
- Add or update tests. UI changes: attach a screenshot.
- Fill in the PR template; CI must be green.

## Reporting bugs and proposing features

Use the issue templates. For anything security-related see [SECURITY.md](SECURITY.md) —
please do not open public issues for vulnerabilities.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
