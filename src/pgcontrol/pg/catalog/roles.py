"""Role catalog: attributes and memberships across PostgreSQL 14–18.

PG16 moved inheritance from the role (rolinherit) to the membership row
(pg_auth_members.inherit_option) and added set_option. Both shapes are handled here.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from psycopg import AsyncConnection, sql

from pgcontrol.pg.catalog.common import server_version_num


@dataclass
class RoleSummary:
    oid: int
    name: str
    superuser: bool
    inherit: bool
    createrole: bool
    createdb: bool
    canlogin: bool
    replication: bool
    bypassrls: bool
    connlimit: int
    valid_until: datetime | None
    expired: bool
    config: list[str]
    member_of: list[str]
    members: list[str]
    is_system: bool


@dataclass
class Membership:
    role: str  # the role granted
    grantor: str | None
    admin_option: bool
    inherit_option: bool
    set_option: bool


@dataclass
class ClosureEntry:
    """A role reachable through membership from the starting role."""

    oid: int
    name: str
    depth: int
    path: list[str]  # starting role .. this role
    inherited: bool  # privileges flow along the whole path


@dataclass
class RoleDetail:
    role: RoleSummary
    member_of: list[Membership]
    members: list[Membership]
    inherits_from: list[ClosureEntry]  # transitive closure upward (excluding self)
    inherited_by: list[ClosureEntry]  # transitive closure downward (excluding self)
    extra: dict[str, Any] = field(default_factory=dict)


ROLE_COLUMNS = sql.SQL(
    """
    r.oid, r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
    r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit,
    r.rolvaliduntil, coalesce(r.rolconfig, '{}') AS rolconfig,
    (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil < now()) AS expired,
    (SELECT coalesce(array_agg(p.rolname ORDER BY p.rolname), '{}')
       FROM pg_auth_members m JOIN pg_roles p ON p.oid = m.roleid
      WHERE m.member = r.oid) AS member_of,
    (SELECT coalesce(array_agg(p.rolname ORDER BY p.rolname), '{}')
       FROM pg_auth_members m JOIN pg_roles p ON p.oid = m.member
      WHERE m.roleid = r.oid) AS members
    """
)


def _summary(row: dict[str, Any]) -> RoleSummary:
    return RoleSummary(
        oid=row["oid"],
        name=row["rolname"],
        superuser=row["rolsuper"],
        inherit=row["rolinherit"],
        createrole=row["rolcreaterole"],
        createdb=row["rolcreatedb"],
        canlogin=row["rolcanlogin"],
        replication=row["rolreplication"],
        bypassrls=row["rolbypassrls"],
        connlimit=row["rolconnlimit"],
        valid_until=row["rolvaliduntil"],
        expired=row["expired"],
        config=list(row["rolconfig"]),
        member_of=list(row["member_of"]),
        members=list(row["members"]),
        is_system=row["rolname"].startswith("pg_"),
    )


async def list_roles(conn: AsyncConnection) -> list[RoleSummary]:
    query = sql.SQL("SELECT {cols} FROM pg_roles r ORDER BY r.rolname").format(cols=ROLE_COLUMNS)
    rows = await (await conn.execute(query)).fetchall()
    return [_summary(r) for r in rows]


async def get_role_summary(conn: AsyncConnection, name: str) -> RoleSummary | None:
    query = sql.SQL("SELECT {cols} FROM pg_roles r WHERE r.rolname = %(name)s").format(
        cols=ROLE_COLUMNS
    )
    row = await (await conn.execute(query, {"name": name})).fetchone()
    return _summary(row) if row else None


def _membership_options(version: int, member_alias: str = "mr") -> sql.SQL:
    """Expressions for inherit/set options, given the alias of the *member* role row."""
    if version >= 160000:
        return sql.SQL("m.admin_option, m.inherit_option, m.set_option")
    return sql.SQL("m.admin_option, {mr}.rolinherit AS inherit_option, true AS set_option").format(
        mr=sql.Identifier(member_alias)
    )


async def memberships_of(conn: AsyncConnection, oid: int, version: int) -> list[Membership]:
    """Roles directly granted TO the given role (what it is a member of)."""
    query = sql.SQL(
        """
        SELECT p.rolname AS role, g.rolname AS grantor, {opts}
        FROM pg_auth_members m
        JOIN pg_roles p ON p.oid = m.roleid
        JOIN pg_roles mr ON mr.oid = m.member
        LEFT JOIN pg_roles g ON g.oid = m.grantor
        WHERE m.member = %(oid)s
        ORDER BY p.rolname
        """
    ).format(opts=_membership_options(version))
    rows = await (await conn.execute(query, {"oid": oid})).fetchall()
    return [Membership(**r) for r in rows]


async def members_of(conn: AsyncConnection, oid: int, version: int) -> list[Membership]:
    """Roles that are direct members of the given role."""
    query = sql.SQL(
        """
        SELECT mr.rolname AS role, g.rolname AS grantor, {opts}
        FROM pg_auth_members m
        JOIN pg_roles mr ON mr.oid = m.member
        LEFT JOIN pg_roles g ON g.oid = m.grantor
        WHERE m.roleid = %(oid)s
        ORDER BY mr.rolname
        """
    ).format(opts=_membership_options(version))
    rows = await (await conn.execute(query, {"oid": oid})).fetchall()
    return [Membership(**r) for r in rows]


async def membership_closure(conn: AsyncConnection, name: str, version: int) -> list[ClosureEntry]:
    """Transitive closure of roles the given role is a member of, with inheritance tracking.

    Every path is returned (a role can be reached through several chains); the caller decides
    how to merge. `inherited` is true only if privileges flow along every hop of the path.
    """
    inherit_hop = sql.SQL("m.inherit_option") if version >= 160000 else sql.SQL("mr.rolinherit")
    query = sql.SQL(
        """
        WITH RECURSIVE closure AS (
            SELECT r.oid, r.rolname, 0 AS depth, ARRAY[r.rolname]::text[] AS path, true AS inherited
            FROM pg_roles r WHERE r.rolname = %(name)s
            UNION ALL
            SELECT p.oid, p.rolname, c.depth + 1, c.path || p.rolname, c.inherited AND {hop}
            FROM closure c
            JOIN pg_auth_members m ON m.member = c.oid
            JOIN pg_roles mr ON mr.oid = m.member
            JOIN pg_roles p ON p.oid = m.roleid
            WHERE NOT p.rolname = ANY(c.path)
        )
        SELECT oid, rolname, depth, path, inherited FROM closure
        WHERE depth > 0
        ORDER BY inherited DESC, depth, path
        """
    ).format(hop=inherit_hop)
    rows = await (await conn.execute(query, {"name": name})).fetchall()
    return [
        ClosureEntry(
            oid=r["oid"],
            name=r["rolname"],
            depth=r["depth"],
            path=list(r["path"]),
            inherited=r["inherited"],
        )
        for r in rows
    ]


async def reverse_closure(conn: AsyncConnection, name: str, version: int) -> list[ClosureEntry]:
    """Transitive closure of roles that are members of the given role (who inherits from it)."""
    inherit_hop = sql.SQL("m.inherit_option") if version >= 160000 else sql.SQL("mr.rolinherit")
    query = sql.SQL(
        """
        WITH RECURSIVE closure AS (
            SELECT r.oid, r.rolname, 0 AS depth, ARRAY[r.rolname]::text[] AS path, true AS inherited
            FROM pg_roles r WHERE r.rolname = %(name)s
            UNION ALL
            SELECT mr.oid, mr.rolname, c.depth + 1, c.path || mr.rolname, c.inherited AND {hop}
            FROM closure c
            JOIN pg_auth_members m ON m.roleid = c.oid
            JOIN pg_roles mr ON mr.oid = m.member
            WHERE NOT mr.rolname = ANY(c.path)
        )
        SELECT oid, rolname, depth, path, inherited FROM closure
        WHERE depth > 0
        ORDER BY inherited DESC, depth, path
        """
    ).format(hop=inherit_hop)
    rows = await (await conn.execute(query, {"name": name})).fetchall()
    return [
        ClosureEntry(
            oid=r["oid"],
            name=r["rolname"],
            depth=r["depth"],
            path=list(r["path"]),
            inherited=r["inherited"],
        )
        for r in rows
    ]


def dedupe_closure(entries: list[ClosureEntry]) -> list[ClosureEntry]:
    """Keep one entry per role: the shortest inherited path, else the shortest path."""
    best: dict[int, ClosureEntry] = {}
    for e in entries:  # already ordered inherited-first, then depth
        if e.oid not in best:
            best[e.oid] = e
    return sorted(best.values(), key=lambda e: (e.depth, e.name))


async def get_role_detail(conn: AsyncConnection, name: str) -> RoleDetail | None:
    version = await server_version_num(conn)
    summary = await get_role_summary(conn, name)
    if summary is None:
        return None
    return RoleDetail(
        role=summary,
        member_of=await memberships_of(conn, summary.oid, version),
        members=await members_of(conn, summary.oid, version),
        inherits_from=dedupe_closure(await membership_closure(conn, name, version)),
        inherited_by=dedupe_closure(await reverse_closure(conn, name, version)),
        extra={"server_version_num": version},
    )
