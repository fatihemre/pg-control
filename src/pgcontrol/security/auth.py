import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from pgcontrol.config import get_settings
from pgcontrol.db.models import Session, User
from pgcontrol.db.session import get_db

SESSION_COOKIE = "pgcontrol_session"

ROLE_RANK = {"viewer": 0, "operator": 1, "admin": 2}


async def create_session(db: AsyncSession, user: User) -> Session:
    settings = get_settings()
    session = Session(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    await db.commit()
    return session


async def delete_session(db: AsyncSession, token: str) -> None:
    await db.execute(delete(Session).where(Session.token == token))
    await db.commit()


async def purge_expired_sessions(db: AsyncSession) -> int:
    result = await db.execute(delete(Session).where(Session.expires_at < datetime.now(UTC)))
    await db.commit()
    return result.rowcount or 0


async def current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    row = (
        await db.execute(
            select(Session, User)
            .join(User, User.id == Session.user_id)
            .where(Session.token == token)
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    session, user = row
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        await delete_session(db, token)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    return user


def require_role(minimum: str):
    async def dependency(user: Annotated[User, Depends(current_user)]) -> User:
        if ROLE_RANK.get(user.role, -1) < ROLE_RANK[minimum]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires {minimum} role")
        return user

    return dependency


CurrentUser = Annotated[User, Depends(current_user)]
OperatorUser = Annotated[User, Depends(require_role("operator"))]
AdminUser = Annotated[User, Depends(require_role("admin"))]
