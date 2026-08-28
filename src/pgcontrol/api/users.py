"""PgControl account management (admin only) and self-service password change."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from pgcontrol.api.deps import DB
from pgcontrol.db.models import AuditLog, Session, User
from pgcontrol.security.auth import ROLE_RANK, AdminUser, CurrentUser
from pgcontrol.security.passwords import hash_password, verify_password

router = APIRouter(prefix="/api/users", tags=["users"])


class UserAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    auth_provider: str
    subject: str | None
    has_password: bool
    created_at: datetime


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._@-]+$")
    password: str = Field(min_length=8, max_length=256)
    role: str = "viewer"


class UserUpdate(BaseModel):
    role: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


def _out(u: User) -> UserAdminOut:
    return UserAdminOut(
        id=u.id,
        username=u.username,
        role=u.role,
        auth_provider=u.auth_provider,
        subject=u.subject,
        has_password=u.password_hash is not None,
        created_at=u.created_at,
    )


def _check_role(role: str) -> None:
    if role not in ROLE_RANK:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown role")


async def _admins_left(db, excluding: int) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(User).where(User.role == "admin", User.id != excluding)
        )
    ).scalar_one()


@router.get("", response_model=list[UserAdminOut])
async def list_users(db: DB, _: AdminUser):
    rows = (await db.execute(select(User).order_by(User.username))).scalars()
    return [_out(u) for u in rows]


@router.post("", response_model=UserAdminOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DB, _: AdminUser):
    _check_role(body.role)
    user = User(username=body.username, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already exists") from exc
    return _out(user)


@router.put("/{user_id}", response_model=UserAdminOut)
async def update_user(user_id: int, body: UserUpdate, db: DB, admin: AdminUser):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if body.role is not None and body.role != user.role:
        _check_role(body.role)
        if user.role == "admin" and await _admins_left(db, user.id) == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot demote the last admin")
        user.role = body.role
    if body.password is not None:
        if user.auth_provider != "local":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Single sign-on accounts have no local password"
            )
        user.password_hash = hash_password(body.password)
        if user.id != admin.id:  # a reset by an admin ends the user's sessions
            await db.execute(delete(Session).where(Session.user_id == user.id))
    await db.commit()
    return _out(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, db: DB, admin: AdminUser):
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account")
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.role == "admin" and await _admins_left(db, user.id) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot delete the last admin")
    # SQLite does not enforce the FK actions unless foreign_keys is on; do them explicitly.
    await db.execute(delete(Session).where(Session.user_id == user.id))
    await db.execute(update(AuditLog).where(AuditLog.user_id == user.id).values(user_id=None))
    await db.delete(user)
    await db.commit()


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_own_password(body: PasswordChange, db: DB, user: CurrentUser):
    if user.password_hash is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Single sign-on accounts have no local password"
        )
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
