from httpx import AsyncClient


async def test_health(client: AsyncClient):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_requires_auth(client: AsyncClient):
    assert (await client.get("/api/auth/me")).status_code == 401
    assert (await client.get("/api/profiles")).status_code == 401


async def test_login_bad_password(client: AsyncClient):
    r = await client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    assert r.status_code == 401


async def test_login_logout(admin: AsyncClient):
    me = await admin.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"id": 1, "username": "admin", "role": "admin"}
    assert (await admin.post("/api/auth/logout")).status_code == 204
    assert (await admin.get("/api/auth/me")).status_code == 401


async def test_csrf_rejects_cross_site(admin: AsyncClient):
    r = await admin.post("/api/auth/logout", headers={"sec-fetch-site": "cross-site"})
    assert r.status_code == 403
    r = await admin.post("/api/auth/logout", headers={"origin": "http://evil.test"})
    assert r.status_code == 403


async def test_profile_crud(admin: AsyncClient):
    body = {
        "name": "local",
        "host": "127.0.0.1",
        "port": 7416,
        "database": "postgres",
        "username": "postgres",
        "password": "secret",
    }
    r = await admin.post("/api/profiles", json=body)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["has_password"] is True
    assert "password" not in created
    pid = created["id"]

    # duplicate name
    assert (await admin.post("/api/profiles", json=body)).status_code == 409

    r = await admin.get("/api/profiles")
    assert [p["name"] for p in r.json()] == ["local"]

    # update without touching password keeps it
    upd = {**body, "port": 7417}
    upd.pop("password")
    r = await admin.put(f"/api/profiles/{pid}", json=upd)
    assert r.status_code == 200
    assert r.json()["port"] == 7417 and r.json()["has_password"] is True

    # empty string clears password
    r = await admin.put(f"/api/profiles/{pid}", json={**upd, "password": ""})
    assert r.json()["has_password"] is False

    assert (await admin.delete(f"/api/profiles/{pid}")).status_code == 204
    assert (await admin.get(f"/api/profiles/{pid}")).status_code == 404


async def test_profile_test_unreachable(admin: AsyncClient):
    r = await admin.post(
        "/api/profiles/test",
        json={"name": "x", "host": "127.0.0.1", "port": 1, "username": "u", "connect_timeout": 2},
    )
    assert r.status_code == 502
    assert "detail" in r.json()
