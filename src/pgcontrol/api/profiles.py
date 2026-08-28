from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from pgcontrol.api.deps import DB, Box, Pools, Profile, profile_params
from pgcontrol.api.schemas import (
    ProfileCreate,
    ProfileOut,
    ProfileTestRequest,
    ProfileUpdate,
    ServerInfoOut,
)
from pgcontrol.db.models import ConnectionProfile
from pgcontrol.pg.connection import ConnectionError_, ConnParams, test_connection
from pgcontrol.security.auth import AdminUser, CurrentUser

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


def _out(profile: ConnectionProfile) -> ProfileOut:
    data = {c.name: getattr(profile, c.name) for c in ConnectionProfile.__table__.columns}
    data.pop("password_enc")
    return ProfileOut(**data, has_password=profile.password_enc is not None)


@router.get("", response_model=list[ProfileOut])
async def list_profiles(db: DB, _: CurrentUser):
    rows = (await db.execute(select(ConnectionProfile).order_by(ConnectionProfile.name))).scalars()
    return [_out(p) for p in rows]


@router.post("", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(body: ProfileCreate, db: DB, box: Box, _: AdminUser):
    data = body.model_dump(exclude={"password"})
    profile = ConnectionProfile(
        **data, password_enc=box.encrypt(body.password) if body.password else None
    )
    db.add(profile)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Profile name already exists") from exc
    return _out(profile)


@router.get("/{profile_id}", response_model=ProfileOut)
async def get_profile(profile: Profile, _: CurrentUser):
    return _out(profile)


@router.put("/{profile_id}", response_model=ProfileOut)
async def update_profile(
    body: ProfileUpdate, profile: Profile, db: DB, box: Box, pools: Pools, _: AdminUser
):
    for key, value in body.model_dump(exclude={"password"}).items():
        setattr(profile, key, value)
    if body.password is not None:
        profile.password_enc = box.encrypt(body.password) if body.password else None
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Profile name already exists") from exc
    await pools.drop(profile.id)
    return _out(profile)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(profile: Profile, db: DB, pools: Pools, _: AdminUser):
    await pools.drop(profile.id)
    await db.delete(profile)
    await db.commit()


@router.post("/test", response_model=ServerInfoOut)
async def test_unsaved(body: ProfileTestRequest, _: AdminUser):
    params = ConnParams(
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=body.password or None,
        sslmode=body.sslmode,
        sslrootcert=body.sslrootcert,
        connect_timeout=body.connect_timeout,
    )
    return await _test(params)


@router.post("/{profile_id}/test", response_model=ServerInfoOut)
async def test_saved(profile: Profile, box: Box, _: CurrentUser):
    return await _test(profile_params(profile, box))


async def _test(params: ConnParams) -> ServerInfoOut:
    try:
        info = await test_connection(params)
    except ConnectionError_ as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return ServerInfoOut(**info.__dict__)
