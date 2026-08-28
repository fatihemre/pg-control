import argparse
import asyncio
import getpass
import logging

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


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
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

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
