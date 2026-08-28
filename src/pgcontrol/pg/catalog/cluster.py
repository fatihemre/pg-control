"""Cluster-level views: instance overview (health) and physical/logical replication."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from psycopg import AsyncConnection


@dataclass
class Overview:
    version: str
    version_num: int
    in_recovery: bool
    start_time: datetime
    uptime_seconds: float
    data_checksums: bool
    max_connections: int
    connections: int
    reserved_connections: int
    active: int
    idle_in_transaction: int
    waiting: int
    longest_xact_seconds: float | None
    longest_idle_xact_seconds: float | None
    xact_commit: int
    xact_rollback: int
    blks_hit: int
    blks_read: int
    cache_hit_ratio: float | None
    deadlocks: int
    temp_bytes: int
    stats_reset: datetime | None
    current_wal_lsn: str | None
    wal_bytes: int | None
    checkpoints_timed: int
    checkpoints_req: int
    checkpoint_write_time: float
    checkpoint_sync_time: float
    buffers_checkpoint: int | None
    buffers_backend: int | None
    oldest_xid_age: int
    oldest_xid_database: str
    oldest_mxid_age: int
    autovacuum_freeze_max_age: int
    wraparound_ratio: float
    total_db_bytes: int
    autovacuum_workers: int
    standby_count: int
    inactive_slots: int
    settings: dict[str, str]


OVERVIEW_SETTINGS = (
    "max_connections",
    "shared_buffers",
    "work_mem",
    "maintenance_work_mem",
    "effective_cache_size",
    "wal_level",
    "max_wal_senders",
    "max_replication_slots",
    "autovacuum",
    "log_min_duration_statement",
    "ssl",
    "data_directory",
    "archive_mode",
    "hot_standby",
    "synchronous_standby_names",
)


async def overview(conn: AsyncConnection, version: int) -> Overview:
    base = await (
        await conn.execute(
            f"""
            SELECT version() AS version,
                   current_setting('server_version_num')::int AS version_num,
                   pg_is_in_recovery() AS in_recovery,
                   pg_postmaster_start_time() AS start_time,
                   EXTRACT(EPOCH FROM now() - pg_postmaster_start_time()) AS uptime_seconds,
                   current_setting('data_checksums') = 'on' AS data_checksums,
                   current_setting('max_connections')::int AS max_connections,
                   current_setting('superuser_reserved_connections')::int AS reserved_connections,
                   current_setting('autovacuum_freeze_max_age')::int AS autovacuum_freeze_max_age,
                   CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()::text
                        ELSE pg_current_wal_lsn()::text END AS current_wal_lsn,
                   CASE WHEN {_PRIVILEGED("pg_monitor")}
                        THEN (SELECT coalesce(sum(size), 0)::bigint FROM pg_ls_waldir()) END
                       AS wal_bytes,
                   (SELECT count(*) FROM pg_stat_replication) AS standby_count,
                   (SELECT count(*) FROM pg_replication_slots WHERE NOT active)
                       AS inactive_slots
            """
        )
    ).fetchone()
    activity = await (
        await conn.execute(
            """
            SELECT count(*) FILTER (WHERE backend_type = 'client backend') AS connections,
                   count(*) FILTER (WHERE backend_type = 'client backend'
                                      AND state = 'active') AS active,
                   count(*) FILTER (WHERE backend_type = 'client backend'
                                      AND state LIKE 'idle in transaction%')
                       AS idle_in_transaction,
                   count(*) FILTER (WHERE backend_type = 'client backend'
                                      AND wait_event_type = 'Lock') AS waiting,
                   count(*) FILTER (WHERE backend_type = 'autovacuum worker')
                       AS autovacuum_workers,
                   max(EXTRACT(EPOCH FROM now() - xact_start))
                       FILTER (WHERE backend_type = 'client backend' AND state = 'active')
                       AS longest_xact_seconds,
                   max(EXTRACT(EPOCH FROM now() - state_change))
                       FILTER (WHERE backend_type = 'client backend'
                                 AND state LIKE 'idle in transaction%')
                       AS longest_idle_xact_seconds
            FROM pg_stat_activity
            """
        )
    ).fetchone()
    dbstats = await (
        await conn.execute(
            """
            SELECT coalesce(sum(xact_commit), 0)::bigint AS xact_commit,
                   coalesce(sum(xact_rollback), 0)::bigint AS xact_rollback,
                   coalesce(sum(blks_hit), 0)::bigint AS blks_hit,
                   coalesce(sum(blks_read), 0)::bigint AS blks_read,
                   coalesce(sum(deadlocks), 0)::bigint AS deadlocks,
                   coalesce(sum(temp_bytes), 0)::bigint AS temp_bytes,
                   min(stats_reset) AS stats_reset,
                   (SELECT coalesce(sum(pg_database_size(oid)), 0)::bigint FROM pg_database
                     WHERE datallowconn) AS total_db_bytes
            FROM pg_stat_database WHERE datname IS NOT NULL
            """
        )
    ).fetchone()
    if version >= 170000:
        ckpt = await (
            await conn.execute(
                """
                SELECT num_timed AS checkpoints_timed, num_requested AS checkpoints_req,
                       write_time AS checkpoint_write_time, sync_time AS checkpoint_sync_time,
                       buffers_written AS buffers_checkpoint, NULL::bigint AS buffers_backend
                FROM pg_stat_checkpointer
                """
            )
        ).fetchone()
    else:
        ckpt = await (
            await conn.execute(
                """
                SELECT checkpoints_timed, checkpoints_req, checkpoint_write_time,
                       checkpoint_sync_time, buffers_checkpoint, buffers_backend
                FROM pg_stat_bgwriter
                """
            )
        ).fetchone()
    xid = await (
        await conn.execute(
            """
            SELECT datname AS oldest_xid_database, age(datfrozenxid) AS oldest_xid_age,
                   mxid_age(datminmxid) AS oldest_mxid_age
            FROM pg_database ORDER BY age(datfrozenxid) DESC LIMIT 1
            """
        )
    ).fetchone()
    settings_cur = await conn.execute(
        "SELECT name, current_setting(name) AS value FROM pg_settings WHERE name = ANY(%s)",
        (list(OVERVIEW_SETTINGS),),
    )
    settings = {r["name"]: r["value"] for r in await settings_cur.fetchall()}
    assert base and activity and dbstats and ckpt and xid
    hit, read = int(dbstats["blks_hit"]), int(dbstats["blks_read"])
    return Overview(
        version=base["version"],
        version_num=base["version_num"],
        in_recovery=base["in_recovery"],
        start_time=base["start_time"],
        uptime_seconds=float(base["uptime_seconds"]),
        data_checksums=base["data_checksums"],
        max_connections=base["max_connections"],
        connections=activity["connections"],
        reserved_connections=base["reserved_connections"],
        active=activity["active"],
        idle_in_transaction=activity["idle_in_transaction"],
        waiting=activity["waiting"],
        longest_xact_seconds=_f(activity["longest_xact_seconds"]),
        longest_idle_xact_seconds=_f(activity["longest_idle_xact_seconds"]),
        xact_commit=int(dbstats["xact_commit"]),
        xact_rollback=int(dbstats["xact_rollback"]),
        blks_hit=hit,
        blks_read=read,
        cache_hit_ratio=hit / (hit + read) if hit + read else None,
        deadlocks=int(dbstats["deadlocks"]),
        temp_bytes=int(dbstats["temp_bytes"]),
        stats_reset=dbstats["stats_reset"],
        current_wal_lsn=base["current_wal_lsn"],
        wal_bytes=base["wal_bytes"],
        checkpoints_timed=int(ckpt["checkpoints_timed"]),
        checkpoints_req=int(ckpt["checkpoints_req"]),
        checkpoint_write_time=float(ckpt["checkpoint_write_time"]),
        checkpoint_sync_time=float(ckpt["checkpoint_sync_time"]),
        buffers_checkpoint=ckpt["buffers_checkpoint"],
        buffers_backend=ckpt["buffers_backend"],
        oldest_xid_age=int(xid["oldest_xid_age"]),
        oldest_xid_database=xid["oldest_xid_database"],
        oldest_mxid_age=int(xid["oldest_mxid_age"]),
        autovacuum_freeze_max_age=base["autovacuum_freeze_max_age"],
        wraparound_ratio=int(xid["oldest_xid_age"]) / base["autovacuum_freeze_max_age"],
        total_db_bytes=int(dbstats["total_db_bytes"]),
        autovacuum_workers=activity["autovacuum_workers"],
        standby_count=int(base["standby_count"]),
        inactive_slots=int(base["inactive_slots"]),
        settings=settings,
    )


def _f(v: Any) -> float | None:
    return None if v is None else float(v)


@dataclass
class Standby:
    pid: int
    user: str | None
    application_name: str | None
    client_addr: str | None
    backend_start: datetime | None
    state: str | None
    sync_state: str | None
    sync_priority: int | None
    sent_lsn: str | None
    write_lsn: str | None
    flush_lsn: str | None
    replay_lsn: str | None
    sent_lag_bytes: int | None
    write_lag_bytes: int | None
    flush_lag_bytes: int | None
    replay_lag_bytes: int | None
    write_lag_seconds: float | None
    flush_lag_seconds: float | None
    replay_lag_seconds: float | None
    reply_time: datetime | None


@dataclass
class WalReceiver:
    pid: int
    status: str | None
    sender_host: str | None
    sender_port: int | None
    slot_name: str | None
    receive_start_lsn: str | None
    written_lsn: str | None
    flushed_lsn: str | None
    received_tli: int | None
    last_msg_send_time: datetime | None
    last_msg_receipt_time: datetime | None
    latest_end_lsn: str | None
    latest_end_time: datetime | None
    conninfo: str | None


@dataclass
class Recovery:
    in_recovery: bool
    last_receive_lsn: str | None
    last_replay_lsn: str | None
    last_replay_timestamp: datetime | None
    replay_lag_bytes: int | None
    replay_delay_seconds: float | None
    is_paused: bool | None
    primary_conninfo: str | None
    primary_slot_name: str | None


@dataclass
class Slot:
    name: str
    plugin: str | None
    slot_type: str
    database: str | None
    temporary: bool
    active: bool
    active_pid: int | None
    xmin: str | None
    catalog_xmin: str | None
    restart_lsn: str | None
    confirmed_flush_lsn: str | None
    retained_bytes: int | None
    wal_status: str | None
    safe_wal_size: int | None
    two_phase: bool | None
    conflicting: bool | None
    invalidation_reason: str | None
    failover: bool | None
    synced: bool | None
    inactive_since: datetime | None


@dataclass
class Publication:
    name: str
    owner: str
    all_tables: bool
    insert: bool
    update: bool
    delete: bool
    truncate: bool
    via_root: bool
    tables: list[str]


@dataclass
class Subscription:
    name: str
    owner: str
    enabled: bool
    conninfo: str | None
    slot_name: str | None
    publications: list[str]
    pid: int | None
    received_lsn: str | None
    latest_end_lsn: str | None
    last_msg_receipt_time: datetime | None
    latest_end_time: datetime | None
    apply_error_count: int | None
    sync_error_count: int | None
    tables_not_ready: int


@dataclass
class Replication:
    in_recovery: bool
    recovery: Recovery
    standbys: list[Standby]
    wal_receiver: WalReceiver | None
    slots: list[Slot]
    publications: list[Publication]
    subscriptions: list[Subscription]
    logical_database: str
    wal_level: str
    max_wal_senders: int
    max_replication_slots: int
    synchronous_standby_names: str
    current_lsn: str | None

    def to_dict(self) -> dict:
        return asdict(self)


# ``LAG(x)`` = bytes between the newest local LSN and x; on a primary that is
# pg_current_wal_lsn(), on a standby the last replayed one.
_HEAD = "CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn() ELSE pg_current_wal_lsn() END"


def _PRIVILEGED(role: str) -> str:  # noqa: N802
    """SQL boolean: current user is a superuser or a member of the given predefined role."""
    return (
        f"(pg_has_role(current_user, '{role}', 'MEMBER') OR "
        "(SELECT rolsuper FROM pg_roles WHERE rolname = current_user))"
    )


def _lag(col: str) -> str:
    return f"CASE WHEN {col} IS NULL THEN NULL ELSE pg_wal_lsn_diff({_HEAD}, {col})::bigint END"


async def replication(
    conn: AsyncConnection, version: int, logical_conn: AsyncConnection | None = None
) -> Replication:
    """Physical replication state of the cluster plus the publications/subscriptions of the
    database ``logical_conn`` is connected to (defaults to ``conn``'s database)."""
    recovery = await _recovery(conn)
    standbys = await _standbys(conn)
    receiver = await _wal_receiver(conn) if recovery.in_recovery else None
    slots = await _slots(conn, version)
    pubs = await _publications(logical_conn or conn)
    subs = await _subscriptions(logical_conn or conn, version)
    cfg = await (
        await conn.execute(
            f"""
            SELECT current_setting('wal_level') AS wal_level,
                   current_setting('max_wal_senders')::int AS max_wal_senders,
                   current_setting('max_replication_slots')::int AS max_replication_slots,
                   current_setting('synchronous_standby_names') AS synchronous_standby_names,
                   ({_HEAD})::text AS current_lsn,
                   current_database() AS logical_database
            """
        )
    ).fetchone()
    assert cfg is not None
    if logical_conn is not None:
        db = await (await logical_conn.execute("SELECT current_database() AS d")).fetchone()
        assert db is not None
        cfg["logical_database"] = db["d"]
    return Replication(
        in_recovery=recovery.in_recovery,
        recovery=recovery,
        standbys=standbys,
        wal_receiver=receiver,
        slots=slots,
        publications=pubs,
        subscriptions=subs,
        logical_database=cfg["logical_database"],
        wal_level=cfg["wal_level"],
        max_wal_senders=cfg["max_wal_senders"],
        max_replication_slots=cfg["max_replication_slots"],
        synchronous_standby_names=cfg["synchronous_standby_names"],
        current_lsn=cfg["current_lsn"],
    )


async def _recovery(conn: AsyncConnection) -> Recovery:
    row = await (
        await conn.execute(
            f"""
            SELECT pg_is_in_recovery() AS in_recovery,
                   pg_last_wal_receive_lsn()::text AS last_receive_lsn,
                   pg_last_wal_replay_lsn()::text AS last_replay_lsn,
                   pg_last_xact_replay_timestamp() AS last_replay_timestamp,
                   CASE WHEN pg_is_in_recovery()
                             AND pg_last_wal_receive_lsn() IS NOT NULL
                             AND pg_last_wal_replay_lsn() IS NOT NULL
                        THEN pg_wal_lsn_diff(pg_last_wal_receive_lsn(),
                                             pg_last_wal_replay_lsn())::bigint END
                       AS replay_lag_bytes,
                   CASE WHEN pg_is_in_recovery()
                             AND pg_last_wal_receive_lsn() <> pg_last_wal_replay_lsn()
                        THEN EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()) END
                       AS replay_delay_seconds,
                   CASE WHEN pg_is_in_recovery()
                             AND has_function_privilege('pg_is_wal_replay_paused()', 'EXECUTE')
                        THEN pg_is_wal_replay_paused() END AS is_paused,
                   CASE WHEN pg_is_in_recovery() AND {_PRIVILEGED("pg_read_all_settings")}
                        THEN current_setting('primary_conninfo', true) END AS primary_conninfo,
                   CASE WHEN pg_is_in_recovery() AND {_PRIVILEGED("pg_read_all_settings")}
                        THEN current_setting('primary_slot_name', true) END AS primary_slot_name
            """
        )
    ).fetchone()
    assert row is not None
    return Recovery(
        in_recovery=row["in_recovery"],
        last_receive_lsn=row["last_receive_lsn"],
        last_replay_lsn=row["last_replay_lsn"],
        last_replay_timestamp=row["last_replay_timestamp"],
        replay_lag_bytes=row["replay_lag_bytes"],
        replay_delay_seconds=_f(row["replay_delay_seconds"]),
        is_paused=row["is_paused"],
        primary_conninfo=_redact(row["primary_conninfo"]),
        primary_slot_name=row["primary_slot_name"] or None,
    )


async def _standbys(conn: AsyncConnection) -> list[Standby]:
    cur = await conn.execute(
        f"""
        SELECT pid, usename AS "user", application_name, host(client_addr) AS client_addr,
               backend_start, state, sync_state, sync_priority,
               sent_lsn::text, write_lsn::text, flush_lsn::text, replay_lsn::text,
               {_lag("sent_lsn")} AS sent_lag_bytes,
               {_lag("write_lsn")} AS write_lag_bytes,
               {_lag("flush_lsn")} AS flush_lag_bytes,
               {_lag("replay_lsn")} AS replay_lag_bytes,
               EXTRACT(EPOCH FROM write_lag) AS write_lag_seconds,
               EXTRACT(EPOCH FROM flush_lag) AS flush_lag_seconds,
               EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
               reply_time
        FROM pg_stat_replication
        ORDER BY application_name, pid
        """
    )
    out = []
    for r in await cur.fetchall():
        for k in ("write_lag_seconds", "flush_lag_seconds", "replay_lag_seconds"):
            r[k] = _f(r[k])
        out.append(Standby(**r))
    return out


async def _wal_receiver(conn: AsyncConnection) -> WalReceiver | None:
    row = await (
        await conn.execute(
            """
            SELECT pid, status, sender_host, sender_port, slot_name,
                   receive_start_lsn::text, written_lsn::text, flushed_lsn::text, received_tli,
                   last_msg_send_time, last_msg_receipt_time, latest_end_lsn::text,
                   latest_end_time, conninfo
            FROM pg_stat_wal_receiver
            """
        )
    ).fetchone()
    if row is None:
        return None
    row["conninfo"] = _redact(row["conninfo"])
    return WalReceiver(**row)


async def _slots(conn: AsyncConnection, version: int) -> list[Slot]:
    conflicting = "conflicting" if version >= 160000 else "NULL::boolean"
    reason = "invalidation_reason" if version >= 170000 else "NULL::text"
    failover = "failover" if version >= 170000 else "NULL::boolean"
    synced = "synced" if version >= 170000 else "NULL::boolean"
    since = "inactive_since" if version >= 170000 else "NULL::timestamptz"
    cur = await conn.execute(
        f"""
        SELECT slot_name AS name, plugin, slot_type, database, temporary, active, active_pid,
               xmin::text, catalog_xmin::text, restart_lsn::text, confirmed_flush_lsn::text,
               {_lag("restart_lsn")} AS retained_bytes,
               wal_status, safe_wal_size, two_phase,
               {conflicting} AS conflicting, {reason} AS invalidation_reason,
               {failover} AS failover, {synced} AS synced, {since} AS inactive_since
        FROM pg_replication_slots
        ORDER BY slot_name
        """
    )
    return [Slot(**r) for r in await cur.fetchall()]


async def _publications(conn: AsyncConnection) -> list[Publication]:
    cur = await conn.execute(
        """
        SELECT p.pubname AS name, p.pubowner::regrole::text AS owner, p.puballtables AS all_tables,
               p.pubinsert AS insert, p.pubupdate AS update, p.pubdelete AS delete,
               p.pubtruncate AS truncate, p.pubviaroot AS via_root,
               COALESCE((SELECT array_agg(quote_ident(schemaname) || '.' || quote_ident(tablename)
                                          ORDER BY 1)
                         FROM pg_publication_tables t WHERE t.pubname = p.pubname),
                        ARRAY[]::text[]) AS tables
        FROM pg_publication p ORDER BY p.pubname
        """
    )
    return [Publication(**r) for r in await cur.fetchall()]


async def _subscriptions(conn: AsyncConnection, version: int) -> list[Subscription]:
    # subconninfo is readable only by superusers (column privilege); avoid a permission error.
    priv = await (
        await conn.execute(
            "SELECT has_column_privilege('pg_subscription', 'subconninfo', 'SELECT') AS ok"
        )
    ).fetchone()
    conninfo = "u.subconninfo" if priv and priv["ok"] else "NULL::text"
    if version >= 150000:
        errors = "ss.apply_error_count, ss.sync_error_count"
        stats_join = "LEFT JOIN pg_stat_subscription_stats ss ON ss.subid = u.oid"
    else:
        errors = "NULL::bigint AS apply_error_count, NULL::bigint AS sync_error_count"
        stats_join = ""
    cur = await conn.execute(
        f"""
        SELECT u.subname AS name, u.subowner::regrole::text AS owner, u.subenabled AS enabled,
               {conninfo} AS conninfo, u.subslotname AS slot_name,
               u.subpublications AS publications,
               s.pid, s.received_lsn::text, s.latest_end_lsn::text, s.last_msg_receipt_time,
               s.latest_end_time, {errors},
               (SELECT count(*) FROM pg_subscription_rel r
                 WHERE r.srsubid = u.oid AND r.srsubstate <> 'r') AS tables_not_ready
        FROM pg_subscription u
        LEFT JOIN pg_stat_subscription s ON s.subid = u.oid AND s.relid IS NULL
        {stats_join}
        WHERE u.subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY u.subname
        """
    )
    out = []
    for r in await cur.fetchall():
        r["conninfo"] = _redact(r["conninfo"])
        r["owner"] = r["owner"].strip('"')
        out.append(Subscription(**r))
    return out


def _redact(conninfo: str | None) -> str | None:
    """Hide password=... in a libpq connection string."""
    if not conninfo:
        return conninfo or None
    parts = []
    for tok in conninfo.split():
        key, _, _ = tok.partition("=")
        parts.append("password=***" if key.lower() == "password" else tok)
    return " ".join(parts)
