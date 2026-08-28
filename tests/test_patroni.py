"""Patroni integration against an in-process mock REST API (httpx.MockTransport)."""

import base64
import json

import httpx
import pytest
from httpx import AsyncClient

from pgcontrol.patroni import PatroniClient, PatroniError

BASE = "http://patroni1.test:8008"


class MockPatroni:
    def __init__(self) -> None:
        self.pause = False
        self.scheduled_switchover: dict | None = None
        self.calls: list[tuple[str, str, dict | None]] = []
        self.auth_ok = True
        self.members = [
            {
                "name": "patroni1",
                "role": "leader",
                "state": "running",
                "api_url": f"{BASE}/patroni",
                "host": "patroni1",
                "port": 5432,
                "timeline": 3,
                "pending_restart": True,
            },
            {
                "name": "patroni2",
                "role": "replica",
                "state": "streaming",
                "api_url": "http://patroni2.test:8008/patroni",
                "host": "patroni2",
                "port": 5432,
                "timeline": 3,
                "lag": 0,
                "tags": {"nofailover": False},
            },
            {
                "name": "patroni3",
                "role": "replica",
                "state": "creating replica",
                "api_url": "http://patroni3.test:8008/patroni",
                "host": "patroni3",
                "port": 5432,
                "lag": "unknown",
            },
        ]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, str(request.url), body))
        if request.method == "GET":
            if path == "/cluster":
                out: dict = {"members": self.members, "scope": "pgcontrol-dev"}
                if self.pause:
                    out["pause"] = True
                if self.scheduled_switchover:
                    out["scheduled_switchover"] = self.scheduled_switchover
                return httpx.Response(200, json=out)
            if path == "/patroni":
                return httpx.Response(
                    200,
                    json={
                        "state": "running",
                        "role": "primary",
                        "timeline": 3,
                        "server_version": 160004,
                        "xlog": {"location": 123456},
                        "dcs_last_seen": 1_700_000_000,
                        "pending_restart": True,
                        "patroni": {
                            "version": "4.0.5",
                            "scope": "pgcontrol-dev",
                            "name": "patroni1",
                        },
                        "replication": [{"application_name": "patroni2", "state": "streaming"}],
                    },
                )
            if path == "/config":
                return httpx.Response(200, json={"ttl": 30, "loop_wait": 10, "postgresql": {}})
            if path == "/history":
                return httpx.Response(
                    200,
                    json=[
                        [
                            1,
                            100,
                            "no recovery target specified",
                            "2026-08-29T10:00:00+00:00",
                            "patroni2",
                        ],
                        [2, 200, "x", None],
                    ],
                )
            return httpx.Response(404)
        # unsafe endpoints require basic auth
        auth = request.headers.get("authorization", "")
        expected = "Basic " + base64.b64encode(b"patroni:secret").decode()
        if auth != expected or not self.auth_ok:
            return httpx.Response(401, text="Unauthorized")
        if request.method == "POST" and path == "/switchover":
            if body.get("scheduled_at"):
                self.scheduled_switchover = {
                    "at": body["scheduled_at"],
                    "from": body["leader"],
                    "to": body.get("candidate"),
                }
                return httpx.Response(202, text="Switchover scheduled")
            if body.get("candidate") == "patroni3":
                return httpx.Response(412, text="candidate patroni3 is not healthy")
            return httpx.Response(200, text='Successfully switched over to "patroni2"')
        if request.method == "DELETE" and path == "/switchover":
            self.scheduled_switchover = None
            return httpx.Response(200, text="scheduled switchover deleted")
        if request.method == "POST" and path == "/failover":
            return httpx.Response(200, text='Successfully failed over to "patroni2"')
        if request.method == "PATCH" and path == "/config":
            self.pause = bool(body.get("pause"))
            return httpx.Response(200, json={"ttl": 30, "pause": self.pause})
        if request.method == "POST" and path == "/restart":
            if body.get("restart_pending") and request.url.host == "patroni2.test":
                return httpx.Response(503, text="restart conditions are not satisfied")
            return httpx.Response(200, text="restarted successfully")
        if request.method == "DELETE" and path == "/restart":
            return httpx.Response(200, text="scheduled restart deleted")
        if request.method == "POST" and path == "/reinitialize":
            return httpx.Response(200, text="reinitialize started")
        if request.method == "POST" and path == "/reload":
            return httpx.Response(202, text="reload scheduled")
        return httpx.Response(404)


@pytest.fixture
def mock(admin: AsyncClient) -> MockPatroni:
    from pgcontrol.main import app

    m = MockPatroni()
    app.state.patroni_transport = httpx.MockTransport(m.handler)
    yield m
    app.state.patroni_transport = None


