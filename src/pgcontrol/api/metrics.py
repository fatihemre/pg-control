"""Metrics history collected by the background sampler (see pgcontrol.metrics)."""

from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from pgcontrol.api.deps import DB, Box, Profile
from pgcontrol.config import get_settings
from pgcontrol.db.models import MetricSample
from pgcontrol.metrics import derive_points, sample_profile
from pgcontrol.security.auth import CurrentUser, OperatorUser

router = APIRouter(prefix="/api/profiles/{profile_id}/metrics", tags=["metrics"])


async def _history(db, profile_id: int, hours: int) -> dict:
    settings = get_settings()
    since = datetime.now(UTC) - timedelta(hours=hours)
    rows = (
        await db.execute(
            select(MetricSample)
            .where(MetricSample.profile_id == profile_id, MetricSample.taken_at >= since)
            .order_by(MetricSample.taken_at)
        )
    ).scalars()
    samples = []
    for s in rows:
        if s.taken_at.tzinfo is None:  # SQLite drops the offset
            s.taken_at = s.taken_at.replace(tzinfo=UTC)
        samples.append(s)
    return {
        "interval_seconds": settings.metrics_interval_seconds,
        "retention_hours": settings.metrics_retention_hours,
        "hours": hours,
        "points": [asdict(p) for p in derive_points(samples)],
    }


@router.get("")
async def get_metrics(
    profile: Profile, db: DB, _: CurrentUser, hours: Annotated[int, Query(ge=1, le=720)] = 24
):
    return await _history(db, profile.id, hours)


@router.post("/sample")
async def sample_now(
    profile: Profile,
    db: DB,
    box: Box,
    _: OperatorUser,
    hours: Annotated[int, Query(ge=1, le=720)] = 24,
):
    """Take a sample right away (the background loop keeps running independently)."""
    db.add(await sample_profile(profile, box))
    await db.commit()
    return await _history(db, profile.id, hours)
