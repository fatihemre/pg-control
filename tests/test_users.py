from httpx import AsyncClient


async def test_user_management(admin: AsyncClient):
    r = await admin.get("/api/users")
    assert r.status_code == 200
    me = next(u for u in r.json() if u["username"] == "admin")
    assert me["has_password"] is True and me["auth_provider"] == "local"
    # the test DB is shared with other modules (e.g. OIDC users): make admin the only admin
    for u in r.json():
        if u["role"] == "admin" and u["id"] != me["id"]:
            r2 = await admin.put(f"/api/users/{u['id']}", json={"role": "viewer"})
            assert r2.status_code == 200

    r = await admin.post(
        "/api/users", json={"username": "bob", "password": "bob-pass-123", "role": "operator"}
    )
    assert r.status_code == 201, r.text
    bob = r.json()
    assert bob["role"] == "operator" and bob["auth_provider"] == "local"
    assert (
        await admin.post(
            "/api/users", json={"username": "bob", "password": "bob-pass-123", "role": "viewer"}
        )
    ).status_code == 409
    assert (
        await admin.post(
            "/api/users", json={"username": "x", "password": "short", "role": "viewer"}
        )
    ).status_code == 422
    assert (
        await admin.post(
            "/api/users", json={"username": "y", "password": "long-enough-1", "role": "god"}
        )
    ).status_code == 422

    # last-admin protection
    assert (await admin.put(f"/api/users/{me['id']}", json={"role": "viewer"})).status_code == 400
    assert (await admin.delete(f"/api/users/{me['id']}")).status_code == 400

    r = await admin.put(
        f"/api/users/{bob['id']}", json={"role": "admin", "password": "new-pass-456"}
    )
    assert r.status_code == 200 and r.json()["role"] == "admin"
    # now admin may be demoted since bob is an admin too
    assert (await admin.put(f"/api/users/{me['id']}", json={"role": "operator"})).status_code == 200
    assert (await admin.put(f"/api/users/{me['id']}", json={"role": "admin"})).status_code == 403
    # bob logs in with the new password and restores admin
    bobc = admin  # same cookie jar; re-login replaces the session cookie
    await bobc.post("/api/auth/logout")
    r = await bobc.post("/api/auth/login", json={"username": "bob", "password": "new-pass-456"})
    assert r.status_code == 200
    assert (await bobc.put(f"/api/users/{me['id']}", json={"role": "admin"})).status_code == 200
    # self password change
    r = await bobc.post(
        "/api/users/me/password",
        json={"current_password": "wrong", "new_password": "another-pass-1"},
    )
    assert r.status_code == 400
    r = await bobc.post(
        "/api/users/me/password",
        json={"current_password": "new-pass-456", "new_password": "another-pass-1"},
    )
    assert r.status_code == 204
    await bobc.post("/api/auth/logout")
    assert (
        await bobc.post("/api/auth/login", json={"username": "bob", "password": "another-pass-1"})
    ).status_code == 200
    # delete bob as admin
    await bobc.post("/api/auth/logout")
    await bobc.post("/api/auth/login", json={"username": "admin", "password": "admin-pass"})
    assert (await bobc.delete(f"/api/users/{bob['id']}")).status_code == 204
    assert "bob" not in [u["username"] for u in (await bobc.get("/api/users")).json()]


async def test_users_requires_admin(admin: AsyncClient):
    await admin.post(
        "/api/users", json={"username": "v", "password": "viewer-pass-1", "role": "viewer"}
    )
    await admin.post("/api/auth/logout")
    await admin.post("/api/auth/login", json={"username": "v", "password": "viewer-pass-1"})
    assert (await admin.get("/api/users")).status_code == 403