@pytest.fixture
async def profile(admin: AsyncClient, mock: MockPatroni) -> dict:
    r = await admin.post(
        "/api/profiles",
        json={
            "name": "patroni-test",
            "host": "patroni1.test",
            "username": "postgres",
            "patroni_url": f"{BASE}/",
            "patroni_username": "patroni",
            "patroni_password": "secret",
        },
    )
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["patroni_url"] == BASE and p["has_patroni_password"] is True
    assert "patroni_password" not in p and "patroni_password_enc" not in p
    yield p
    await admin.delete(f"/api/profiles/{p['id']}")


async def test_profile_without_patroni(admin: AsyncClient, mock: MockPatroni):
    r = await admin.post("/api/profiles", json={"name": "plain", "host": "h", "username": "u"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert r.json()["patroni_url"] is None
    r = await admin.get(f"/api/profiles/{pid}/patroni")
    assert r.status_code == 400
    # clearing the URL also drops stored Patroni credentials
    r = await admin.put(
        f"/api/profiles/{pid}",
        json={
            "name": "plain",
            "host": "h",
            "username": "u",
            "patroni_url": BASE,
            "patroni_password": "x",
        },
    )
    assert r.json()["has_patroni_password"] is True
    r = await admin.put(
        f"/api/profiles/{pid}",
        json={"name": "plain", "host": "h", "username": "u", "patroni_url": ""},
    )
    assert r.json()["patroni_url"] is None and r.json()["has_patroni_password"] is False
    await admin.delete(f"/api/profiles/{pid}")


async def test_status(admin: AsyncClient, profile: dict, mock: MockPatroni):
    r = await admin.get(f"/api/profiles/{profile['id']}/patroni")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["scope"] == "pgcontrol-dev" and s["leader"] == "patroni1" and s["pause"] is False
    assert s["patroni_version"] == "4.0.5"
    assert [m["name"] for m in s["members"]] == ["patroni1", "patroni2", "patroni3"]
    m1, m2, m3 = s["members"]
    assert m1["pending_restart"] is True and m1["lag"] is None and m1["lag_unknown"] is False
    assert m2["lag"] == 0 and m2["tags"] == {"nofailover": False}
    assert m3["lag"] is None and m3["lag_unknown"] is True and m3["timeline"] is None
    assert s["node"]["name"] == "patroni1" and s["node"]["role"] == "primary"
    assert s["node"]["dcs_last_seen"] == "2023-11-14T22:13:20+00:00"
    assert s["config"]["ttl"] == 30
    assert s["history"][0] == {
        "timeline": 1,
        "lsn": 100,
        "reason": "no recovery target specified",
        "timestamp": "2026-08-29T10:00:00+00:00",
        "new_leader": "patroni2",
    }
    assert s["history"][1]["new_leader"] is None
    # read endpoints never send credentials
    assert all("authorization" not in c[1] for c in mock.calls)


async def test_switchover_and_audit(admin: AsyncClient, profile: dict, mock: MockPatroni):
    pid = profile["id"]
    r = await admin.post(f"/api/profiles/{pid}/patroni/switchover", json={"candidate": "patroni2"})
    assert r.status_code == 200, r.text
    assert r.json()["message"] == 'Successfully switched over to "patroni2"'
    method, url, body = mock.calls[-1]
    assert (method, url) == ("POST", f"{BASE}/switchover")
    assert body == {"leader": "patroni1", "candidate": "patroni2"}

    # to the current leader → rejected before Patroni is called
    r = await admin.post(f"/api/profiles/{pid}/patroni/switchover", json={"candidate": "patroni1"})
    assert r.status_code == 400

    # Patroni refuses → 502 + failed audit entry
    r = await admin.post(f"/api/profiles/{pid}/patroni/switchover", json={"candidate": "patroni3"})
    assert r.status_code == 502
    assert "not healthy" in r.json()["detail"]

    r = await admin.get("/api/audit", params={"profile_id": pid})
    entries = r.json()
    assert [e["action"] for e in entries[:2]] == ["patroni_failed", "patroni"]
    assert entries[0]["detail"]["error"] == "candidate patroni3 is not healthy"
    assert entries[1]["detail"] == {
        "operation": "switchover",
        "target": "patroni2",
        "descriptions": ["Switchover from patroni1 to patroni2"],
        "statements": ["patroni switchover patroni2"],
        "response": 'Successfully switched over to "patroni2"',
        "error": None,
    }


async def test_scheduled_switchover(admin: AsyncClient, profile: dict, mock: MockPatroni):
    pid = profile["id"]
    r = await admin.post(
        f"/api/profiles/{pid}/patroni/switchover",
        json={"candidate": "patroni2", "scheduled_at": "2030-01-01T03:00:00+00:00"},
    )
    assert r.status_code == 200, r.text
    assert mock.calls[-1][2]["scheduled_at"] == "2030-01-01T03:00:00+00:00"
    s = (await admin.get(f"/api/profiles/{pid}/patroni")).json()
    assert s["scheduled_switchover"]["to"] == "patroni2"
    r = await admin.delete(f"/api/profiles/{pid}/patroni/switchover")
    assert r.status_code == 200
    assert mock.scheduled_switchover is None


async def test_member_operations(admin: AsyncClient, profile: dict, mock: MockPatroni):
    pid = profile["id"]
    base = f"/api/profiles/{pid}/patroni/members"
    r = await admin.post(f"{base}/patroni1/restart", json={})
    assert r.status_code == 200 and r.json()["message"] == "restarted successfully"
    # member operations go to the member's own api_url, minus /patroni
    assert mock.calls[-1][1] == f"{BASE}/restart" and mock.calls[-1][2] == {}

    r = await admin.post(f"{base}/patroni2/restart", json={"pending_only": True})
    assert r.status_code == 502 and "not satisfied" in r.json()["detail"]
    assert mock.calls[-1][1] == "http://patroni2.test:8008/restart"
    assert mock.calls[-1][2] == {"restart_pending": True}

    r = await admin.post(f"{base}/patroni2/restart", json={"schedule": "2030-01-01T03:00:00Z"})
    assert r.status_code == 200
    assert mock.calls[-1][2]["schedule"] == "2030-01-01T03:00:00+00:00"
    r = await admin.delete(f"{base}/patroni2/restart")
    assert r.status_code == 200 and mock.calls[-1][0] == "DELETE"

    r = await admin.post(f"{base}/patroni2/reinitialize", json={"force": True})
    assert r.status_code == 200 and mock.calls[-1][2] == {"force": True}
    r = await admin.post(f"{base}/patroni1/reinitialize", json={})
    assert r.status_code == 400  # leader

    r = await admin.post(f"{base}/patroni2/reload")
    assert r.status_code == 200 and r.json()["message"] == "reload scheduled"

    r = await admin.post(f"{base}/nope/reload")
    assert r.status_code == 404

    r = await admin.post(f"{base}/patroni2/failover", json={})
    assert r.status_code in (404, 405)


async def test_failover_pause_and_auth(admin: AsyncClient, profile: dict, mock: MockPatroni):
    pid = profile["id"]
    r = await admin.post(f"/api/profiles/{pid}/patroni/failover", json={"candidate": "patroni2"})
    assert r.status_code == 200 and mock.calls[-1][2] == {"candidate": "patroni2"}
    r = await admin.post(f"/api/profiles/{pid}/patroni/pause", json={"paused": True})
    assert r.status_code == 200 and mock.pause is True
    s = (await admin.get(f"/api/profiles/{pid}/patroni")).json()
    assert s["pause"] is True
    r = await admin.post(f"/api/profiles/{pid}/patroni/pause", json={"paused": False})
    assert r.status_code == 200 and mock.pause is False

    # wrong credentials on the Patroni side
    mock.auth_ok = False
    r = await admin.post(f"/api/profiles/{pid}/patroni/failover", json={"candidate": "patroni2"})
    assert r.status_code == 502 and "Unauthorized" in r.json()["detail"]


async def test_read_only_and_roles(
    client: AsyncClient, admin: AsyncClient, profile: dict, mock: MockPatroni
):
    pid = profile["id"]
    r = await admin.put(
        f"/api/profiles/{pid}",
        json={
            **{
                k: profile[k]
                for k in (
                    "name",
                    "host",
                    "port",
                    "database",
                    "username",
                    "sslmode",
                    "connect_timeout",
                )
            },
            "read_only": True,
            "patroni_url": BASE,
        },
    )
    assert r.status_code == 200, r.text
    r = await admin.post(f"/api/profiles/{pid}/patroni/pause", json={"paused": True})
    assert r.status_code == 403
    assert mock.pause is False

    await admin.post("/api/auth/logout")
    r = await client.get(f"/api/profiles/{pid}/patroni")
    assert r.status_code == 401
    await client.post("/api/auth/login", json={"username": "admin", "password": "admin-pass"})


async def test_client_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cluster":
            return httpx.Response(200, text="<html>not json</html>")
        raise httpx.ConnectError("boom")

    async with PatroniClient(BASE, transport=httpx.MockTransport(handler)) as c:
        with pytest.raises(PatroniError, match="non-JSON"):
            await c.cluster()
        with pytest.raises(PatroniError, match="boom"):
            await c.config()
