"""Integration tests against the dev PostgreSQL containers (docker-compose.dev.yml).

Skipped automatically when the instances are not reachable.
"""

import socket

import psycopg
import pytest
from psycopg.rows import dict_row

from pgcontrol.pg.catalog import privileges, roles

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
