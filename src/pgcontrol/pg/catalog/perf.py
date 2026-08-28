"""Performance views: sessions, blocking, pg_stat_statements, table/index and database stats."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

import psycopg
from psycopg import AsyncConnection


@dataclass
class Session:
    pid: int
    user: str | None
    database: str | None
    application_name: str | None
    client_addr: str | None
    backend_type: str | None
    state: str | None
    wait_event_type: str | None
    wait_event: str | None
    backend_start: datetime | None
    xact_start: datetime | None
    query_start: datetime | None
    state_change: datetime | None
    query_seconds: float | None
    xact_seconds: float | None
    blocked_by: list[int]
    query: str | None
    is_self: bool


async def list_activity(conn: AsyncConnection) -> list[Session]:
    cur = await conn.execute(
        """
        SELECT a.pid, a.usename AS "user", a.datname AS database, a.application_name,
               host(a.client_addr) AS client_addr, a.backend_type, a.state,
               a.wait_event_type, a.wait_event, a.backend_start, a.xact_start, a.query_start,
               a.state_change,
               CASE WHEN a.state = 'active' THEN
                    EXTRACT(EPOCH FROM now() - a.query_start) END AS query_seconds,
               EXTRACT(EPOCH FROM now() - a.xact_start) AS xact_seconds,
               COALESCE(pg_blocking_pids(a.pid), ARRAY[]::int[]) AS blocked_by,
               a.query, a.pid = pg_backend_pid() AS is_self
        FROM pg_stat_activity a
        ORDER BY a.backend_type = 'client backend' DESC, a.state = 'active' DESC,
                 a.query_start NULLS LAST
        """
    )
    return [Session(**r) for r in await cur.fetchall()]


@dataclass
class BlockedLock:
    pid: int
    user: str | None
    database: str | None
    locktype: str
    mode: str
    relation: str | None
    waiting_seconds: float | None
    blocked_by: list[int]
    query: str | None


async def list_blocked(conn: AsyncConnection) -> list[BlockedLock]:
    """Sessions waiting on a lock together with the pids holding it."""
    cur = await conn.execute(
        """
        SELECT l.pid, a.usename AS "user", a.datname AS database, l.locktype, l.mode,
               CASE WHEN l.relation IS NOT NULL THEN l.relation::regclass::text END AS relation,
               EXTRACT(EPOCH FROM now() - a.query_start) AS waiting_seconds,
               COALESCE(pg_blocking_pids(l.pid), ARRAY[]::int[]) AS blocked_by, a.query
        FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE NOT l.granted
        ORDER BY a.query_start
        """
    )
    return [BlockedLock(**r) for r in await cur.fetchall()]


STATEMENT_ORDERS = {
    "total_time": "total_exec_time DESC",
    "mean_time": "mean_exec_time DESC",
    "calls": "calls DESC",
    "rows": "rows DESC",
    "shared_read": "shared_blks_read DESC",
    "temp": "temp_blks_written DESC",
}


@dataclass
class Statements:
    available: bool
    reason: str | None
    rows: list[dict[str, Any]]
    total_time: float


async def list_statements(
    conn: AsyncConnection, order: str = "total_time", limit: int = 100
) -> Statements:
    """Top statements from pg_stat_statements when the extension is installed in this database."""
    if order not in STATEMENT_ORDERS:
        raise ValueError(f"unknown order {order}")
    limit = min(max(limit, 1), 1000)
    cur = await conn.execute(
        "SELECT extversion, n.nspname FROM pg_extension e JOIN pg_namespace n "
        "ON n.oid = e.extnamespace WHERE extname = 'pg_stat_statements'"
    )
    ext = await cur.fetchone()
    if ext is None:
        return Statements(
            False,
            "pg_stat_statements is not installed in this database. Add it to "
            "shared_preload_libraries, restart, then CREATE EXTENSION pg_stat_statements.",
            [],
            0.0,
        )
    schema = psycopg.sql.Identifier(ext["nspname"])
    try:
        cur = await conn.execute(
            psycopg.sql.SQL(
                """
                SELECT s.queryid::text AS queryid, s.userid::regrole::text AS "user",
                       d.datname AS database, s.toplevel, s.calls, s.rows,
                       s.total_exec_time, s.mean_exec_time, s.min_exec_time, s.max_exec_time,
                       s.stddev_exec_time, s.total_plan_time,
                       s.shared_blks_hit, s.shared_blks_read, s.shared_blks_dirtied,
                       s.shared_blks_written, s.temp_blks_read, s.temp_blks_written,
                       s.wal_bytes, s.query,
                       sum(s.total_exec_time) OVER () AS grand_total
                FROM {}.pg_stat_statements s
                LEFT JOIN pg_database d ON d.oid = s.dbid
                ORDER BY {}
                LIMIT %s
                """
            ).format(schema, psycopg.sql.SQL(STATEMENT_ORDERS[order])),
            (limit,),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    except psycopg.errors.UndefinedTable:  # library not preloaded → view errors out
        return Statements(
            False,
            "pg_stat_statements is installed but its shared library is not loaded; add it to "
            "shared_preload_libraries and restart the server.",
            [],
            0.0,
        )
    except psycopg.errors.FeatureNotSupported as e:
        return Statements(False, str(e.diag.message_primary), [], 0.0)
    total = float(rows[0].pop("grand_total") or 0) if rows else 0.0
    for r in rows[1:]:
        r.pop("grand_total", None)
    return Statements(True, None, rows, total)


@dataclass
class TableStats:
    schema: str
    name: str
    kind: str
    n_live_tup: int
    n_dead_tup: int
    dead_ratio: float | None
    seq_scan: int
    seq_tup_read: int
    idx_scan: int | None
    n_tup_ins: int
    n_tup_upd: int
    n_tup_del: int
    n_tup_hot_upd: int
    last_vacuum: datetime | None
    last_autovacuum: datetime | None
    last_analyze: datetime | None
    last_autoanalyze: datetime | None
    vacuum_count: int
    autovacuum_count: int
    total_bytes: int
    table_bytes: int
    index_bytes: int
    toast_bytes: int
    heap_blks_hit: int
    heap_blks_read: int
    cache_hit_ratio: float | None


async def table_stats(conn: AsyncConnection, schema: str | None = None) -> list[TableStats]:
    cur = await conn.execute(
        """
        SELECT s.schemaname AS schema, s.relname AS name,
               CASE c.relkind WHEN 'r' THEN 'table' WHEN 'm' THEN 'materialized view'
                    WHEN 'p' THEN 'partitioned table' ELSE c.relkind::text END AS kind,
               s.n_live_tup, s.n_dead_tup,
               CASE WHEN s.n_live_tup + s.n_dead_tup > 0
                    THEN s.n_dead_tup::float / (s.n_live_tup + s.n_dead_tup) END AS dead_ratio,
               s.seq_scan, s.seq_tup_read, s.idx_scan,
               s.n_tup_ins, s.n_tup_upd, s.n_tup_del, s.n_tup_hot_upd,
               s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze,
               s.vacuum_count, s.autovacuum_count,
               pg_total_relation_size(c.oid) AS total_bytes,
               pg_relation_size(c.oid) AS table_bytes,
               pg_indexes_size(c.oid) AS index_bytes,
               COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,
               COALESCE(io.heap_blks_hit, 0) AS heap_blks_hit,
               COALESCE(io.heap_blks_read, 0) AS heap_blks_read,
               CASE WHEN COALESCE(io.heap_blks_hit, 0) + COALESCE(io.heap_blks_read, 0) > 0
                    THEN io.heap_blks_hit::float / (io.heap_blks_hit + io.heap_blks_read) END
                    AS cache_hit_ratio
        FROM pg_stat_user_tables s
        JOIN pg_class c ON c.oid = s.relid
        LEFT JOIN pg_statio_user_tables io ON io.relid = s.relid
        WHERE (%(schema)s::text IS NULL OR s.schemaname = %(schema)s)
        ORDER BY pg_total_relation_size(c.oid) DESC, s.schemaname, s.relname
        """,
        {"schema": schema},
    )
    return [TableStats(**r) for r in await cur.fetchall()]


@dataclass
class IndexStats:
    schema: str
    table: str
    name: str
    idx_scan: int
    idx_tup_read: int
    idx_tup_fetch: int
    size_bytes: int
    is_unique: bool
    is_primary: bool
    is_valid: bool
    definition: str


async def index_stats(conn: AsyncConnection, schema: str | None = None) -> list[IndexStats]:
    cur = await conn.execute(
        """
        SELECT s.schemaname AS schema, s.relname AS "table", s.indexrelname AS name,
               s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
               pg_relation_size(s.indexrelid) AS size_bytes,
               i.indisunique AS is_unique, i.indisprimary AS is_primary, i.indisvalid AS is_valid,
               pg_get_indexdef(s.indexrelid) AS definition
        FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
        WHERE (%(schema)s::text IS NULL OR s.schemaname = %(schema)s)
        ORDER BY pg_relation_size(s.indexrelid) DESC, s.schemaname, s.relname, s.indexrelname
        """,
        {"schema": schema},
    )
    return [IndexStats(**r) for r in await cur.fetchall()]


@dataclass
class DatabaseStats:
    name: str
    size_bytes: int
    numbackends: int
    xact_commit: int
    xact_rollback: int
    blks_hit: int
    blks_read: int
    cache_hit_ratio: float | None
    tup_returned: int
    tup_fetched: int
    tup_inserted: int
    tup_updated: int
    tup_deleted: int
    conflicts: int
    temp_files: int
    temp_bytes: int
    deadlocks: int
    stats_reset: datetime | None


async def database_stats(conn: AsyncConnection) -> list[DatabaseStats]:
    cur = await conn.execute(
        """
        SELECT d.datname AS name, pg_database_size(d.oid) AS size_bytes,
               s.numbackends, s.xact_commit, s.xact_rollback, s.blks_hit, s.blks_read,
               CASE WHEN s.blks_hit + s.blks_read > 0
                    THEN s.blks_hit::float / (s.blks_hit + s.blks_read) END AS cache_hit_ratio,
               s.tup_returned, s.tup_fetched, s.tup_inserted, s.tup_updated, s.tup_deleted,
               s.conflicts, s.temp_files, s.temp_bytes, s.deadlocks, s.stats_reset
        FROM pg_database d JOIN pg_stat_database s ON s.datid = d.oid
        WHERE NOT d.datistemplate
        ORDER BY d.datname
        """
    )
    return [DatabaseStats(**r) for r in await cur.fetchall()]


def to_dict(obj) -> dict:
    return asdict(obj)
