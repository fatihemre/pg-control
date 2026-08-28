"""Background metrics sampler: one row per profile per interval in the metadata DB.

Samples are a compact snapshot of activity counters plus a few gauges; the API turns
consecutive counter samples into per-second rates so the UI can draw trends without
keeping state of its own.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import psycopg
from psycopg.rows import dict_row
from sqlalchemy import delete, select

from pgcontrol.config import get_settings
from pgcontrol.db.models import ConnectionProfile, MetricSample
from pgcontrol.db.session import get_sessionmaker
from pgcontrol.pg.connection import ConnParams
from pgcontrol.security.crypto import SecretBox

log = logging.getLogger("pgcontrol.metrics")

# Works on PostgreSQL 14–18: only pg_stat_activity, pg_stat_database, pg_database,
# pg_stat_replication and the WAL LSN functions (present since 10) are used.
SAMPLE_SQL = """
WITH act AS (
    SELECT count(*) FILTER (WHERE backend_type = 'client backend') AS connections,
           count(*) FILTER (WHERE state = 'active'
                              AND backend_type = 'client backend') AS active,
           count(*) FILTER (WHERE state LIKE 'idle in transaction%') AS idle_in_transaction,
           count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting,
           coalesce(max(extract(epoch FROM now() - xact_start))
                    FILTER (WHERE backend_type = 'client backend'), 0)::float
               AS longest_xact_seconds
    FROM pg_stat_activity
), db AS (
    SELECT sum(xact_commit)::bigint AS xact_commit,
           sum(xact_rollback)::bigint AS xact_rollback,
           sum(blks_hit)::bigint AS blks_hit,
           sum(blks_read)::bigint AS blks_read,
           sum(deadlocks)::bigint AS deadlocks,
           sum(temp_bytes)::bigint AS temp_bytes
    FROM pg_stat_database WHERE datname IS NOT NULL
), size AS (
    SELECT sum(pg_database_size(oid))::bigint AS db_bytes
    FROM pg_database WHERE NOT datistemplate AND datallowconn
), wal AS (
    SELECT pg_wal_lsn_diff(
             CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()
                  ELSE pg_current_wal_lsn() END, '0/0')::bigint AS wal_bytes
), repl AS (
    SELECT count(*)::int AS standby_count,
           max(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn))::bigint AS lag_bytes
    FROM pg_stat_replication WHERE NOT pg_is_in_recovery()
), xid AS (
    SELECT max(age(datfrozenxid))::bigint AS oldest_xid_age FROM pg_database
)
SELECT * FROM act, db, size, wal, repl, xid
"""


async def take_sample(conn: psycopg.AsyncConnection) -> dict:
    cur = await conn.execute(SAMPLE_SQL)
    row = await cur.fetchone()
    assert row is not None
    return dict(row)


@dataclass
class Point:
    t: datetime
    connections: int
    active: int
    idle_in_transaction: int
    waiting: int
    longest_xact_seconds: float
    db_bytes: int
    standby_count: int
    lag_bytes: int | None
    oldest_xid_age: int
    # per-second rates derived from the previous sample (None for the first point or
    # after a stats reset / restart made a counter go backwards)
    commits_per_s: float | None
    rollbacks_per_s: float | None
    cache_hit: float | None
    wal_bytes_per_s: float | None
    deadlocks_per_s: float | None
    temp_bytes_per_s: float | None


def _rate(prev: int | None, cur: int | None, seconds: float) -> float | None:
    if prev is None or cur is None or cur < prev or seconds <= 0:
        return None
    return (cur - prev) / seconds


def derive_points(samples: list[MetricSample]) -> list[Point]:
    """Turn raw samples (ascending by time) into points with rates between neighbours."""
    points: list[Point] = []
    prev: MetricSample | None = None
    for s in samples:
        seconds = (s.taken_at - prev.taken_at).total_seconds() if prev else 0.0
        hit = _rate(prev.blks_hit, s.blks_hit, seconds) if prev else None
        read = _rate(prev.blks_read, s.blks_read, seconds) if prev else None
        cache_hit = None
        if hit is not None and read is not None and hit + read > 0:
            cache_hit = hit / (hit + read)
        points.append(
            Point(
                t=s.taken_at,
                connections=s.connections,
                active=s.active,
                idle_in_transaction=s.idle_in_transaction,
                waiting=s.waiting,
                longest_xact_seconds=s.longest_xact_seconds,
                db_bytes=s.db_bytes,
                standby_count=s.standby_count,
                lag_bytes=s.lag_bytes,
                oldest_xid_age=s.oldest_xid_age,
                commits_per_s=_rate(prev.xact_commit, s.xact_commit, seconds) if prev else None,
                rollbacks_per_s=_rate(prev.xact_rollback, s.xact_rollback, seconds)
                if prev
                else None,
                cache_hit=cache_hit,
                wal_bytes_per_s=_rate(prev.wal_bytes, s.wal_bytes, seconds) if prev else None,
                deadlocks_per_s=_rate(prev.deadlocks, s.deadlocks, seconds) if prev else None,
                temp_bytes_per_s=_rate(prev.temp_bytes, s.temp_bytes, seconds) if prev else None,
            )
        )
        prev = s
    return points


async def sample_profile(profile: ConnectionProfile, box: SecretBox) -> MetricSample:
    password = box.decrypt(profile.password_enc) if profile.password_enc else None
    params = ConnParams.from_profile(profile, password)
    async with await psycopg.AsyncConnection.connect(
        params.conninfo(), row_factory=dict_row, autocommit=True
    ) as conn:
        row = await take_sample(conn)
    return MetricSample(profile_id=profile.id, taken_at=datetime.now(UTC), **row)


async def sample_all(box: SecretBox) -> int:
    """Sample every profile once; unreachable instances are skipped. Returns rows stored."""
    stored = 0
    async with get_sessionmaker()() as db:
        profiles = list((await db.execute(select(ConnectionProfile))).scalars())
    for profile in profiles:
        try:
            sample = await sample_profile(profile, box)
        except Exception as exc:  # noqa: BLE001 - a bad instance must not stop the loop
            log.debug("metrics: skipping %s: %s", profile.name, str(exc).strip())
            continue
        async with get_sessionmaker()() as db:
            db.add(sample)
            try:
                await db.commit()
                stored += 1
            except Exception:  # profile deleted meanwhile
                await db.rollback()
    return stored


async def prune(retention: timedelta) -> None:
    cutoff = datetime.now(UTC) - retention
    async with get_sessionmaker()() as db:
        await db.execute(delete(MetricSample).where(MetricSample.taken_at < cutoff))
        await db.commit()


class MetricsSampler:
    """Periodic task started from the app lifespan. Interval 0 disables sampling."""

    def __init__(self, box: SecretBox) -> None:
        settings = get_settings()
        self.interval = settings.metrics_interval_seconds
        self.retention = timedelta(hours=settings.metrics_retention_hours)
        self._box = box
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self.interval > 0 and self._task is None:
            self._task = asyncio.create_task(self._run(), name="metrics-sampler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        log.info("metrics sampler every %ss, retention %s", self.interval, self.retention)
        while True:
            try:
                await sample_all(self._box)
                await prune(self.retention)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("metrics sampler tick failed")
            await asyncio.sleep(self.interval)
