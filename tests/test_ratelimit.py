from httpx import AsyncClient

from pgcontrol.security.ratelimit import LoginLimiter


def test_limiter_locks_after_max_attempts():
    lim = LoginLimiter(max_attempts=3, window=60, lockout=120)
    assert lim.retry_after("ip:1") == 0
    assert not lim.record_failure("ip:1", "user:a")
    assert not lim.record_failure("ip:1", "user:a")
    assert lim.record_failure("ip:1", "user:a")  # third failure locks
    assert 0 < lim.retry_after("ip:1") <= 121
    assert lim.retry_after("user:a") > 0
    assert lim.retry_after("user:b") == 0
    lim.reset("user:a")
    assert lim.retry_after("user:a") == 0
    assert lim.retry_after("ip:1") > 0  # the IP stays locked
    lim.clear()
    assert lim.retry_after("ip:1") == 0


def test_limiter_prune():
    lim = LoginLimiter(max_attempts=5, window=60, lockout=60)
    lim.record_failure("ip:x")
    lim.prune()
    assert "ip:x" in lim._buckets
    lim.clear()
    lim.prune()
    assert lim._buckets == {}


async def test_login_lockout(client: AsyncClient):
    from pgcontrol.main import app

    limiter = app.state.login_limiter
    assert limiter is not None
    limiter.clear()
    try:
        for _ in range(limiter.max_attempts):
            r = await client.post("/api/auth/login", json={"username": "admin", "password": "x"})
            assert r.status_code == 401
        # locked now: even the right password is refused until the lockout passes
        r = await client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin-pass"}
        )
        assert r.status_code == 429
        assert int(r.headers["Retry-After"]) > 0
        # and the lockout is visible in the audit log once we can log in again
        limiter.clear()
        r = await client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin-pass"}
        )
        assert r.status_code == 200
        r = await client.get("/api/audit")
        assert r.status_code == 200
        entry = next(e for e in r.json() if e["action"] == "login_locked")
        assert entry["detail"]["username"] == "admin"
        assert "failed attempts" in entry["detail"]["descriptions"][0]
    finally:
        limiter.clear()


async def test_security_headers(client: AsyncClient):
    r = await client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Cache-Control"] == "no-store"
    assert "Content-Security-Policy" not in r.headers
