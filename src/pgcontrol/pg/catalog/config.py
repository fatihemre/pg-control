"""Server configuration, per-role/database overrides, client authentication and extensions."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import psycopg
from psycopg import AsyncConnection


@dataclass
class Setting:
    name: str
    setting: str | None
    unit: str | None
    category: str
    short_desc: str
    extra_desc: str | None
    context: str
    vartype: str
    source: str
    min_val: str | None
    max_val: str | None
    enumvals: list[str] | None
    boot_val: str | None
    reset_val: str | None
    sourcefile: str | None
    sourceline: int | None
    pending_restart: bool
    is_default: bool


async def list_settings(conn: AsyncConnection) -> list[Setting]:
    cur = await conn.execute(
        """
        SELECT name, setting, unit, category, short_desc, extra_desc, context, vartype,
               source, min_val, max_val, enumvals, boot_val, reset_val, sourcefile, sourceline,
               pending_restart, source = 'default' AS is_default
        FROM pg_settings
        ORDER BY category, name
        """
    )
    return [Setting(**r) for r in await cur.fetchall()]


@dataclass
class FileSetting:
    sourcefile: str
    sourceline: int
    seqno: int
    name: str
    setting: str | None
    applied: bool
    error: str | None


async def list_file_settings(conn: AsyncConnection) -> list[FileSetting] | None:
    """Rows of pg_file_settings, or None when the connected role may not read them."""
    try:
        cur = await conn.execute(
            "SELECT sourcefile, sourceline, seqno, name, setting, applied, error "
            "FROM pg_file_settings ORDER BY seqno"
        )
        return [FileSetting(**r) for r in await cur.fetchall()]
    except psycopg.errors.InsufficientPrivilege:
        return None


@dataclass
class HbaRule:
    rule_number: int | None
    file_name: str | None
    line_number: int | None
    type: str | None
    database: list[str] | None
    user_name: list[str] | None
    address: str | None
    netmask: str | None
    auth_method: str | None
    options: list[str] | None
    error: str | None


async def list_hba_rules(conn: AsyncConnection, version: int) -> list[HbaRule] | None:
    """Rows of pg_hba_file_rules (PG16+ adds rule_number/file_name); None if not readable."""
    extra = (
        "rule_number, file_name,"
        if version >= 160000
        else "NULL AS rule_number, NULL AS file_name,"
    )
    try:
        cur = await conn.execute(
            f"SELECT {extra} line_number, type, database, user_name, address, netmask, "
            "auth_method, options, error FROM pg_hba_file_rules "
            "ORDER BY line_number"
        )
        return [HbaRule(**r) for r in await cur.fetchall()]
    except psycopg.errors.InsufficientPrivilege:
        return None


@dataclass
class RoleDbSetting:
    role: str | None  # None → all roles
    database: str | None  # None → all databases
    name: str
    value: str


async def list_role_db_settings(conn: AsyncConnection) -> list[RoleDbSetting]:
    cur = await conn.execute(
        """
        SELECT r.rolname AS role, d.datname AS database, s.setconfig
        FROM pg_db_role_setting s
        LEFT JOIN pg_roles r ON r.oid = s.setrole
        LEFT JOIN pg_database d ON d.oid = s.setdatabase
        ORDER BY 1 NULLS FIRST, 2 NULLS FIRST
        """
    )
    out: list[RoleDbSetting] = []
    for r in await cur.fetchall():
        for item in r["setconfig"] or []:
            name, _, value = item.partition("=")
            out.append(RoleDbSetting(r["role"], r["database"], name, value))
    return out


@dataclass
class Extension:
    name: str
    default_version: str | None
    installed_version: str | None
    comment: str | None
    schema: str | None
    relocatable: bool | None
    superuser_required: bool | None
    trusted: bool | None
    versions: list[str]
    update_available: bool

    def to_dict(self) -> dict:
        return asdict(self)


async def list_extensions(conn: AsyncConnection, version: int) -> list[Extension]:
    trusted = "v.trusted" if version >= 130000 else "NULL::bool AS trusted"
    cur = await conn.execute(
        f"""
        SELECT a.name, a.default_version, a.installed_version, a.comment,
               n.nspname AS schema, e.extrelocatable AS relocatable,
               (SELECT bool_or(v.superuser) FROM pg_available_extension_versions v
                 WHERE v.name = a.name AND v.version = a.default_version) AS superuser_required,
               (SELECT bool_or({trusted}) FROM pg_available_extension_versions v
                 WHERE v.name = a.name AND v.version = a.default_version) AS trusted,
               COALESCE((SELECT array_agg(v.version ORDER BY v.version)
                           FROM pg_available_extension_versions v WHERE v.name = a.name),
                        ARRAY[]::text[]) AS versions
        FROM pg_available_extensions a
        LEFT JOIN pg_extension e ON e.extname = a.name
        LEFT JOIN pg_namespace n ON n.oid = e.extnamespace
        ORDER BY a.installed_version IS NULL, a.name
        """
    )
    out = []
    for r in await cur.fetchall():
        r = dict(r)
        r["update_available"] = bool(
            r["installed_version"]
            and r["default_version"]
            and r["installed_version"] != r["default_version"]
        )
        out.append(Extension(**r))
    return out
