import logging
import secrets

from sqlalchemy import func, select

from pgcontrol.config import get_settings
from pgcontrol.db.models import User
from pgcontrol.db.session import get_sessionmaker
from pgcontrol.security.passwords import hash_password

log = logging.getLogger("pgcontrol")


async def ensure_admin_user() -> None:
    """Create the initial admin account when the user table is empty."""
    async with get_sessionmaker()() as db:
        count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
        if count:
            return
        settings = get_settings()
        password = settings.admin_password or secrets.token_urlsafe(12)
        db.add(User(username="admin", password_hash=hash_password(password), role="admin"))
        await db.commit()
        if settings.admin_password:
            log.info("Created initial admin user 'admin' (password from PGCONTROL_ADMIN_PASSWORD)")
        else:
            log.warning("Created initial admin user 'admin' with generated password: %s", password)
