from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from pgcontrol.api.deps import Box, Pools, Profile, profile_params
from pgcontrol.pg.catalog import cluster, config, grants, ownership, perf, privileges, roles
from pgcontrol.pg.catalog.common import server_version_num
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


@router.get("/databases/{dbname}/grants")
async def list_grants(
    dbname: str,
    profile: Profile,
    box: Box,
    pools: Pools,
    _: CurrentUser,
    kind: Annotated[str, Query(pattern="^(database|schema|table|sequence|function)$")],
    schema: str | None = None,
):
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        return [g.to_dict() for g in await grants.list_grants(conn, kind, schema)]


@router.get("/server")
async def server_info(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT current_setting('server_version_num')::int AS server_version_num, "
            "version() AS version, current_user AS current_user, "
            "pg_is_in_recovery() AS in_recovery, "
            "(SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser"
        )
        return await cur.fetchone()


@router.get("/memberships")
async def list_memberships(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        version = await server_version_num(conn)
        return [asdict(m) for m in await roles.list_memberships(conn, version)]


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


@router.get("/settings")
async def list_settings(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        return [asdict(s) for s in await config.list_settings(conn)]


@router.get("/file-settings")
async def list_file_settings(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        rows = await config.list_file_settings(conn)
    return {"readable": rows is not None, "rows": [asdict(r) for r in rows or []]}


@router.get("/hba")
async def list_hba(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        version = await server_version_num(conn)
        rows = await config.list_hba_rules(conn, version)
    return {"readable": rows is not None, "rows": [asdict(r) for r in rows or []]}


@router.get("/role-db-settings")
async def list_role_db_settings(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        return [asdict(s) for s in await config.list_role_db_settings(conn)]


@router.get("/databases/{dbname}/extensions")
async def list_extensions(dbname: str, profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        version = await server_version_num(conn)
        return [e.to_dict() for e in await config.list_extensions(conn, version)]


@router.get("/databases/{dbname}/grants-all")
async def list_all_grants(dbname: str, profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    """Every explicit or default ACL entry of the database, flattened for the Grants page."""
    pool = await _pool(profile, box, pools, dbname)
    out = []
    async with pool.connection() as conn:
        for kind in ("database", "schema", "table", "sequence", "function"):
            for obj in await grants.list_grants(conn, kind):
                for g in obj.grants:
                    out.append(
                        {
                            "kind": obj.kind,
                            "schema": obj.schema,
                            "name": obj.name,
                            "args": obj.args,
                            "owner": obj.owner,
                            "acl_is_default": obj.acl_is_default,
                            "grantee": g.grantee,
                            "privilege": g.privilege,
                            "grantable": g.grantable,
                            "grantor": g.grantor,
                        }
                    )
    return out


@router.get("/databases/{dbname}/ownership")
async def list_ownership(dbname: str, profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        return [o.to_dict() for o in await ownership.list_owned_objects(conn)]


@router.get("/activity")
async def list_activity(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        sessions = await perf.list_activity(conn)
        blocked = await perf.list_blocked(conn)
    return {"sessions": [asdict(s) for s in sessions], "blocked": [asdict(b) for b in blocked]}


@router.get("/databases/{dbname}/statements")
async def list_statements(
    dbname: str,
    profile: Profile,
    box: Box,
    pools: Pools,
    _: CurrentUser,
    order: Annotated[
        str, Query(pattern="^(total_time|mean_time|calls|rows|shared_read|temp)$")
    ] = "total_time",
    limit: int = 100,
):
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        return asdict(await perf.list_statements(conn, order, limit))


@router.get("/databases/{dbname}/table-stats")
async def list_table_stats(
    dbname: str, profile: Profile, box: Box, pools: Pools, _: CurrentUser, schema: str | None = None
):
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        return [asdict(t) for t in await perf.table_stats(conn, schema)]


@router.get("/databases/{dbname}/index-stats")
async def list_index_stats(
    dbname: str, profile: Profile, box: Box, pools: Pools, _: CurrentUser, schema: str | None = None
):
    pool = await _pool(profile, box, pools, dbname)
    async with pool.connection() as conn:
        return [asdict(i) for i in await perf.index_stats(conn, schema)]


@router.get("/db-stats")
async def list_db_stats(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        return [asdict(d) for d in await perf.database_stats(conn)]


@router.get("/overview")
async def get_overview(profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        version = await server_version_num(conn)
        return asdict(await cluster.overview(conn, version))


@router.get("/replication")
async def get_replication(
    profile: Profile, box: Box, pools: Pools, _: CurrentUser, database: str | None = None
):
    """Cluster replication state; publications/subscriptions are read from ``database``."""
    pool = await _pool(profile, box, pools)
    async with pool.connection() as conn:
        version = await server_version_num(conn)
        if database and database != profile.database:
            logical_pool = await _pool(profile, box, pools, database)
            async with logical_pool.connection() as logical_conn:
                return (await cluster.replication(conn, version, logical_conn)).to_dict()
        return (await cluster.replication(conn, version)).to_dict()
