from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from pgcontrol.db.models import MetricSample
from pgcontrol.metrics import derive_points


def _sample(t: datetime, **over) -> MetricSample:
    base = dict(
        profile_id=1,
        taken_at=t,
        connections=5,
        active=1,
        idle_in_transaction=0,
        waiting=0,
        longest_xact_seconds=0.0,
        xact_commit=1000,
        xact_rollback=10,
        blks_hit=9000,
        blks_read=1000,
        deadlocks=0,
        temp_bytes=0,
        db_bytes=10_000_000,
        wal_bytes=50_000,
        standby_count=0,
        lag_bytes=None,
        oldest_xid_age=100,
    )
    base.update(over)
    return MetricSample(**base)


def test_derive_points_rates_and_resets():
    t0 = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)
    samples = [
        _sample(t0),
        _sample(
            t0 + timedelta(seconds=60),
            xact_commit=1600,
            blks_hit=9900,
            blks_read=1100,
            wal_bytes=110_000,
        ),
        # counters went backwards (stats reset / restart): rates must be null, gauges kept
        _sample(
            t0 + timedelta(seconds=120),
            xact_commit=10,
            blks_hit=0,
            blks_read=0,
            wal_bytes=0,
            connections=7,
        ),
    ]
    p = derive_points(samples)
    assert len(p) == 3
    assert p[0].commits_per_s is None and p[0].cache_hit is None
    assert p[1].commits_per_s == 10.0
    assert p[1].cache_hit == pytest.approx(0.9)
    assert p[1].wal_bytes_per_s == 1000.0
    assert p[2].commits_per_s is None and p[2].cache_hit is None and p[2].wal_bytes_per_s is None
    assert p[2].connections == 7


async def test_metrics_endpoint_empty(admin: AsyncClient):
    r = await admin.post(
        "/api/profiles",
        json={"name": "m", "host": "127.0.0.1", "port": 7416, "username": "postgres"},
    )
    pid = r.json()["id"]
    r = await admin.get(f"/api/profiles/{pid}/metrics?hours=6")
    assert r.status_code == 200
    body = r.json()
    assert body["points"] == [] and body["hours"] == 6 and body["interval_seconds"] == 0
    assert (await admin.get(f"/api/profiles/{pid}/metrics?hours=0")).status_code == 422
    assert (await admin.delete(f"/api/profiles/{pid}")).status_code == 204
