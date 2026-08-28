## What

<!-- What does this change do, and why? Link the issue if there is one. -->

## How was it tested

<!-- e.g. unit tests, manual check against dev PostgreSQL 14–18, screenshots for UI changes -->

## Checklist

- [ ] `uv run ruff check src tests alembic` and `uv run pytest` pass
- [ ] `npm run lint` and `npm run build` pass in `frontend/` (if the UI changed)
- [ ] Catalog queries were checked on PostgreSQL 14 through 18 (if they changed)
- [ ] Writes to managed instances go through Plan → SQL preview → Apply and are audited
- [ ] Docs / `CHANGELOG.md` updated where it matters
