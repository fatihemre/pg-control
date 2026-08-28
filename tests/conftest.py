import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session", autouse=True)
def _env(tmp_path_factory: pytest.TempPathFactory) -> None:
    data_dir: Path = tmp_path_factory.mktemp("data")
    os.environ["PGCONTROL_SECRET_KEY"] = "test-secret-key-that-is-long-enough"
    os.environ["PGCONTROL_ADMIN_PASSWORD"] = "admin-pass"
    os.environ["PGCONTROL_DATA_DIR"] = str(data_dir)
    os.environ["PGCONTROL_STATIC_DIR"] = str(data_dir / "no-static")


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
