# Security policy

PgControl stores credentials for the PostgreSQL instances it manages and can run
privileged operations on them, so we take reports seriously.

## Supported versions

Only the latest release (and `main`) receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Use
[GitHub private vulnerability reporting](https://github.com/fatihemre/pg-control/security/advisories/new)
so the report stays private until a fix is available.

Include what you can: affected version, how to reproduce, impact, and a suggested fix if
you have one. You will get an acknowledgement within a few days and a fix or mitigation
plan as soon as the issue is confirmed. Credit is given in the release notes unless you
prefer otherwise.

## Deployment guidance

- Run PgControl behind an HTTPS reverse proxy and set `PGCONTROL_SECURE_COOKIES=true`
  and `PGCONTROL_PROXY_HEADERS=true`; never expose plain HTTP to the internet.
- Keep `PGCONTROL_SECRET_KEY` secret and backed up — stored PostgreSQL and Patroni
  passwords are encrypted with it.
- Connect managed instances with the least privileged role that still lets PgControl
  read the catalogs; mark instances you only want to inspect as read-only.
- Restrict `operator` / `admin` PgControl accounts to people who may change privileges;
  `viewer` accounts can only read.

See the "Security notes" section of the README for details on hashing, encryption,
sessions and login rate limiting.
