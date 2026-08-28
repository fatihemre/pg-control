"""Explicit ACL listing per object (who was granted what), for the Permissions pages."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from psycopg import AsyncConnection

from pgcontrol.pg.catalog.common import PUBLIC_NAME


@dataclass
class Grant:
    grantee: str
    privilege: str
    grantable: bool
    grantor: str


@dataclass
class ObjectGrants:
    kind: str
    schema: str | None
    name: str
    args: str | None
    owner: str
    acl_is_default: bool
    grants: list[Grant] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


_GRANT_COLS = """
    a.grantor::regrole::text AS grantor,
    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
    a.privilege_type AS privilege, a.is_grantable AS grantable
"""

QUERIES = {
    "database": f"""
        SELECT 'database' AS kind, NULL::text AS schema, d.datname AS name, NULL::text AS args,
               d.datdba::regrole::text AS owner, d.datacl IS NULL AS acl_is_default, {_GRANT_COLS}
        FROM pg_database d
        LEFT JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a ON true
        WHERE NOT d.datistemplate
        ORDER BY d.datname, grantee, privilege
    """,
    "schema": f"""
        SELECT 'schema' AS kind, NULL::text AS schema, n.nspname AS name, NULL::text AS args,
               n.nspowner::regrole::text AS owner, n.nspacl IS NULL AS acl_is_default, {_GRANT_COLS}
        FROM pg_namespace n
        LEFT JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a ON true
        WHERE n.nspname NOT LIKE 'pg\\_%%' AND n.nspname <> 'information_schema'
        ORDER BY n.nspname, grantee, privilege
    """,
    "table": f"""
        SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view'
                    WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table'
                    WHEN 'p' THEN 'partitioned table' END AS kind,
               n.nspname AS schema, c.relname AS name, NULL::text AS args,
               c.relowner::regrole::text AS owner, c.relacl IS NULL AS acl_is_default, {_GRANT_COLS}
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a ON true
        WHERE c.relkind IN ('r','v','m','f','p')
          AND n.nspname NOT LIKE 'pg\\_%%' AND n.nspname <> 'information_schema'
          AND (%(schema)s::text IS NULL OR n.nspname = %(schema)s)
        ORDER BY n.nspname, c.relname, grantee, privilege
    """,
    "sequence": f"""
        SELECT 'sequence' AS kind, n.nspname AS schema, c.relname AS name, NULL::text AS args,
               c.relowner::regrole::text AS owner, c.relacl IS NULL AS acl_is_default, {_GRANT_COLS}
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('s', c.relowner))) a ON true
        WHERE c.relkind = 'S'
          AND n.nspname NOT LIKE 'pg\\_%%' AND n.nspname <> 'information_schema'
          AND (%(schema)s::text IS NULL OR n.nspname = %(schema)s)
        ORDER BY n.nspname, c.relname, grantee, privilege
    """,
    "function": f"""
        SELECT CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
                    WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window function' END AS kind,
               n.nspname AS schema, p.proname AS name,
               pg_get_function_identity_arguments(p.oid) AS args,
               p.proowner::regrole::text AS owner, p.proacl IS NULL AS acl_is_default, {_GRANT_COLS}
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a ON true
        WHERE n.nspname NOT LIKE 'pg\\_%%' AND n.nspname <> 'information_schema'
          AND (%(schema)s::text IS NULL OR n.nspname = %(schema)s)
        ORDER BY n.nspname, p.proname, args, grantee, privilege
    """,
}


def _clean(name: str) -> str:
    # regrole::text quotes names that need it; the UI wants the bare name.
    if name.startswith('"') and name.endswith('"'):
        return name[1:-1].replace('""', '"')
    return name


async def list_grants(
    conn: AsyncConnection, kind: str, schema: str | None = None
) -> list[ObjectGrants]:
    if kind not in QUERIES:
        raise ValueError(f"unknown kind {kind}")
    cur = await conn.execute(QUERIES[kind], {"schema": schema})
    rows = await cur.fetchall()
    out: list[ObjectGrants] = []
    current: ObjectGrants | None = None
    for r in rows:
        key = (r["schema"], r["name"], r["args"])
        if current is None or (current.schema, current.name, current.args) != key:
            current = ObjectGrants(
                kind=r["kind"],
                schema=r["schema"],
                name=r["name"],
                args=r["args"],
                owner=_clean(r["owner"]),
                acl_is_default=r["acl_is_default"],
            )
            out.append(current)
        if r["privilege"] is not None:
            grantee = r["grantee"]
            current.grants.append(
                Grant(
                    grantee=PUBLIC_NAME if grantee == "PUBLIC" else _clean(grantee),
                    privilege=r["privilege"],
                    grantable=r["grantable"],
                    grantor=_clean(r["grantor"]),
                )
            )
    return out
