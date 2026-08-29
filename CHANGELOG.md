# Changelog

All notable changes to PgControl are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/fatihemre/pg-control/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/fatihemre/pg-control/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fatihemre/pg-control/releases/tag/v0.1.0
