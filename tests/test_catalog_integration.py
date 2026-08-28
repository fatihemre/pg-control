"""Integration tests against the dev PostgreSQL containers (docker-compose.dev.yml).

Skipped automatically when the instances are not reachable.
"""

import socket

import psycopg
import pytest
from psycopg.rows import dict_row

from pgcontrol.pg.catalog import privileges, roles
from pgcontrol.pg.catalog.common import server_version_num

PORTS = {14: 7414, 15: 7415, 16: 7416, 17: 7417, 18: 7418}


def _reachable(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


AVAILABLE = [v for v, p in PORTS.items() if _reachable(p)]
pytestmark = pytest.mark.skipif(not AVAILABLE, reason="dev PostgreSQL containers not running")


@pytest.fixture(params=AVAILABLE, ids=lambda v: f"pg{v}")
async def conn(request):
    async with await psycopg.AsyncConnection.connect(
        host="127.0.0.1",
        port=PORTS[request.param],
        dbname="reservations",
        user="postgres",
        password="postgres",
        row_factory=dict_row,
        autocommit=True,
    ) as c:
        yield c


def privs(obj) -> dict[str, bool]:
    return {p.name: p.granted for p in obj.privileges}


def find(result, schema: str, name: str):
    return next(o for o in result.objects if o.schema == schema and o.name == name)


async def test_list_roles(conn):
    all_roles = {r.name: r for r in await roles.list_roles(conn)}
    api = all_roles["reservation_api"]
    assert api.canlogin and api.member_of == ["reservation_read"]
    assert api.config == ["search_path=sch_reservation, public"]
    assert api.connlimit == 20
    assert all_roles["locked_out"].expired
    assert not all_roles["reporting"].inherit
    assert all_roles["reservation_read"].members == [
        "reporting",
        "reservation_api",
        "reservation_write",
    ]


async def test_role_detail_closure(conn):
    d = await roles.get_role_detail(conn, "reservation_admin")
    assert d is not None
    chain = {e.name: e.path for e in d.inherits_from}
    assert chain["reservation_read"] == [
        "reservation_admin",
        "reservation_write",
        "reservation_read",
    ]
    assert all(e.inherited for e in d.inherits_from)
    read = await roles.get_role_detail(conn, "reservation_read")
    assert {e.name for e in read.inherited_by} == {
        "reporting",
        "reservation_api",
        "reservation_write",
        "reservation_admin",
    }
    reporting = next(e for e in read.inherited_by if e.name == "reporting")
    assert reporting.inherited is False


async def test_unknown_role(conn):
    assert await roles.get_role_detail(conn, "nope") is None
    assert await privileges.effective_privileges(conn, "nope") is None


async def test_effective_reservation_api(conn):
    r = await privileges.effective_privileges(conn, "reservation_api")
    assert privs(r.database_privileges)["CONNECT"] is True
    connect = r.database_privileges.privileges[0]
    assert connect.sources[0].grantee == "reservation_read"
    assert connect.sources[0].via == ["reservation_read"]

    res = find(r, "sch_reservation", "reservations")
    assert privs(res)["SELECT"] is True and privs(res)["INSERT"] is False
    assert res.blockers == []
    assert res.rls_enabled and [p.name for p in res.policies] == ["own_rows"]

    inv = find(r, "sch_billing", "invoices")
    assert privs(inv)["SELECT"] is False
    assert {c.column for c in inv.column_grants} == {"id", "amount"}
    assert inv.blockers == ["No USAGE on schema sch_billing"]

    fn = find(r, "sch_reservation", "room_count()")
    assert privs(fn)["EXECUTE"] is True
    assert fn.privileges[0].sources[0].grantee == "PUBLIC"

    assert [(d.for_role, d.schema, d.object_type, d.privilege) for d in r.default_privileges] == [
        ("reservation_owner", "sch_reservation", "tables", "SELECT")
    ]


async def test_effective_noinherit(conn):
    r = await privileges.effective_privileges(conn, "reporting", schema="sch_reservation")
    assert r.membership[0].name == "reservation_read" and r.membership[0].inherited is False
    assert privs(r.database_privileges)["CONNECT"] is False
    assert any("SET ROLE" in w for w in r.warnings)
    res = find(r, "sch_reservation", "reservations")
    assert privs(res)["SELECT"] is False
    assert "No CONNECT on database reservations" in res.blockers


async def test_effective_owner_chain(conn):
    r = await privileges.effective_privileges(conn, "reservation_admin", schema="sch_billing")
    inv = find(r, "sch_billing", "invoices")
    assert inv.is_owner and all(privs(inv).values())
    src = inv.privileges[0].sources[0]
    assert src.kind == "owner" and src.via == ["reservation_owner"]


async def test_effective_superuser_and_public_schema(conn):
    r = await privileges.effective_privileges(conn, "postgres", schema="public")
    assert any("Superuser" in w for w in r.warnings)
    public = r.schemas[0]
    assert privs(public) == {"USAGE": True, "CREATE": True}
    version = r.server_version_num
    r2 = await privileges.effective_privileges(conn, "reservation_api", schema="public")
    # PG15 revoked CREATE on schema public from PUBLIC
    assert privs(r2.schemas[0])["CREATE"] is (version < 150000)


async def test_table_privilege_list_by_version(conn):
    r = await privileges.effective_privileges(conn, "reservation_api", schema="sch_reservation")
    names = [p.name for p in find(r, "sch_reservation", "rooms").privileges]
    assert ("MAINTAIN" in names) is (r.server_version_num >= 170000)


async def test_list_grants(conn):
    from pgcontrol.pg.catalog import grants

    inv = next(
        g for g in await grants.list_grants(conn, "table", "sch_billing") if g.name == "invoices"
    )
    assert inv.owner == "reservation_owner"
    db = next(g for g in await grants.list_grants(conn, "database") if g.name == "reservations")
    assert ("reservation_read", "CONNECT") in {(g.grantee, g.privilege) for g in db.grants}
    fn = (await grants.list_grants(conn, "function", "sch_reservation"))[0]
    assert (fn.name, fn.args) == ("room_count", "")
    assert "PUBLIC" in {g.grantee for g in fn.grants}


async def test_apply_rolls_back_on_failure(conn):
    from pgcontrol.pg.changes import ChangeSet, apply_plan, build_plan

    version = (await privileges.effective_privileges(conn, "reporting")).server_version_num
    good = {
        "op": "grant",
        "kind": "table",
        "schema": "sch_reservation",
        "name": "rooms",
        "grantee": "reporting",
        "privileges": ["TRIGGER"],
    }
    bad = dict(good, name="missing")
    plan = await build_plan(conn, ChangeSet(operations=[good, bad]), version)
    result = await apply_plan(conn, plan)
    assert not result.ok and result.failed_index == 1 and "missing" in result.error
    r = await privileges.effective_privileges(conn, "reporting", schema="sch_reservation")
    assert privs(find(r, "sch_reservation", "rooms"))["TRIGGER"] is False

    plan = await build_plan(conn, ChangeSet(operations=[good]), version)
    assert (await apply_plan(conn, plan)).ok
    r = await privileges.effective_privileges(conn, "reporting", schema="sch_reservation")
    rooms = find(r, "sch_reservation", "rooms")
    # reporting has no CONNECT, so the grant is present but still blocked
    assert rooms.privileges[[p.name for p in rooms.privileges].index("TRIGGER")].sources
    undo = await build_plan(conn, ChangeSet(operations=[dict(good, op="revoke")]), version)
    assert (await apply_plan(conn, undo)).ok


async def test_config_catalog(conn):
    from pgcontrol.pg.catalog import config

    version = await server_version_num(conn)
    settings = {s.name: s for s in await config.list_settings(conn)}
    assert settings["max_connections"].context == "postmaster"
    assert settings["work_mem"].unit == "kB"
    overrides = await config.list_role_db_settings(conn)
    assert any(o.role == "reservation_api" and o.name == "search_path" for o in overrides)
    hba = await config.list_hba_rules(conn, version)
    assert hba and all(r.error is None for r in hba)
    if version >= 160000:
        assert hba[0].rule_number == 1
    files = await config.list_file_settings(conn)
    assert files is not None and any(f.name == "max_connections" for f in files)
    exts = {e.name: e for e in await config.list_extensions(conn, version)}
    assert exts["plpgsql"].installed_version == "1.0"
    assert exts["pgcrypto"].installed_version is None and exts["pgcrypto"].versions


async def test_alter_system_and_extension_apply(conn):
    from pgcontrol.pg.catalog import config
    from pgcontrol.pg.changes import ChangeSet, apply_plan, build_plan

    version = await server_version_num(conn)
    ops = [
        {"op": "alter_system", "name": "work_mem", "value": "8MB"},
        {"op": "reload_conf"},
        {"op": "create_extension", "name": "pgcrypto", "schema": "public"},
    ]
    p = await build_plan(conn, ChangeSet(operations=ops), version)
    assert not p.atomic
    assert (await apply_plan(conn, p)).ok
    exts = {e.name: e for e in await config.list_extensions(conn, version)}
    assert exts["pgcrypto"].installed_version and exts["pgcrypto"].schema == "public"
    row = await (
        await conn.execute("SELECT * FROM pg_file_settings WHERE name = 'work_mem'")
    ).fetchone()
    assert row and row["setting"] == "8MB" and row["sourcefile"].endswith("postgresql.auto.conf")

    undo = [
        {"op": "alter_system", "name": "work_mem"},
        {"op": "reload_conf"},
        {"op": "drop_extension", "name": "pgcrypto"},
    ]
    assert (await apply_plan(conn, await build_plan(conn, ChangeSet(operations=undo), version))).ok
    row = await (
        await conn.execute("SELECT * FROM pg_file_settings WHERE name = 'work_mem'")
    ).fetchone()
    assert row is None


async def test_ownership_listing(conn):
    from pgcontrol.pg.catalog import ownership

    objs = await ownership.list_owned_objects(conn)
    by_key = {(o.kind, o.schema, o.name): o.owner for o in objs}
    assert by_key[("schema", None, "sch_billing")] == "reservation_owner"
    assert by_key[("table", "sch_reservation", "reservations")] == "reservation_owner"
    assert by_key[("view", "sch_reservation", "upcoming")] == "reservation_owner"
    assert by_key[("sequence", "sch_reservation", "rooms_id_seq")] == "reservation_owner"
    fn = next(o for o in objs if o.kind == "function" and o.name == "room_count")
    assert fn.args == "" and fn.owner == "reservation_owner"
    assert by_key[("database", None, "reservations")] == "postgres"


async def test_perf_catalog(conn):
    from pgcontrol.pg.catalog import perf

    sessions = await perf.list_activity(conn)
    me = next(s for s in sessions if s.is_self)
    assert me.database == "reservations" and me.state == "active"
    assert me.blocked_by == []
    assert await perf.list_blocked(conn) == []

    tables = {(t.schema, t.name): t for t in await perf.table_stats(conn)}
    assert ("sch_reservation", "reservations") in tables
    assert tables[("sch_reservation", "reservations")].total_bytes >= 0
    assert {t.schema for t in await perf.table_stats(conn, "sch_billing")} == {"sch_billing"}
    idx = {i.name: i for i in await perf.index_stats(conn)}
    assert idx["reservations_pkey"].is_primary and idx["reservations_pkey"].is_valid
    dbs = {d.name: d for d in await perf.database_stats(conn)}
    assert dbs["reservations"].numbackends >= 1 and dbs["reservations"].size_bytes > 0

    stmts = await perf.list_statements(conn)
    if stmts.available:
        assert stmts.rows and all("query" in r for r in stmts.rows)
    else:
        assert stmts.reason


async def test_alter_owner_and_maintenance_apply(conn):
    from pgcontrol.pg.catalog import ownership
    from pgcontrol.pg.changes import ChangeSet, apply_plan, build_plan

    version = await server_version_num(conn)
    ops = [
        {
            "op": "alter_owner",
            "kind": "table",
            "schema": "sch_reservation",
            "name": "rooms",
            "new_owner": "reservation_admin",
        },
        {
            "op": "alter_owner",
            "kind": "function",
            "schema": "sch_reservation",
            "name": "room_count",
            "args": "",
            "new_owner": "reservation_admin",
        },
        {"op": "analyze", "schema": "sch_reservation", "name": "rooms"},
        {"op": "vacuum", "schema": "sch_reservation", "name": "rooms", "analyze": True},
    ]
    p = await build_plan(conn, ChangeSet(operations=ops), version)
    assert (await apply_plan(conn, p)).ok
    owners = {(o.kind, o.name): o.owner for o in await ownership.list_owned_objects(conn)}
    assert owners[("table", "rooms")] == "reservation_admin"
    assert owners[("function", "room_count")] == "reservation_admin"

    undo = [{"op": "reassign_owned", "role": "reservation_admin", "new_owner": "reservation_owner"}]
    assert (await apply_plan(conn, await build_plan(conn, ChangeSet(operations=undo), version))).ok
    owners = {(o.kind, o.name): o.owner for o in await ownership.list_owned_objects(conn)}
    assert owners[("table", "rooms")] == "reservation_owner"
    assert owners[("function", "room_count")] == "reservation_owner"
