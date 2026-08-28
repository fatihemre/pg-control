"""Object ownership per database (who owns what), for the Security → Ownership page."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from psycopg import AsyncConnection

from pgcontrol.pg.catalog.grants import _clean

# Kinds reported here double as the ``kind`` accepted by the alter_owner change operation.
QUERY = """
SELECT 'database' AS kind, NULL::text AS schema, d.datname AS name, NULL::text AS args,
       d.datdba::regrole::text AS owner
FROM pg_database d WHERE NOT d.datistemplate
UNION ALL
SELECT 'schema', NULL, n.nspname, NULL, n.nspowner::regrole::text
FROM pg_namespace n
WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
UNION ALL
SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table'
            WHEN 'p' THEN 'partitioned table' WHEN 'S' THEN 'sequence' END,
       n.nspname, c.relname, NULL, c.relowner::regrole::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','v','m','f','p','S')
  AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
  AND NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.classid = 'pg_class'::regclass
                    AND x.objid = c.oid AND x.deptype = 'e')
UNION ALL
SELECT CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
            WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window function' END,
       n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.proowner::regrole::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
  AND NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.classid = 'pg_proc'::regclass
                    AND x.objid = p.oid AND x.deptype = 'e')
ORDER BY 1, 2 NULLS FIRST, 3, 4
"""


@dataclass
class OwnedObject:
    kind: str
    schema: str | None
    name: str
    args: str | None
    owner: str

    def to_dict(self) -> dict:
        return asdict(self)


async def list_owned_objects(conn: AsyncConnection) -> list[OwnedObject]:
    cur = await conn.execute(QUERY)
    return [
        OwnedObject(r["kind"], r["schema"], r["name"], r["args"], _clean(r["owner"]))
        for r in await cur.fetchall()
    ]
