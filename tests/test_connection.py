import asyncio

import psycopg
import pytest

from pgcontrol.pg import connection
from pgcontrol.pg.connection import ConnParams, PoolManager


class _FakeConn:
    async def close(self) -> None:
        pass


class _FakePool:
    def __init__(self, conninfo: str, **_: object) -> None:
        self.conninfo = conninfo
        self.closed = False

    async def open(self) -> None:
        pass

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def fake_pg(monkeypatch):
    """Probe connections to host "slow" block until ``release`` is set."""
    release = asyncio.Event()

    async def connect(conninfo: str, **_: object):
        if "host=slow" in conninfo:
            await release.wait()
        return _FakeConn()

    monkeypatch.setattr(connection.psycopg.AsyncConnection, "connect", connect)
    monkeypatch.setattr(connection, "AsyncConnectionPool", _FakePool)
    return release


def _params(host: str) -> ConnParams:
    return ConnParams(host=host, port=5432, database="postgres", username="u", password=None)


async def test_slow_host_does_not_block_other_profiles(fake_pg):
    pools = PoolManager()
    slow = asyncio.create_task(pools.get(1, _params("slow")))
    await asyncio.sleep(0)
    fast = await asyncio.wait_for(pools.get(2, _params("fast")), timeout=1)
    assert not slow.done()
    assert await pools.get(2, _params("fast")) is fast  # cached
    fake_pg.set()
    assert (await slow).conninfo.startswith("host=slow")


async def test_pool_opened_across_drop_is_discarded(fake_pg):
    pools = PoolManager()
    pending = asyncio.create_task(pools.get(1, _params("slow")))
    await asyncio.sleep(0)
    await asyncio.wait_for(pools.drop(1), timeout=1)  # profile edited while connecting
    fake_pg.set()
    with pytest.raises(psycopg.OperationalError):
        await pending
    fresh = await pools.get(1, _params("slow"))
    assert not fresh.closed
