"""Effective privileges: what a role can actually do in a database, and why.

Two layers:
  * ground truth  — has_*_privilege() already accounts for membership, inheritance,
                    ownership, PUBLIC and superuser. Every "granted" flag comes from it.
  * explanation   — ACL entries (aclexplode/acldefault) matched against the role's inherited
                    membership closure, so each granted privilege can say *which* role holds
                    the grant and through which chain it was inherited.

Also surfaced: schema USAGE / database CONNECT blockers, column-level grants, row-level
security policies and default privileges, because those are what usually make
"has_table_privilege says yes" and "the query fails" disagree.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from psycopg import AsyncConnection, sql

from pgcontrol.pg.catalog.common import PUBLIC_NAME, PUBLIC_OID, server_version_num
from pgcontrol.pg.catalog.roles import (
    ClosureEntry,
    RoleSummary,
    dedupe_closure,
    get_role_summary,
    membership_closure,
)

DATABASE_PRIVS = ["CONNECT", "CREATE", "TEMPORARY"]
SCHEMA_PRIVS = ["USAGE", "CREATE"]
SEQUENCE_PRIVS = ["USAGE", "SELECT", "UPDATE"]
FUNCTION_PRIVS = ["EXECUTE"]
RELKINDS = {
    "r": "table",
    "p": "partitioned_table",
    "v": "view",
    "m": "materialized_view",
    "f": "foreign_table",
    "S": "sequence",
}
PROKINDS = {"f": "function", "p": "procedure", "a": "aggregate", "w": "window_function"}
DEFACL_TYPES = {"r": "tables", "S": "sequences", "f": "functions", "T": "types", "n": "schemas"}


def table_privs(version: int) -> list[str]:
    privs = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
    if version >= 170000:
        privs.append("MAINTAIN")
    return privs


@dataclass
class Source:
    kind: str  # acl | owner | superuser
    grantee: str | None = None
    via: list[str] = field(default_factory=list)  # membership hops from the role to grantee
    grantor: str | None = None
    grant_option: bool = False


@dataclass
class Privilege:
    name: str
    granted: bool
    sources: list[Source] = field(default_factory=list)


@dataclass
class ColumnGrant:
    column: str
    privilege: str
    source: Source


@dataclass
class Policy:
    name: str
    command: str
    permissive: bool
    roles: list[str]


@dataclass
class ObjectPrivileges:
    kind: str
    schema: str | None
    name: str
    owner: str
    is_owner: bool
    privileges: list[Privilege]
    blockers: list[str] = field(default_factory=list)
    column_grants: list[ColumnGrant] = field(default_factory=list)
    rls_enabled: bool = False
    rls_forced: bool = False
    policies: list[Policy] = field(default_factory=list)


@dataclass
class DefaultPrivilege:
    for_role: str
    schema: str | None
    object_type: str
    privilege: str
    source: Source


@dataclass
class EffectivePrivileges:
    role: RoleSummary
    database: str
    server_version_num: int
    warnings: list[str]
    membership: list[ClosureEntry]
    database_privileges: ObjectPrivileges
    schemas: list[ObjectPrivileges]
    objects: list[ObjectPrivileges]
    default_privileges: list[DefaultPrivilege]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class _Ctx:
    def __init__(self, role: RoleSummary, closure: list[ClosureEntry], names: dict[int, str]):
        self.role = role
        self.names = names
        # oid -> membership hops (excluding the role itself) for roles whose privileges flow
        self.via: dict[int, list[str]] = {role.oid: []}
        for e in closure:
            if e.inherited:
                self.via[e.oid] = e.path[1:]
        self.oids = list(self.via.keys())

    def name(self, oid: int) -> str:
        if oid == PUBLIC_OID:
            return PUBLIC_NAME
        return self.names.get(oid, f"oid:{oid}")

    def source(self, grantee: int, grantor: int, grantable: bool, owner: int) -> Source:
        kind = "owner" if grantee == owner and grantee != PUBLIC_OID else "acl"
        return Source(
            kind=kind,
            grantee=self.name(grantee),
            via=self.via.get(grantee, []),
            grantor=self.name(grantor) if grantor else None,
            grant_option=grantable,
        )

    def build_privileges(
        self,
        priv_names: list[str],
        row: dict[str, Any],
        acl_rows: list[dict[str, Any]],
        owner: int,
    ) -> list[Privilege]:
        out: list[Privilege] = []
        for p in priv_names:
            granted = bool(row[f"p_{p.lower()}"])
            sources = [
                self.source(a["grantee"], a["grantor"], a["is_grantable"], owner)
                for a in acl_rows
                if a["privilege_type"] == p
            ]
            if granted and not sources and self.role.superuser:
                sources.append(Source(kind="superuser", grantee=self.role.name))
            out.append(Privilege(name=p, granted=granted, sources=sources))
        return out


def _has_priv_columns(func: str, priv_names: list[str], oid_expr: str = "c.oid") -> sql.Composable:
    return sql.SQL(", ").join(
        sql.SQL("{f}(%(role)s, {oid}, {p}) AS {alias}").format(
            f=sql.SQL(func),
            oid=sql.SQL(oid_expr),
            p=sql.Literal(p),
            alias=sql.Identifier(f"p_{p.lower()}"),
        )
        for p in priv_names
    )


async def _fetch(conn: AsyncConnection, query: sql.Composable | str, params: dict[str, Any]):
    return await (await conn.execute(query, params)).fetchall()


async def effective_privileges(
    conn: AsyncConnection, role_name: str, schema: str | None = None
) -> EffectivePrivileges | None:
    version = await server_version_num(conn)
    role = await get_role_summary(conn, role_name)
    if role is None:
        return None

    names = {
        r["oid"]: r["rolname"] for r in await _fetch(conn, "SELECT oid, rolname FROM pg_roles", {})
    }
    closure = dedupe_closure(await membership_closure(conn, role_name, version))
    ctx = _Ctx(role, closure, names)
    base = {"role": role_name, "oids": ctx.oids}

    warnings: list[str] = []
    if not role.canlogin:
        warnings.append("Role cannot log in (NOLOGIN); privileges only usable via SET ROLE")
    if role.expired:
        warnings.append(f"Role validity expired at {role.valid_until:%Y-%m-%d %H:%M %Z}")
    if role.connlimit == 0:
        warnings.append("Connection limit is 0; no new sessions allowed")
    if role.superuser:
        warnings.append("Superuser: bypasses all privilege checks")
    if not role.inherit and version < 160000:
        warnings.append("NOINHERIT: privileges of member roles require SET ROLE")
    non_inherited = [e for e in closure if not e.inherited]
    if non_inherited:
        warnings.append(
            "Membership without inheritance (SET ROLE needed): "
            + ", ".join(" → ".join(e.path) for e in non_inherited)
        )

    # ---- database -------------------------------------------------------------------------
    db_row = (
        await _fetch(
            conn,
            sql.SQL(
                """
                SELECT d.oid, d.datname, d.datdba, {privs}
                FROM pg_database d WHERE d.datname = current_database()
                """
            ).format(privs=_has_priv_columns("has_database_privilege", DATABASE_PRIVS, "d.oid")),
            base,
        )
    )[0]
    db_acl = await _fetch(
        conn,
        """
        SELECT a.grantee, a.grantor, a.privilege_type, a.is_grantable
        FROM pg_database d
        CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
        WHERE d.datname = current_database()
          AND (a.grantee = ANY(%(oids)s::oid[]) OR a.grantee = 0)
        """,
        base,
    )
    database = ObjectPrivileges(
        kind="database",
        schema=None,
        name=db_row["datname"],
        owner=ctx.name(db_row["datdba"]),
        is_owner=db_row["datdba"] in ctx.via,
        privileges=ctx.build_privileges(DATABASE_PRIVS, db_row, db_acl, db_row["datdba"]),
    )
    can_connect = database.privileges[0].granted
    db_blocker = [] if can_connect else [f"No CONNECT on database {db_row['datname']}"]

    # ---- schemas --------------------------------------------------------------------------
    schema_filter = sql.SQL("AND n.nspname = %(schema)s") if schema else sql.SQL("")
    params = {**base, "schema": schema}
    ns_rows = await _fetch(
        conn,
        sql.SQL(
            """
            SELECT n.oid, n.nspname, n.nspowner, {privs}
            FROM pg_namespace n
            WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' {filter}
            ORDER BY n.nspname
            """
        ).format(
            privs=_has_priv_columns("has_schema_privilege", SCHEMA_PRIVS, "n.oid"),
            filter=schema_filter,
        ),
        params,
    )
    ns_oids = [r["oid"] for r in ns_rows]
    params["nsp"] = ns_oids
    ns_acl = _group(
        await _fetch(
            conn,
            """
            SELECT n.oid AS obj, a.grantee, a.grantor, a.privilege_type, a.is_grantable
            FROM pg_namespace n
            CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
            WHERE n.oid = ANY(%(nsp)s::oid[])
              AND (a.grantee = ANY(%(oids)s::oid[]) OR a.grantee = 0)
            """,
            params,
        )
    )
    schemas: list[ObjectPrivileges] = []
    schema_usage: dict[int, bool] = {}
    schema_name: dict[int, str] = {}
    for r in ns_rows:
        privs = ctx.build_privileges(SCHEMA_PRIVS, r, ns_acl.get(r["oid"], []), r["nspowner"])
        schema_usage[r["oid"]] = privs[0].granted
        schema_name[r["oid"]] = r["nspname"]
        schemas.append(
            ObjectPrivileges(
                kind="schema",
                schema=None,
                name=r["nspname"],
                owner=ctx.name(r["nspowner"]),
                is_owner=r["nspowner"] in ctx.via,
                privileges=privs,
                blockers=list(db_blocker),
            )
        )

    def object_blockers(nsp: int) -> list[str]:
        b = list(db_blocker)
        if not schema_usage.get(nsp, False):
            b.append(f"No USAGE on schema {schema_name.get(nsp, '?')}")
        return b

    # ---- relations (tables, views, ...) and sequences ---------------------------------------
    tprivs = table_privs(version)
    rel_rows = await _fetch(
        conn,
        sql.SQL(
            """
            SELECT c.oid, c.relnamespace, c.relname, c.relkind, c.relowner,
                   c.relrowsecurity, c.relforcerowsecurity, {privs}
            FROM pg_class c
            WHERE c.relnamespace = ANY(%(nsp)s::oid[]) AND c.relkind IN ('r','p','v','m','f')
            ORDER BY c.relnamespace, c.relname
            """
        ).format(privs=_has_priv_columns("has_table_privilege", tprivs)),
        params,
    )
    seq_rows = await _fetch(
        conn,
        sql.SQL(
            """
            SELECT c.oid, c.relnamespace, c.relname, c.relkind, c.relowner,
                   false AS relrowsecurity, false AS relforcerowsecurity, {privs}
            FROM pg_class c
            WHERE c.relnamespace = ANY(%(nsp)s::oid[]) AND c.relkind = 'S'
            ORDER BY c.relnamespace, c.relname
            """
        ).format(privs=_has_priv_columns("has_sequence_privilege", SEQUENCE_PRIVS)),
        params,
    )
    rel_acl = _group(
        await _fetch(
            conn,
            """
            SELECT c.oid AS obj, a.grantee, a.grantor, a.privilege_type, a.is_grantable
            FROM pg_class c
            CROSS JOIN LATERAL aclexplode(COALESCE(
                c.relacl,
                acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner)
            )) a
            WHERE c.relnamespace = ANY(%(nsp)s::oid[]) AND c.relkind IN ('r','p','v','m','f','S')
              AND (a.grantee = ANY(%(oids)s::oid[]) OR a.grantee = 0)
            """,
            params,
        )
    )
    col_acl = _group(
        await _fetch(
            conn,
            """
            SELECT c.oid AS obj, att.attname, a.grantee, a.grantor, a.privilege_type, a.is_grantable
            FROM pg_class c
            JOIN pg_attribute att ON att.attrelid = c.oid
                 AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL
            CROSS JOIN LATERAL aclexplode(att.attacl) a
            WHERE c.relnamespace = ANY(%(nsp)s::oid[])
              AND (a.grantee = ANY(%(oids)s::oid[]) OR a.grantee = 0)
            ORDER BY att.attnum
            """,
            params,
        )
    )
    policies = _group(
        await _fetch(
            conn,
            """
            SELECT pol.polrelid AS obj, pol.polname, pol.polcmd, pol.polpermissive, pol.polroles
            FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
            WHERE c.relnamespace = ANY(%(nsp)s::oid[])
              AND (pol.polroles = '{0}'::oid[] OR pol.polroles && %(oids)s::oid[])
            ORDER BY pol.polname
            """,
            params,
        )
    )
    objects: list[ObjectPrivileges] = []
    for r in rel_rows + seq_rows:
        is_seq = r["relkind"] == "S"
        objects.append(
            ObjectPrivileges(
                kind=RELKINDS[r["relkind"]],
                schema=schema_name[r["relnamespace"]],
                name=r["relname"],
                owner=ctx.name(r["relowner"]),
                is_owner=r["relowner"] in ctx.via,
                privileges=ctx.build_privileges(
                    SEQUENCE_PRIVS if is_seq else tprivs,
                    r,
                    rel_acl.get(r["oid"], []),
                    r["relowner"],
                ),
                blockers=object_blockers(r["relnamespace"]),
                column_grants=[
                    ColumnGrant(
                        column=a["attname"],
                        privilege=a["privilege_type"],
                        source=ctx.source(
                            a["grantee"], a["grantor"], a["is_grantable"], r["relowner"]
                        ),
                    )
                    for a in col_acl.get(r["oid"], [])
                ],
                rls_enabled=r["relrowsecurity"],
                rls_forced=r["relforcerowsecurity"],
                policies=[
                    Policy(
                        name=p["polname"],
                        command={
                            "r": "SELECT",
                            "a": "INSERT",
                            "w": "UPDATE",
                            "d": "DELETE",
                            "*": "ALL",
                        }[p["polcmd"]],
                        permissive=p["polpermissive"],
                        roles=[ctx.name(o) for o in p["polroles"]],
                    )
                    for p in policies.get(r["oid"], [])
                ],
            )
        )

    # ---- functions ---------------------------------------------------------------------------
    fn_rows = await _fetch(
        conn,
        sql.SQL(
            """
            SELECT p.oid, p.pronamespace, p.proowner, p.prokind,
                   p.proname || '('
                       || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
                   {privs}
            FROM pg_proc p
            WHERE p.pronamespace = ANY(%(nsp)s::oid[])
            ORDER BY p.pronamespace, p.proname
            """
        ).format(privs=_has_priv_columns("has_function_privilege", FUNCTION_PRIVS, "p.oid")),
        params,
    )
    fn_acl = _group(
        await _fetch(
            conn,
            """
            SELECT p.oid AS obj, a.grantee, a.grantor, a.privilege_type, a.is_grantable
            FROM pg_proc p
            CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.pronamespace = ANY(%(nsp)s::oid[])
              AND (a.grantee = ANY(%(oids)s::oid[]) OR a.grantee = 0)
            """,
            params,
        )
    )
    for r in fn_rows:
        objects.append(
            ObjectPrivileges(
                kind=PROKINDS.get(r["prokind"], "function"),
                schema=schema_name[r["pronamespace"]],
                name=r["signature"],
                owner=ctx.name(r["proowner"]),
                is_owner=r["proowner"] in ctx.via,
                privileges=ctx.build_privileges(
                    FUNCTION_PRIVS, r, fn_acl.get(r["oid"], []), r["proowner"]
                ),
                blockers=object_blockers(r["pronamespace"]),
            )
        )

    # ---- default privileges ------------------------------------------------------------------
    defacl_rows = await _fetch(
        conn,
        """
        SELECT d.defaclrole, d.defaclnamespace, d.defaclobjtype,
               a.grantee, a.grantor, a.privilege_type, a.is_grantable
        FROM pg_default_acl d
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE (a.grantee = ANY(%(oids)s::oid[]) OR a.grantee = 0)
          AND (d.defaclnamespace = 0 OR d.defaclnamespace = ANY(%(nsp)s::oid[]))
        ORDER BY d.defaclnamespace, d.defaclobjtype, a.privilege_type
        """,
        params,
    )
    default_privileges = [
        DefaultPrivilege(
            for_role=ctx.name(d["defaclrole"]),
            schema=schema_name.get(d["defaclnamespace"]) if d["defaclnamespace"] else None,
            object_type=DEFACL_TYPES.get(d["defaclobjtype"], d["defaclobjtype"]),
            privilege=d["privilege_type"],
            source=ctx.source(d["grantee"], d["grantor"], d["is_grantable"], d["defaclrole"]),
        )
        for d in defacl_rows
    ]

    return EffectivePrivileges(
        role=role,
        database=db_row["datname"],
        server_version_num=version,
        warnings=warnings,
        membership=closure,
        database_privileges=database,
        schemas=schemas,
        objects=objects,
        default_privileges=default_privileges,
    )


def _group(rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    out: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r["obj"], []).append(r)
    return out
