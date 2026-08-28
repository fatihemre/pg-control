import logging
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from pgcontrol.api.deps import DB
from pgcontrol.api.schemas import LoginRequest, UserOut
from pgcontrol.config import get_settings
from pgcontrol.db.models import User
from pgcontrol.security.auth import SESSION_COOKIE, CurrentUser, create_session, delete_session
from pgcontrol.security.oidc import OidcClient, OidcError
from pgcontrol.security.passwords import verify_password

log = logging.getLogger("pgcontrol.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])

OIDC_COOKIE = "pgcontrol_oidc"


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )


@router.post("/login", response_model=UserOut)
async def login(body: LoginRequest, db: DB, response: Response):
    user = (
        await db.execute(select(User).where(User.username == body.username))
    ).scalar_one_or_none()
    if (
        user is None
        or user.password_hash is None
        or not verify_password(user.password_hash, body.password)
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    session = await create_session(db, user)
    _set_session_cookie(response, session.token)
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


@router.get("/providers")
async def providers():
    settings = get_settings()
    return {
        "local": True,
        "oidc": {"name": settings.oidc_display_name} if settings.oidc_enabled else None,
    }


# --- OpenID Connect -------------------------------------------------------------------------


def _oidc(request: Request) -> OidcClient:
    client = getattr(request.app.state, "oidc", None)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Single sign-on is not configured")
    return client


def _redirect_uri(request: Request) -> str:
    return get_settings().oidc_redirect_url or str(request.url_for("oidc_callback"))


@router.get("/oidc/login", include_in_schema=False)
async def oidc_login(request: Request):
    client = _oidc(request)
    state, cookie = client.new_state()
    try:
        url = await client.authorization_url(_redirect_uri(request), state)
    except Exception as exc:
        log.warning("OIDC discovery failed: %s", exc)
        return _login_error("The identity provider is unreachable.")
    response = RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        OIDC_COOKIE,
        cookie,
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=get_settings().secure_cookies,
        path="/api/auth/oidc",
    )
    return response


def _login_error(message: str) -> RedirectResponse:
    response = RedirectResponse(f"/login?error={quote(message)}", status_code=status.HTTP_302_FOUND)
    response.delete_cookie(OIDC_COOKIE, path="/api/auth/oidc")
    return response


@router.get("/oidc/callback", include_in_schema=False, name="oidc_callback")
async def oidc_callback(
    request: Request,
    db: DB,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    oidc_cookie: Annotated[str | None, Cookie(alias=OIDC_COOKIE)] = None,
):
    client = _oidc(request)
    if error:
        return _login_error(error_description or error)
    try:
        expected = client.read_state(oidc_cookie)
        if not code or not state or state != expected["state"]:
            raise OidcError("Login state mismatch; start again.")
        tokens = await client.exchange_code(code, _redirect_uri(request), expected["verifier"])
        claims = await client.verify_id_token(tokens["id_token"], expected["nonce"])
        identity = client.identity(claims)
    except OidcError as exc:
        return _login_error(str(exc))
    except Exception as exc:
        log.warning("OIDC login failed: %s", exc)
        return _login_error("Single sign-on failed; try again.")

    user = (
        await db.execute(
            select(User).where(User.auth_provider == "oidc", User.subject == identity.subject)
        )
    ).scalar_one_or_none()
    if user is None:
        if not get_settings().oidc_auto_create:
            return _login_error("No PgControl account is linked to this identity.")
        user = User(
            username=await _unique_username(db, identity.username),
            password_hash=None,
            role=identity.role,
            auth_provider="oidc",
            subject=identity.subject,
        )
        db.add(user)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return _login_error("Could not create the account; try again.")
        log.info("Created OIDC user %r with role %s", user.username, user.role)
    elif user.role != identity.role and get_settings().oidc_role_claim:
        user.role = identity.role  # keep the role in step with the IdP groups
        await db.commit()

    session = await create_session(db, user)
    response = RedirectResponse("/", status_code=status.HTTP_302_FOUND)
    response.delete_cookie(OIDC_COOKIE, path="/api/auth/oidc")
    _set_session_cookie(response, session.token)
    return response


async def _unique_username(db, wanted: str) -> str:
    taken = {
        u
        for (u,) in await db.execute(select(User.username).where(User.username.like(f"{wanted}%")))
    }
    if wanted not in taken:
        return wanted
    n = 2
    while f"{wanted}{n}" in taken:
        n += 1
    return f"{wanted}{n}"
