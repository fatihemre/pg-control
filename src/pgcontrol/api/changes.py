import json
from datetime import UTC

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from pgcontrol.api.deps import DB, Box, Pools, Profile, profile_params
from pgcontrol.db.models import AuditLog, ConnectionProfile, User
from pgcontrol.pg.catalog.common import server_version_num
from pgcontrol.pg.changes import ChangeSet, PlanError, apply_plan, build_plan
from pgcontrol.security.auth import CurrentUser, OperatorUser

router = APIRouter(prefix="/api", tags=["changes"])


async def _plan(profile, box, pools, changes: ChangeSet):
    pool = await pools.get(profile.id, profile_params(profile, box), changes.database)
    async with pool.connection() as conn:
        version = await server_version_num(conn)
        try:
            return pool, await build_plan(conn, changes, version)
        except PlanError as e:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                {"index": e.index, "message": e.message},
            ) from e


@router.post("/profiles/{profile_id}/plan")
async def plan(changes: ChangeSet, profile: Profile, box: Box, pools: Pools, _: CurrentUser):
    _, p = await _plan(profile, box, pools, changes)
    return p.to_dict()


@router.post("/profiles/{profile_id}/apply")
async def apply(
    changes: ChangeSet, profile: Profile, box: Box, pools: Pools, user: OperatorUser, db: DB
):
    if profile.read_only:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This instance is marked read-only")
    pool, p = await _plan(profile, box, pools, changes)
    async with pool.connection() as conn:
        result = await apply_plan(conn, p)
    detail = {
        "database": changes.database or profile.database,
        "statements": [s.preview for s in p.statements],
        "descriptions": [s.description for s in p.statements],
        "executed": result.executed,
        "error": result.error,
        "failed_index": result.failed_index,
    }
    db.add(
        AuditLog(
            user_id=user.id,
            profile_id=profile.id,
            action="apply" if result.ok else "apply_failed",
            detail=json.dumps(detail),
        )
    )
    await db.commit()
    return {
        "ok": result.ok,
        "executed": result.executed,
        "error": result.error,
        "failed_index": result.failed_index,
        "statements": p.to_dict()["statements"],
    }


@router.get("/audit")
async def list_audit(db: DB, _: CurrentUser, limit: int = 100, profile_id: int | None = None):
    q = (
        select(AuditLog, User.username, ConnectionProfile.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .outerjoin(ConnectionProfile, ConnectionProfile.id == AuditLog.profile_id)
        .order_by(AuditLog.id.desc())
        .limit(min(max(limit, 1), 500))
    )
    if profile_id is not None:
        q = q.where(AuditLog.profile_id == profile_id)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": a.id,
            "created_at": (
                a.created_at if a.created_at.tzinfo else a.created_at.replace(tzinfo=UTC)
            ).isoformat(),
            "user": username,
            "profile_id": a.profile_id,
            "profile": pname,
            "action": a.action,
            "detail": json.loads(a.detail) if a.detail else None,
        }
        for a, username, pname in rows
    ]
