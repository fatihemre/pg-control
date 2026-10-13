"""Connections to managed PostgreSQL instances (psycopg 3, async)."""

import asyncio
from dataclasses import dataclass

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from pgcontrol.db.models import ConnectionProfile


@dataclass(frozen=True)
class ConnParams:
    host: str
    port: int
    database: str
    username: str
    password: str | None
    sslmode: str = "prefer"
    sslrootcert: str | None = None
    connect_timeout: int = 10

    @classmethod
    def from_profile(cls, profile: ConnectionProfile, password: str | None) -> "ConnParams":
        return cls(
            host=profile.host,
            port=profile.port,
            database=profile.database,
            username=profile.username,
            password=password,
            sslmode=profile.sslmode,
            sslrootcert=profile.sslrootcert,
            connect_timeout=profile.connect_timeout,
        )

    def conninfo(self, dbname: str | None = None) -> str:
        parts: dict[str, object] = {
            "host": self.host,
            "port": self.port,
            "dbname": dbname or self.database,
            "user": self.username,
            "sslmode": self.sslmode,
            "connect_timeout": self.connect_timeout,
            "application_name": "pgcontrol",
        }
        if self.password:
            parts["password"] = self.password
        if self.sslrootcert:
            parts["sslrootcert"] = self.sslrootcert
        return make_conninfo(**parts)


@dataclass
class ServerInfo:
    version: str
    version_num: int
    current_user: str
    is_superuser: bool
    in_recovery: bool
    databases: list[str]


class ConnectionError_(Exception):
    """Raised when a managed instance cannot be reached or refuses the login."""


async def test_connection(params: ConnParams) -> ServerInfo:
    try:
        async with await psycopg.AsyncConnection.connect(
            params.conninfo(), row_factory=dict_row, autocommit=True
        ) as conn:
            row = await (
                await conn.execute(
                    """
                    SELECT version() AS version,
                           current_setting('server_version_num')::int AS version_num,
                           current_user AS current_user,
                           (SELECT rolsuper FROM pg_roles
                             WHERE rolname = current_user) AS is_superuser,
                           pg_is_in_recovery() AS in_recovery
                    """
                )
            ).fetchone()
            dbs = await (
                await conn.execute(
                    "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"
                )
            ).fetchall()
    except psycopg.Error as exc:
        raise ConnectionError_(str(exc).strip()) from exc
    assert row is not None
    return ServerInfo(
        version=row["version"],
        version_num=row["version_num"],
        current_user=row["current_user"],
        is_superuser=bool(row["is_superuser"]),
        in_recovery=bool(row["in_recovery"]),
        databases=[d["datname"] for d in dbs],
    )


class PoolManager:
    """One small pool per (profile, database). Pools are opened lazily and closed on shutdown."""

    def __init__(self, max_size: int = 3) -> None:
        self._pools: dict[tuple[int, str], AsyncConnectionPool] = {}
        self._lock = asyncio.Lock()
        # Opening a pool probes the server, which can take up to connect_timeout. Serialise
        # that per (profile, database) so one unreachable host does not stall every request.
        self._key_locks: dict[tuple[int, str], asyncio.Lock] = {}
        # Bumped by drop(); a pool opened across a drop used stale settings and is discarded.
        self._generation: dict[int, int] = {}
        self._max_size = max_size

    async def get(self, profile_id: int, params: ConnParams, dbname: str | None = None):
        key = (profile_id, dbname or params.database)
        if (pool := self._pools.get(key)) is not None:
            return pool
        async with self._lock:
            key_lock = self._key_locks.setdefault(key, asyncio.Lock())
            generation = self._generation.get(profile_id, 0)
        async with key_lock:
            if (pool := self._pools.get(key)) is not None:
                return pool
            # Fail fast with the real error (bad password, unknown database, unreachable
            # host) instead of letting the pool retry silently until its timeout.
            probe = await psycopg.AsyncConnection.connect(params.conninfo(dbname))
            await probe.close()
            pool = AsyncConnectionPool(
                params.conninfo(dbname),
                min_size=0,
                max_size=self._max_size,
                max_idle=300,
                timeout=15,
                open=False,
                kwargs={"row_factory": dict_row, "autocommit": True},
            )
            await pool.open()
            async with self._lock:
                stale = self._generation.get(profile_id, 0) != generation
                if not stale:
                    self._pools[key] = pool
        if stale:
            await pool.close()
            raise psycopg.OperationalError("Connection settings changed while connecting; retry")
        return pool

    async def drop(self, profile_id: int) -> None:
        async with self._lock:
            self._generation[profile_id] = self._generation.get(profile_id, 0) + 1
            keys = [k for k in self._pools if k[0] == profile_id]
            pools = [self._pools.pop(k) for k in keys]
            for k in [k for k in self._key_locks if k[0] == profile_id]:
                if not self._key_locks[k].locked():
                    del self._key_locks[k]
        for pool in pools:
            await pool.close()

    async def close_all(self) -> None:
        async with self._lock:
            pools = list(self._pools.values())
            self._pools.clear()
        for pool in pools:
            await pool.close()
