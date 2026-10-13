# Changelog

All notable changes to PgControl are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-13

### Added

- Activity groups sessions by `user@database` with a session count and per-state badges;
  click a group to expand it. Untick "Group by user" for the flat list.
- A 404 page for unknown URLs (replaces the old "Coming soon" placeholder).

### Changed

- Role detail pages moved from `/roles/<name>` to `/role/<name>`, so roles named
  `memberships` or `attributes` open correctly.
- The audit log shows every entry by default, including sign-in lockouts; the
  instance filter appears only when an instance is selected.
- The permissions editor applies a changed WITH GRANT OPTION to privileges the role
  already has, and says "No changes" instead of closing silently.
- An expired or revoked session sends the browser to the login page.
- `/api/health` reports the installed package version.
- Release images: `latest` moves only on stable version tags; manual runs push a
  `sha-<commit>` tag. The image pins uv and gives the health check a start period.

### Fixed

- Two admins demoting each other at the same time could leave no admin.
- Login response time no longer reveals whether a username exists.
- The login rate limiter no longer grows without bound.
- Connection pools open without a global lock; editing a profile while it connects
  no longer keeps the old pool.
- Passwords are redacted in every libpq connection string form (Patroni / replication
  views).
- "Test connection" while editing tests the edited settings, not the saved ones.
- An empty connection limit field keeps the current limit instead of sending 0.
- Deleting an instance keeps its audit entries.
- PG16+: memberships and subscriptions appear once even with several grantors / parallel
  apply workers; `pg_hba` rules are listed in match order.
- INHERIT/SET membership options are rejected before PostgreSQL 16 instead of being
  ignored.
- Effective privileges explain access the database owner gets through
  `pg_database_owner`.
- Statements explain an outdated `pg_stat_statements` extension instead of failing.
- Validation errors are shown as readable field messages; role search matches
  memberships case-insensitively; Patroni refresh errors are shown above the last known
  state; editing your own admin role asks for confirmation.

## [0.2.0] - 2026-08-29

### Changed

- License changed from MIT to GNU AGPL-3.0-or-later. Nothing changes for people who run
  PgControl, modified or not, for themselves; distributing a modified version or offering
  one to others over a network now requires sharing the modifications under the same
  license. Version 0.1.0 remains available under the MIT license. Contributions require a
  DCO sign-off (see `CONTRIBUTING.md`).

## [0.1.0] - 2026-08-29

First public release.

### Added

- Connection profiles for any number of PostgreSQL 14–18 instances, with encrypted
  passwords and optional read-only flag.
- Users & roles: role list, role detail, memberships (PG 16 `INHERIT`/`SET` aware),
  role attributes.
- Effective privileges: why a role can or cannot access a database, schema, table,
  sequence or function, shown as the full inheritance chain with `has_*_privilege()` as
  ground truth.
- Permissions editors for database, schema, table/view, sequence and function
  privileges, schema-wide grants and default privileges — every change goes through
  Plan → SQL preview → Apply and is written to the audit log.
- Security views: ownership, grants overview, audit log.
- Configuration: server settings, role/database overrides, `pg_hba.conf`, extensions
  (install / drop / update).
- Performance: activity, `pg_stat_statements`, table and database statistics.
- Cluster: overview with health checks and metric trends (background sampler),
  replication (standbys, WAL receiver, slots, publications/subscriptions), and
  Patroni integration (members, history, DCS config, switchover, failover, pause,
  restart, reinitialize, reload).
- PgControl accounts with `viewer` / `operator` / `admin` roles, an admin Users page,
  OpenID Connect single sign-on with group-to-role mapping.
- Metadata database in SQLite (default) or PostgreSQL (`PGCONTROL_DATABASE_URL`),
  `pgcontrol db upgrade | current | backup | restore` CLI.
- Login rate limiting, security headers, reverse-proxy support, single Docker image.

[Unreleased]: https://github.com/fatihemre/pg-control/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/fatihemre/pg-control/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fatihemre/pg-control/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fatihemre/pg-control/releases/tag/v0.1.0
