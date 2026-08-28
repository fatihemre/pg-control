"""Change operations: validated models rendered to SQL for Plan → Preview → Apply.

Every identifier goes through ``psycopg.sql.Identifier``; privilege keywords and other
raw SQL fragments are validated against allow-lists before being embedded.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Literal

from psycopg import AsyncConnection, sql
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

ObjectKind = Literal["database", "schema", "table", "sequence", "function"]
DefaultKind = Literal["tables", "sequences", "functions", "types", "schemas"]

PRIVILEGES: dict[str, set[str]] = {
    "database": {"CONNECT", "CREATE", "TEMPORARY"},
    "schema": {"USAGE", "CREATE"},
    "table": {"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"},
    "sequence": {"USAGE", "SELECT", "UPDATE"},
    "function": {"EXECUTE"},
    # default privilege object classes
    "tables": {"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"},
    "sequences": {"USAGE", "SELECT", "UPDATE"},
    "functions": {"EXECUTE"},
    "types": {"USAGE"},
    "schemas": {"USAGE", "CREATE"},
}
VERSIONED_PRIVILEGES = {("table", "MAINTAIN"): 170000, ("tables", "MAINTAIN"): 170000}

OBJECT_KEYWORD = {
    "database": "DATABASE",
    "schema": "SCHEMA",
    "table": "TABLE",
    "sequence": "SEQUENCE",
    "function": "ROUTINE",
}
ALL_IN_SCHEMA_KEYWORD = {"table": "TABLES", "sequence": "SEQUENCES", "function": "ROUTINES"}
DEFAULT_KEYWORD = {
    "tables": "TABLES",
    "sequences": "SEQUENCES",
    "functions": "ROUTINES",
    "types": "TYPES",
    "schemas": "SCHEMAS",
}
REDACTED = "********"


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


def _upper_privs(v: list[str]) -> list[str]:
    seen: list[str] = []
    for p in v:
        p = p.strip().upper()
        if p and p not in seen:
            seen.append(p)
    if not seen:
        raise ValueError("at least one privilege is required")
    return seen


class ObjectRef(_Model):
    kind: ObjectKind
    schema_name: str | None = Field(default=None, alias="schema")
    name: str | None = None
    args: str | None = None  # function identity arguments, verified against the catalog
    all_in_schema: bool = False


class GrantOp(ObjectRef):
    op: Literal["grant"]
    grantee: str
    privileges: list[str]
    grant_option: bool = False

    _norm = field_validator("privileges")(_upper_privs)


class RevokeOp(ObjectRef):
    op: Literal["revoke"]
    grantee: str
    privileges: list[str]
    grant_option_only: bool = False
    cascade: bool = False

    _norm = field_validator("privileges")(_upper_privs)


class GrantRoleOp(_Model):
    op: Literal["grant_role"]
    role: str
    member: str
    admin_option: bool | None = None
    inherit_option: bool | None = None  # PG16+
    set_option: bool | None = None  # PG16+


class RevokeRoleOp(_Model):
    op: Literal["revoke_role"]
    role: str
    member: str
    option_only: Literal["admin", "inherit", "set"] | None = None


class RoleAttributes(_Model):
    superuser: bool | None = None
    createdb: bool | None = None
    createrole: bool | None = None
    inherit: bool | None = None
    login: bool | None = None
    replication: bool | None = None
    bypassrls: bool | None = None
    connlimit: int | None = Field(default=None, ge=-1)
    valid_until: str | None = None  # "" or "infinity" clears the expiry
    password: SecretStr | None = None  # "" removes the password

    def is_empty(self) -> bool:
        return all(getattr(self, f) is None for f in type(self).model_fields)


class AlterRoleOp(_Model):
    op: Literal["alter_role"]
    role: str
    attributes: RoleAttributes


class CreateRoleOp(_Model):
    op: Literal["create_role"]
    name: str
    attributes: RoleAttributes = RoleAttributes()
    member_of: list[str] = []


class DropRoleOp(_Model):
    op: Literal["drop_role"]
    name: str
    reassign_to: str | None = None  # REASSIGN OWNED BY … TO …; DROP OWNED BY …
    drop_owned: bool = False


class AlterRoleConfigOp(_Model):
    op: Literal["alter_role_config"]
    role: str
    name: str
    value: str | None = None  # None → RESET
    database: str | None = None  # ALTER ROLE … IN DATABASE …


class AlterDefaultOp(_Model):
    op: Literal["alter_default"]
    action: Literal["grant", "revoke"]
    for_role: str | None = None
    schema_name: str | None = Field(default=None, alias="schema")
    object_type: DefaultKind
    grantee: str
    privileges: list[str]
    grant_option: bool = False

    _norm = field_validator("privileges")(_upper_privs)


Change = Annotated[
    GrantOp
    | RevokeOp
    | GrantRoleOp
    | RevokeRoleOp
    | AlterRoleOp
    | CreateRoleOp
    | DropRoleOp
    | AlterRoleConfigOp
    | AlterDefaultOp,
    Field(discriminator="op"),
]


class ChangeSet(_Model):
    database: str | None = None
    operations: list[Change] = Field(min_length=1, max_length=200)


@dataclass
class Statement:
    sql: sql.Composed
    preview: str
    description: str


class PlanError(ValueError):
    def __init__(self, index: int, message: str):
        super().__init__(message)
        self.index = index
        self.message = message


class _Renderer:
    def __init__(self, conn: AsyncConnection, version: int):
        self.conn = conn
        self.version = version
        self.warnings: list[str] = []

    # -- helpers ---------------------------------------------------------------------------
    def grantee(self, name: str) -> sql.Composable:
        return sql.SQL("PUBLIC") if name.upper() == "PUBLIC" else sql.Identifier(name)

    def privs(self, kind: str, names: list[str]) -> sql.Composable:
        if names == ["ALL"]:
            return sql.SQL("ALL PRIVILEGES")
        allowed = set(PRIVILEGES[kind])
        for (k, p), minimum in VERSIONED_PRIVILEGES.items():
            if k == kind and self.version >= minimum:
                allowed.add(p)
        bad = [p for p in names if p not in allowed]
        if bad:
            raise ValueError(f"privilege {', '.join(bad)} not valid for {kind}")
        return sql.SQL(", ").join(sql.SQL(p) for p in names)

    async def target(self, ref: ObjectRef) -> sql.Composable:
        kw = OBJECT_KEYWORD[ref.kind]
        if ref.kind == "database":
            if not ref.name:
                raise ValueError("database name is required")
            return sql.SQL("DATABASE {}").format(sql.Identifier(ref.name))
        if ref.kind == "schema":
            if not ref.name:
                raise ValueError("schema name is required")
            return sql.SQL("SCHEMA {}").format(sql.Identifier(ref.name))
        if not ref.schema_name:
            raise ValueError("schema is required")
        if ref.all_in_schema:
            return sql.SQL("ALL {} IN SCHEMA {}").format(
                sql.SQL(ALL_IN_SCHEMA_KEYWORD[ref.kind]), sql.Identifier(ref.schema_name)
            )
        if not ref.name:
            raise ValueError("object name is required")
        if ref.kind == "function":
            args = await self._function_args(ref.schema_name, ref.name, ref.args or "")
            return sql.SQL("{} {}({})").format(
                sql.SQL(kw), sql.Identifier(ref.schema_name, ref.name), sql.SQL(args)
            )
        return sql.SQL("{} {}").format(sql.SQL(kw), sql.Identifier(ref.schema_name, ref.name))

    async def _function_args(self, schema: str, name: str, args: str) -> str:
        # Only ever embed the identity argument list as PostgreSQL itself renders it.
        cur = await self.conn.execute(
            """
            SELECT pg_get_function_identity_arguments(p.oid) AS args
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = %s AND p.proname = %s
              AND pg_get_function_identity_arguments(p.oid) = %s
            """,
            (schema, name, args),
        )
        row = await cur.fetchone()
        if row is None:
            raise ValueError(f"function {schema}.{name}({args}) not found")
        return row["args"]

    def role_options(self, a: RoleAttributes) -> tuple[sql.Composable, sql.Composable]:
        """Return (real, preview) option lists; the preview redacts the password."""
        flags = {
            "superuser": "SUPERUSER",
            "createdb": "CREATEDB",
            "createrole": "CREATEROLE",
            "inherit": "INHERIT",
            "login": "LOGIN",
            "replication": "REPLICATION",
            "bypassrls": "BYPASSRLS",
        }
        parts: list[sql.Composable] = []
        preview: list[sql.Composable] = []
        for field, kw in flags.items():
            v = getattr(a, field)
            if v is not None:
                s = sql.SQL(kw if v else "NO" + kw)
                parts.append(s)
                preview.append(s)
        if a.connlimit is not None:
            s = sql.SQL("CONNECTION LIMIT {}").format(sql.Literal(a.connlimit))
            parts.append(s)
            preview.append(s)
        if a.valid_until is not None:
            v = a.valid_until.strip() or "infinity"
            s = sql.SQL("VALID UNTIL {}").format(sql.Literal(v))
            parts.append(s)
            preview.append(s)
        if a.password is not None:
            pw = a.password.get_secret_value()
            if pw == "":
                s = sql.SQL("PASSWORD NULL")
                parts.append(s)
                preview.append(s)
            else:
                parts.append(sql.SQL("PASSWORD {}").format(sql.Literal(pw)))
                preview.append(sql.SQL("PASSWORD {}").format(sql.Literal(REDACTED)))
        if a.superuser:
            self.warnings.append("Granting SUPERUSER gives unrestricted access to the instance")
        return sql.SQL(" ").join(parts), sql.SQL(" ").join(preview)

    def stmt(self, real: sql.Composable, description: str, preview: sql.Composable | None = None):
        real_c = real if isinstance(real, sql.Composed) else sql.Composed([real])
        text = (preview or real).as_string(self.conn)
        return Statement(sql=real_c, preview=text, description=description)

    # -- operations ------------------------------------------------------------------------
    async def render(self, op: Change) -> list[Statement]:
        match op:
            case GrantOp():
                return [await self.grant(op)]
            case RevokeOp():
                return [await self.revoke(op)]
            case GrantRoleOp():
                return [self.grant_role(op)]
            case RevokeRoleOp():
                return [self.revoke_role(op)]
            case AlterRoleOp():
                return [self.alter_role(op)]
            case CreateRoleOp():
                return self.create_role(op)
            case DropRoleOp():
                return self.drop_role(op)
            case AlterRoleConfigOp():
                return [self.alter_role_config(op)]
            case AlterDefaultOp():
                return [self.alter_default(op)]
        raise ValueError(f"unsupported operation {op!r}")  # pragma: no cover

    async def grant(self, op: GrantOp) -> Statement:
        q = sql.SQL("GRANT {} ON {} TO {}").format(
            self.privs(op.kind, op.privileges), await self.target(op), self.grantee(op.grantee)
        )
        if op.grant_option:
            q += sql.SQL(" WITH GRANT OPTION")
        if op.grantee.upper() == "PUBLIC":
            self.warnings.append(f"Granting to PUBLIC affects every role ({op.kind} {op.name})")
        return self.stmt(q, f"Grant {', '.join(op.privileges)} on {_label(op)} to {op.grantee}")

    async def revoke(self, op: RevokeOp) -> Statement:
        q = sql.SQL("REVOKE ")
        if op.grant_option_only:
            q += sql.SQL("GRANT OPTION FOR ")
        q += sql.SQL("{} ON {} FROM {}").format(
            self.privs(op.kind, op.privileges), await self.target(op), self.grantee(op.grantee)
        )
        if op.cascade:
            q += sql.SQL(" CASCADE")
            self.warnings.append(
                f"REVOKE … CASCADE on {_label(op)} also revokes privileges re-granted by "
                f"{op.grantee}"
            )
        return self.stmt(q, f"Revoke {', '.join(op.privileges)} on {_label(op)} from {op.grantee}")

    def grant_role(self, op: GrantRoleOp) -> Statement:
        q = sql.SQL("GRANT {} TO {}").format(sql.Identifier(op.role), sql.Identifier(op.member))
        opts: list[sql.Composable] = []
        if self.version >= 160000:
            for field, kw in (
                ("admin_option", "ADMIN"),
                ("inherit_option", "INHERIT"),
                ("set_option", "SET"),
            ):
                v = getattr(op, field)
                if v is not None:
                    opts.append(sql.SQL(f"{kw} {'TRUE' if v else 'FALSE'}"))
            if opts:
                q += sql.SQL(" WITH ") + sql.SQL(", ").join(opts)
        elif op.admin_option:
            q += sql.SQL(" WITH ADMIN OPTION")
        if op.role.startswith("pg_") or op.role == "pg_signal_backend":
            self.warnings.append(f"{op.role} is a predefined role with elevated capabilities")
        return self.stmt(q, f"Add {op.member} to role {op.role}")

    def revoke_role(self, op: RevokeRoleOp) -> Statement:
        q = sql.SQL("REVOKE ")
        if op.option_only:
            if op.option_only != "admin" and self.version < 160000:
                raise ValueError(f"{op.option_only} option requires PostgreSQL 16 or newer")
            q += sql.SQL(f"{op.option_only.upper()} OPTION FOR ")
        q += sql.SQL("{} FROM {}").format(sql.Identifier(op.role), sql.Identifier(op.member))
        what = f"{op.option_only} option on" if op.option_only else "membership in"
        return self.stmt(q, f"Revoke {what} {op.role} from {op.member}")

    def alter_role(self, op: AlterRoleOp) -> Statement:
        if op.attributes.is_empty():
            raise ValueError("no attributes to change")
        real, preview = self.role_options(op.attributes)
        head = sql.SQL("ALTER ROLE {} WITH ").format(sql.Identifier(op.role))
        return self.stmt(head + real, f"Alter role {op.role}", head + preview)

    def create_role(self, op: CreateRoleOp) -> list[Statement]:
        head = sql.SQL("CREATE ROLE {}").format(sql.Identifier(op.name))
        out: list[Statement] = []
        if op.attributes.is_empty():
            out.append(self.stmt(head, f"Create role {op.name}"))
        else:
            real, preview = self.role_options(op.attributes)
            out.append(
                self.stmt(
                    head + sql.SQL(" WITH ") + real,
                    f"Create role {op.name}",
                    head + sql.SQL(" WITH ") + preview,
                )
            )
        for role in op.member_of:
            out.append(self.grant_role(GrantRoleOp(op="grant_role", role=role, member=op.name)))
        return out

    def drop_role(self, op: DropRoleOp) -> list[Statement]:
        out: list[Statement] = []
        if op.reassign_to:
            out.append(
                self.stmt(
                    sql.SQL("REASSIGN OWNED BY {} TO {}").format(
                        sql.Identifier(op.name), sql.Identifier(op.reassign_to)
                    ),
                    f"Reassign objects owned by {op.name} to {op.reassign_to}",
                )
            )
        if op.reassign_to or op.drop_owned:
            out.append(
                self.stmt(
                    sql.SQL("DROP OWNED BY {}").format(sql.Identifier(op.name)),
                    f"Drop remaining objects and privileges of {op.name} in this database",
                )
            )
            self.warnings.append(
                "REASSIGN/DROP OWNED only affects the current database; repeat in other "
                "databases if the role owns objects there"
            )
        out.append(
            self.stmt(
                sql.SQL("DROP ROLE {}").format(sql.Identifier(op.name)), f"Drop role {op.name}"
            )
        )
        self.warnings.append(f"Dropping role {op.name} cannot be undone")
        return out

    def alter_role_config(self, op: AlterRoleConfigOp) -> Statement:
        head = sql.SQL("ALTER ROLE {}").format(sql.Identifier(op.role))
        if op.database:
            head += sql.SQL(" IN DATABASE {}").format(sql.Identifier(op.database))
        if op.value is None:
            q = head + sql.SQL(" RESET {}").format(sql.Identifier(op.name))
            return self.stmt(q, f"Reset {op.name} for {op.role}")
        q = head + sql.SQL(" SET {} TO {}").format(sql.Identifier(op.name), sql.Literal(op.value))
        return self.stmt(q, f"Set {op.name} for {op.role}")

    def alter_default(self, op: AlterDefaultOp) -> Statement:
        q = sql.SQL("ALTER DEFAULT PRIVILEGES")
        if op.for_role:
            q += sql.SQL(" FOR ROLE {}").format(sql.Identifier(op.for_role))
        if op.schema_name:
            q += sql.SQL(" IN SCHEMA {}").format(sql.Identifier(op.schema_name))
        privs = self.privs(op.object_type, op.privileges)
        kw = sql.SQL(DEFAULT_KEYWORD[op.object_type])
        if op.action == "grant":
            q += sql.SQL(" GRANT {} ON {} TO {}").format(privs, kw, self.grantee(op.grantee))
            if op.grant_option:
                q += sql.SQL(" WITH GRANT OPTION")
        else:
            q += sql.SQL(" REVOKE {} ON {} FROM {}").format(privs, kw, self.grantee(op.grantee))
        scope = f" in schema {op.schema_name}" if op.schema_name else ""
        who = f" created by {op.for_role}" if op.for_role else ""
        return self.stmt(
            q,
            f"{op.action.capitalize()} default {', '.join(op.privileges)} on future "
            f"{op.object_type}{who}{scope} for {op.grantee}",
        )


def _label(ref: ObjectRef) -> str:
    if ref.all_in_schema:
        return f"all {ALL_IN_SCHEMA_KEYWORD[ref.kind].lower()} in schema {ref.schema_name}"
    if ref.kind in ("database", "schema"):
        return f"{ref.kind} {ref.name}"
    name = f"{ref.schema_name}.{ref.name}"
    if ref.kind == "function":
        name += f"({ref.args or ''})"
    return f"{ref.kind} {name}"


@dataclass
class Plan:
    statements: list[Statement]
    warnings: list[str]
    server_version_num: int

    def to_dict(self) -> dict:
        return {
            "statements": [
                {"sql": s.preview, "description": s.description} for s in self.statements
            ],
            "warnings": self.warnings,
            "server_version_num": self.server_version_num,
        }


async def build_plan(conn: AsyncConnection, changes: ChangeSet, version: int) -> Plan:
    r = _Renderer(conn, version)
    statements: list[Statement] = []
    for i, op in enumerate(changes.operations):
        try:
            statements.extend(await r.render(op))
        except ValueError as e:
            raise PlanError(i, str(e)) from e
    return Plan(
        statements=statements, warnings=list(dict.fromkeys(r.warnings)), server_version_num=version
    )


@dataclass
class ApplyResult:
    ok: bool
    executed: int
    error: str | None = None
    failed_index: int | None = None


async def apply_plan(conn: AsyncConnection, plan: Plan) -> ApplyResult:
    """Execute all statements in one transaction; any failure rolls everything back."""
    import psycopg

    executed = 0
    try:
        async with conn.transaction():
            for i, stmt in enumerate(plan.statements):
                try:
                    await conn.execute(stmt.sql)
                except psycopg.Error as e:
                    msg = e.diag.message_primary if isinstance(e, psycopg.errors.Error) else str(e)
                    detail = e.diag.message_detail if isinstance(e, psycopg.errors.Error) else None
                    text = f"{msg}. {detail}" if detail else (msg or str(e))
                    return ApplyResult(ok=False, executed=executed, error=text, failed_index=i)
                executed += 1
    except psycopg.Error as e:  # pragma: no cover - commit failure
        return ApplyResult(ok=False, executed=0, error=str(e))
    return ApplyResult(ok=True, executed=executed)
