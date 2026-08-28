"""Unit tests for SQL rendering of change operations (no database needed)."""

import pytest
from pydantic import ValidationError

from pgcontrol.pg.changes import ChangeSet, PlanError, build_plan


async def plan(version: int, *ops: dict):
    # Non-function operations never touch the connection, so None works as a context.
    return await build_plan(None, ChangeSet(database="db", operations=list(ops)), version)


def sqls(p) -> list[str]:
    return [s.preview for s in p.statements]


async def test_grant_quotes_identifiers_and_validates_privileges():
    p = await plan(
        140000,
        {
            "op": "grant",
            "kind": "table",
            "schema": "we ird",
            "name": 'q"t',
            "grantee": "PUBLIC",
            "privileges": ["select", "INSERT"],
            "grant_option": True,
        },
    )
    assert sqls(p) == ['GRANT SELECT, INSERT ON TABLE "we ird"."q""t" TO PUBLIC WITH GRANT OPTION']
    assert any("PUBLIC" in w for w in p.warnings)


async def test_privilege_not_valid_for_kind():
    with pytest.raises(PlanError) as e:
        await plan(
            140000,
            {
                "op": "grant",
                "kind": "sequence",
                "schema": "s",
                "name": "q",
                "grantee": "r",
                "privileges": ["INSERT"],
            },
        )
    assert e.value.index == 0 and "INSERT" in e.value.message


async def test_maintain_only_on_pg17():
    op = {
        "op": "grant",
        "kind": "table",
        "schema": "s",
        "name": "t",
        "grantee": "r",
        "privileges": ["MAINTAIN"],
    }
    with pytest.raises(PlanError):
        await plan(160000, op)
    assert sqls(await plan(170000, op)) == ['GRANT MAINTAIN ON TABLE "s"."t" TO "r"']


async def test_membership_options_by_version():
    op = {
        "op": "grant_role",
        "role": "a",
        "member": "b",
        "admin_option": True,
        "inherit_option": False,
    }
    assert sqls(await plan(150000, op)) == ['GRANT "a" TO "b" WITH ADMIN OPTION']
    assert sqls(await plan(160000, op)) == ['GRANT "a" TO "b" WITH ADMIN TRUE, INHERIT FALSE']
    with pytest.raises(PlanError):
        await plan(150000, {"op": "revoke_role", "role": "a", "member": "b", "option_only": "set"})


async def test_password_is_redacted_in_preview():
    p = await plan(
        140000,
        {"op": "alter_role", "role": "u", "attributes": {"password": "hunter2", "login": True}},
    )
    assert sqls(p) == ["ALTER ROLE \"u\" WITH LOGIN PASSWORD '********'"]
    assert "hunter2" in p.statements[0].sql.as_string(None)
    assert "hunter2" not in p.statements[0].preview


async def test_create_and_drop_role():
    p = await plan(
        140000,
        {
            "op": "create_role",
            "name": "n",
            "attributes": {"login": True, "connlimit": 3},
            "member_of": ["r1"],
        },
        {"op": "drop_role", "name": "n", "reassign_to": "postgres"},
    )
    assert sqls(p) == [
        'CREATE ROLE "n" WITH LOGIN CONNECTION LIMIT 3',
        'GRANT "r1" TO "n"',
        'REASSIGN OWNED BY "n" TO "postgres"',
        'DROP OWNED BY "n"',
        'DROP ROLE "n"',
    ]


async def test_alter_role_config_and_defaults():
    p = await plan(
        140000,
        {"op": "alter_role_config", "role": "r", "name": "search_path", "value": "a, b"},
        {"op": "alter_role_config", "role": "r", "name": "search_path", "database": "d"},
        {
            "op": "alter_default",
            "action": "revoke",
            "schema": "s",
            "object_type": "functions",
            "grantee": "PUBLIC",
            "privileges": ["EXECUTE"],
        },
    )
    assert sqls(p) == [
        'ALTER ROLE "r" SET "search_path" TO \'a, b\'',
        'ALTER ROLE "r" IN DATABASE "d" RESET "search_path"',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA "s" REVOKE EXECUTE ON ROUTINES FROM PUBLIC',
    ]


def test_rejects_unknown_fields_and_empty_privileges():
    with pytest.raises(ValidationError):
        ChangeSet(
            operations=[
                {
                    "op": "grant",
                    "kind": "schema",
                    "name": "s",
                    "grantee": "r",
                    "privileges": [],
                    "bogus": 1,
                }
            ]
        )
    with pytest.raises(ValidationError):
        ChangeSet(operations=[])


async def test_config_and_extension_statements():
    p = await plan(
        160000,
        {"op": "alter_system", "name": "pg_stat_statements.max", "value": "5000"},
        {"op": "alter_system", "name": "work_mem"},
        {"op": "reload_conf"},
        {"op": "alter_database_config", "database": "app", "name": "search_path", "value": "a, b"},
        {"op": "alter_database_config", "database": "app", "name": "search_path"},
        {"op": "create_extension", "name": "pgcrypto", "schema": "ext", "version": "1.3"},
        {"op": "update_extension", "name": "pgcrypto", "version": "1.4"},
        {"op": "drop_extension", "name": "pgcrypto", "cascade": True},
    )
    assert sqls(p) == [
        'ALTER SYSTEM SET "pg_stat_statements"."max" TO \'5000\'',
        'ALTER SYSTEM RESET "work_mem"',
        "SELECT pg_reload_conf()",
        'ALTER DATABASE "app" SET "search_path" TO \'a, b\'',
        'ALTER DATABASE "app" RESET "search_path"',
        'CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA "ext" VERSION \'1.3\'',
        "ALTER EXTENSION \"pgcrypto\" UPDATE TO '1.4'",
        'DROP EXTENSION "pgcrypto" CASCADE',
    ]
    assert not p.atomic and p.to_dict()["atomic"] is False
    assert any("ALTER SYSTEM" in w for w in p.warnings)
    assert any("CASCADE" in w for w in p.warnings)


async def test_plan_without_alter_system_is_atomic():
    p = await plan(140000, {"op": "reload_conf"})
    assert p.atomic


async def test_invalid_guc_name_rejected():
    with pytest.raises(PlanError):
        await plan(140000, {"op": "alter_system", "name": "a..b", "value": "1"})
