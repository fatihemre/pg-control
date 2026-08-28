from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Response, status
from sqlalchemy import select

from pgcontrol.api.deps import DB
from pgcontrol.api.schemas import LoginRequest, UserOut
from pgcontrol.config import get_settings
from pgcontrol.db.models import User
from pgcontrol.security.auth import SESSION_COOKIE, CurrentUser, create_session, delete_session
from pgcontrol.security.passwords import verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
async def login(body: LoginRequest, db: DB, response: Response):
    user = (
        await db.execute(select(User).where(User.username == body.username))
    ).scalar_one_or_none()
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    settings = get_settings()
    session = await create_session(db, user)
    response.set_cookie(
        SESSION_COOKIE,
        session.token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    db: DB,
    response: Response,
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
):
    if token:
        await delete_session(db, token)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return user
