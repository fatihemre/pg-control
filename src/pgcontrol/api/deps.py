from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from pgcontrol.db.models import ConnectionProfile
from pgcontrol.db.session import get_db
from pgcontrol.pg.connection import ConnParams, PoolManager
from pgcontrol.security.crypto import SecretBox


def get_secret_box(request: Request) -> SecretBox:
    return request.app.state.secret_box


def get_pool_manager(request: Request) -> PoolManager:
    return request.app.state.pools


async def get_profile(
    profile_id: int, db: Annotated[AsyncSession, Depends(get_db)]
) -> ConnectionProfile:
    profile = await db.get(ConnectionProfile, profile_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return profile


def profile_params(profile: ConnectionProfile, box: SecretBox) -> ConnParams:
    password = box.decrypt(profile.password_enc) if profile.password_enc else None
    return ConnParams.from_profile(profile, password)


DB = Annotated[AsyncSession, Depends(get_db)]
Box = Annotated[SecretBox, Depends(get_secret_box)]
Pools = Annotated[PoolManager, Depends(get_pool_manager)]
Profile = Annotated[ConnectionProfile, Depends(get_profile)]
