import argparse
import asyncio
import getpass
import logging
from pathlib import Path

import uvicorn
from sqlalchemy import select

from pgcontrol.config import get_settings


def serve(args: argparse.Namespace) -> None:
    settings = get_settings()
    uvicorn.run(
        "pgcontrol.main:app",
        host=args.host or settings.host,
        port=args.port or settings.port,
        log_level=settings.log_level,
        reload=args.reload,
        proxy_headers=settings.proxy_headers,
        forwarded_allow_ips=settings.forwarded_allow_ips if settings.proxy_headers else None,
    )


async def _create_user(username: str, role: str, password: str) -> None:
    from pgcontrol.db.migrate import upgrade_to_head
    from pgcontrol.db.models import User
    from pgcontrol.db.session import get_sessionmaker
    from pgcontrol.security.passwords import hash_password

    await asyncio.to_thread(upgrade_to_head)
    async with get_sessionmaker()() as db:
        existing = (await db.execute(select(User).where(User.username == username))).scalar()
        if existing:
            existing.password_hash = hash_password(password)
            existing.role = role
            print(f"Updated user '{username}' (role={role})")
        else:
            db.add(User(username=username, password_hash=hash_password(password), role=role))
            print(f"Created user '{username}' (role={role})")
        await db.commit()


def create_user(args: argparse.Namespace) -> None:
    password = args.password or getpass.getpass("Password: ")
    asyncio.run(_create_user(args.username, args.role, password))


def db_upgrade(args: argparse.Namespace) -> None:
    from pgcontrol.db.migrate import current_revision, upgrade_to_head

    upgrade_to_head()
    print(f"Metadata database is at revision {current_revision()}")


def db_current(args: argparse.Namespace) -> None:
    from pgcontrol.db.migrate import current_revision

    settings = get_settings()
    kind = "SQLite" if settings.uses_sqlite else "PostgreSQL"
    print(f"{kind} metadata database, revision {current_revision() or '(empty)'}")


def db_backup(args: argparse.Namespace) -> None:
    """Consistent online copy of the SQLite metadata DB (for PostgreSQL use pg_dump)."""
    import sqlite3
    import sys
    from datetime import UTC, datetime

    settings = get_settings()
    if not settings.uses_sqlite:
        sys.exit("The metadata database is PostgreSQL; back it up with pg_dump instead.")
    if not settings.database_path.is_file():
        sys.exit(f"No metadata database at {settings.database_path}")
    target = args.path
    if target is None:
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        target = settings.data_dir / "backups" / f"pgcontrol-{stamp}.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(settings.database_path) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    print(f"Backed up {settings.database_path} to {target}")
    if args.keep:
        backups = sorted(target.parent.glob("pgcontrol-*.db"))
        for old in backups[: -args.keep]:
            old.unlink()
            print(f"Removed old backup {old}")


def db_restore(args: argparse.Namespace) -> None:
    """Replace the SQLite metadata DB with a backup file. Stop PgControl first."""
    import sqlite3
    import sys

    settings = get_settings()
    if not settings.uses_sqlite:
        sys.exit("The metadata database is PostgreSQL; restore it with pg_restore/psql instead.")
    if not args.path.is_file():
        sys.exit(f"Backup file {args.path} not found")
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.path) as src, sqlite3.connect(settings.database_path) as dst:
        src.backup(dst)
    print(f"Restored {args.path} into {settings.database_path}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("alembic.runtime.plugins").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(prog="pgcontrol")
    sub = parser.add_subparsers(dest="command", required=True)

    p_serve = sub.add_parser("serve", help="Run the web server")
    p_serve.add_argument("--host")
    p_serve.add_argument("--port", type=int)
    p_serve.add_argument("--reload", action="store_true")
    p_serve.set_defaults(func=serve)

    p_user = sub.add_parser("create-user", help="Create or update a PgControl user")
    p_user.add_argument("username")
    p_user.add_argument("--role", choices=["admin", "operator", "viewer"], default="admin")
    p_user.add_argument("--password")
    p_user.set_defaults(func=create_user)

    p_db = sub.add_parser("db", help="Metadata database maintenance")
    db_sub = p_db.add_subparsers(dest="db_command", required=True)
    db_sub.add_parser("upgrade", help="Apply pending migrations").set_defaults(func=db_upgrade)
    db_sub.add_parser("current", help="Show the migration revision").set_defaults(func=db_current)
    p_backup = db_sub.add_parser("backup", help="Copy the SQLite metadata DB (online-safe)")
    p_backup.add_argument("path", nargs="?", type=Path, help="target file (default: data/backups/)")
    p_backup.add_argument("--keep", type=int, help="delete older backups beyond this many")
    p_backup.set_defaults(func=db_backup)
    p_restore = db_sub.add_parser("restore", help="Replace the SQLite metadata DB from a backup")
    p_restore.add_argument("path", type=Path)
    p_restore.set_defaults(func=db_restore)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
