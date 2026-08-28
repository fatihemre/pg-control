"""Shared fixtures.

The suite runs against a throwaway SQLite metadata DB by default. Set
``PGCONTROL_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:7416/pgcontrol_test``
to run the same tests with PostgreSQL as the metadata database (the database is created
and wiped at session start).
"""

import os
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from httpx import ASGITransport, AsyncClient


def _reset_postgres(url: str) -> None:
    import psycopg
    from psycopg import sql

    parts = urlsplit(url)
    dbname = parts.path.lstrip("/")
    admin = parts._replace(path="/postgres").geturl().split("://", 1)[1]
    with psycopg.connect(f"postgresql://{admin}", autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone()
        if not exists:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname)))
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")


@pytest.fixture(scope="session", autouse=True)
def _env(tmp_path_factory: pytest.TempPathFactory) -> None:
    data_dir: Path = tmp_path_factory.mktemp("data")
    test_db = os.environ.get("PGCONTROL_TEST_DATABASE_URL")
    if test_db:
        _reset_postgres(test_db)
        os.environ["PGCONTROL_DATABASE_URL"] = test_db
    else:
        os.environ.pop("PGCONTROL_DATABASE_URL", None)
    os.environ["PGCONTROL_SECRET_KEY"] = "test-secret-key-that-is-long-enough"
    os.environ["PGCONTROL_ADMIN_PASSWORD"] = "admin-pass"
    os.environ["PGCONTROL_DATA_DIR"] = str(data_dir)
    os.environ["PGCONTROL_STATIC_DIR"] = str(data_dir / "no-static")
    os.environ["PGCONTROL_METRICS_INTERVAL_SECONDS"] = "0"
    os.environ["PGCONTROL_OIDC_ISSUER"] = "https://idp.test"
    os.environ["PGCONTROL_OIDC_CLIENT_ID"] = "pgcontrol"
    os.environ["PGCONTROL_OIDC_ROLE_CLAIM"] = "groups"
    os.environ["PGCONTROL_OIDC_ROLE_MAP"] = "pg-admins:admin,pg-ops:operator"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from pgcontrol.main import app

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://pgcontrol.test") as c:
            yield c


@pytest.fixture
async def admin(client: AsyncClient) -> AsyncClient:
    r = await client.post("/api/auth/login", json={"username": "admin", "password": "admin-pass"})
    assert r.status_code == 200, r.text
    return client
