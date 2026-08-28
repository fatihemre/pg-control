"""Patroni cluster status and operations for a profile that has ``patroni_url`` set.

Operations are not SQL, so they bypass the change basket; instead each one is confirmed in
the UI, executed immediately and written to ``audit_log`` (action ``patroni`` or
``patroni_failed``) with the HTTP call as its "statement".
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from pgcontrol.api.deps import DB, Box, Profile
from pgcontrol.db.models import AuditLog, ConnectionProfile
from pgcontrol.patroni import PatroniClient, PatroniError
from pgcontrol.security.auth import CurrentUser, OperatorUser
from pgcontrol.security.crypto import SecretBox

router = APIRouter(prefix="/api/profiles/{profile_id}/patroni", tags=["patroni"])

MemberName = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")


class SwitchoverIn(BaseModel):
    candidate: str | None = Field(default=None, pattern=r"^[A-Za-z0-9._-]+$", max_length=128)
    scheduled_at: datetime | None = None


class FailoverIn(BaseModel):
    candidate: str = MemberName


class PauseIn(BaseModel):
    paused: bool


class RestartIn(BaseModel):
    pending_only: bool = False
    schedule: datetime | None = None


class ReinitializeIn(BaseModel):
    force: bool = False


class OperationOut(BaseModel):
    ok: Literal[True] = True
    operation: str
    message: str


def make_client(profile: ConnectionProfile, box: SecretBox, request: Request) -> PatroniClient:
    if not profile.patroni_url:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Patroni is not configured for this instance"
        )
    password = box.decrypt(profile.patroni_password_enc) if profile.patroni_password_enc else None
    return PatroniClient(
        profile.patroni_url,
        profile.patroni_username,
        password,
        transport=getattr(request.app.state, "patroni_transport", None),
    )


def _http_error(exc: PatroniError) -> HTTPException:
    code = status.HTTP_502_BAD_GATEWAY
    if exc.status == 401:
        code = status.HTTP_401_UNAUTHORIZED
    elif exc.status in (400, 404, 409, 412, 503):
        code = exc.status
    return HTTPException(code, f"Patroni: {exc.message}")


@router.get("")
async def cluster_status(profile: Profile, box: Box, request: Request, _: CurrentUser):
    async with make_client(profile, box, request) as client:
        try:
            return (await client.status()).to_dict()
        except PatroniError as exc:
            raise _http_error(exc) from exc


async def _run(
    profile: ConnectionProfile,
    db,
    user,
    operation: str,
    description: str,
    call: Callable[[], Awaitable[str]],
    target: str | None = None,
) -> OperationOut:
    if profile.read_only:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This instance is marked read-only")
    error: str | None = None
    message = ""
    try:
        message = await call()
    except PatroniError as exc:
        error = exc.message
    detail = {
        "operation": operation,
        "target": target,
        "descriptions": [description],
        "statements": [f"patroni {operation}{f' {target}' if target else ''}"],
        "response": message or None,
        "error": error,
    }
    db.add(
        AuditLog(
            user_id=user.id,
            profile_id=profile.id,
            action="patroni" if error is None else "patroni_failed",
            detail=json.dumps(detail),
        )
    )
    await db.commit()
    if error is not None:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Patroni: {error}")
    return OperationOut(operation=operation, message=message)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@router.post("/switchover", response_model=OperationOut)
async def switchover(
    body: SwitchoverIn, profile: Profile, box: Box, request: Request, user: OperatorUser, db: DB
):
    async with make_client(profile, box, request) as client:
        try:
            members = (await client.status()).members
        except PatroniError as exc:
            raise _http_error(exc) from exc
        leader = next((m.name for m in members if m.role in ("leader", "standby_leader")), None)
        if leader is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cluster has no leader; use failover")
        if body.candidate == leader:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Candidate is already the leader")
        desc = f"Switchover from {leader} to {body.candidate or 'the best replica'}"
        if body.scheduled_at:
            desc += f" at {body.scheduled_at.isoformat()}"
        return await _run(
            profile,
            db,
            user,
            "switchover",
            desc,
            lambda: client.switchover(leader, body.candidate, _iso(body.scheduled_at)),
            body.candidate,
        )


@router.delete("/switchover", response_model=OperationOut)
async def cancel_switchover(
    profile: Profile, box: Box, request: Request, user: OperatorUser, db: DB
):
    async with make_client(profile, box, request) as client:
        return await _run(
            profile,
            db,
            user,
            "cancel_switchover",
            "Cancel scheduled switchover",
            client.cancel_switchover,
        )


@router.post("/failover", response_model=OperationOut)
async def failover(
    body: FailoverIn, profile: Profile, box: Box, request: Request, user: OperatorUser, db: DB
):
    async with make_client(profile, box, request) as client:
        return await _run(
            profile,
            db,
            user,
            "failover",
            f"Failover to {body.candidate}",
            lambda: client.failover(body.candidate),
            body.candidate,
        )


@router.post("/pause", response_model=OperationOut)
async def pause(
    body: PauseIn, profile: Profile, box: Box, request: Request, user: OperatorUser, db: DB
):
    async with make_client(profile, box, request) as client:
        return await _run(
            profile,
            db,
            user,
            "pause" if body.paused else "resume",
            "Pause cluster management" if body.paused else "Resume cluster management",
            lambda: client.set_pause(body.paused),
        )


@router.post("/members/{name}/restart", response_model=OperationOut)
async def restart_member(
    name: str,
    body: RestartIn,
    profile: Profile,
    box: Box,
    request: Request,
    user: OperatorUser,
    db: DB,
):
    async with make_client(profile, box, request) as client:
        member = await _member(client, name)
        desc = f"Restart PostgreSQL on {name}"
        if body.pending_only:
            desc += " (only if a restart is pending)"
        if body.schedule:
            desc += f" at {body.schedule.isoformat()}"
        return await _run(
            profile,
            db,
            user,
            "restart",
            desc,
            lambda: client.restart(member, body.pending_only, _iso(body.schedule)),
            name,
        )


@router.delete("/members/{name}/restart", response_model=OperationOut)
async def cancel_restart(
    name: str, profile: Profile, box: Box, request: Request, user: OperatorUser, db: DB
):
    async with make_client(profile, box, request) as client:
        member = await _member(client, name)
        return await _run(
            profile,
            db,
            user,
            "cancel_restart",
            f"Cancel scheduled restart on {name}",
            lambda: client.cancel_restart(member),
            name,
        )


@router.post("/members/{name}/reinitialize", response_model=OperationOut)
async def reinitialize_member(
    name: str,
    body: ReinitializeIn,
    profile: Profile,
    box: Box,
    request: Request,
    user: OperatorUser,
    db: DB,
):
    async with make_client(profile, box, request) as client:
        member = await _member(client, name)
        if member.role in ("leader", "standby_leader"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The leader cannot be reinitialized")
        return await _run(
            profile,
            db,
            user,
            "reinitialize",
            f"Reinitialize {name} from the leader{' (force)' if body.force else ''}",
            lambda: client.reinitialize(member, body.force),
            name,
        )


@router.post("/members/{name}/reload", response_model=OperationOut)
async def reload_member(
    name: str, profile: Profile, box: Box, request: Request, user: OperatorUser, db: DB
):
    async with make_client(profile, box, request) as client:
        member = await _member(client, name)
        return await _run(
            profile,
            db,
            user,
            "reload",
            f"Reload PostgreSQL configuration on {name}",
            lambda: client.reload(member),
            name,
        )


async def _member(client: PatroniClient, name: str):
    try:
        return await client.member(name)
    except PatroniError as exc:
        raise _http_error(exc) from exc
