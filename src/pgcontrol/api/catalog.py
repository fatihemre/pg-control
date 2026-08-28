from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from pgcontrol.api.deps import Box, Pools, Profile, profile_params
from pgcontrol.pg.catalog import privileges, roles
from pgcontrol.security.auth import CurrentUser

router = APIRouter(prefix="/api/profiles/{profile_id}", tags=["catalog"])


async def _pool(profile, box, pools, dbname: str | None = None):
    return await pools.get(profile.id, profile_params(profile, box), dbname)


@router.get("/databases")
async def list_databases(profile: Profile, box: Box, pools: Pools, _: CurrentUser) -> list[str]:
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 1"
        )
        rows = await cur.fetchall()
    return [r["datname"] for r in rows]


@router.get("/databases/{dbname}/schemas")
async def list_schemas(
    dbname: str, profile: Profile, box: Box, pools: Pools, _: CurrentUser
) -> list[str]:
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT nspname FROM pg_namespace "
            "WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY 1"
        )
        rows = await cur.fetchall()
    return [r["nspname"] for r in rows]


@router.get("/roles")
async def list_roles(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        return [asdict(r) for r in await roles.list_roles(conn)]


@router.get("/roles/{name}")
async def get_role(name: str, profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        detail = await roles.get_role_detail(conn, name)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Role {name!r} not found")
    return asdict(detail)


@router.get("/databases/{dbname}/effective-privileges")
async def effective_privileges(
    dbname: str,
    role: Annotated[str, Query(min_length=1)],
    profile: Profile,
    box: Box,
    pools: Pools,
    _: CurrentUser,
    schema: str | None = None,
):
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        result = await privileges.effective_privileges(conn, role, schema)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Role {role!r} not found")
    return result.to_dict()
