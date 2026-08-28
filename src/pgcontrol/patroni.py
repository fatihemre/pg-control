"""Patroni REST API client (https://patroni.readthedocs.io/en/latest/rest_api.html).

Read endpoints (``/cluster``, ``/patroni``, ``/config``, ``/history``) need no credentials;
the "unsafe" ones (switchover, failover, restart, reinitialize, reload, config PATCH) use
HTTP basic auth when ``restapi.authentication`` is configured on the Patroni side.
Member-level operations are sent to the ``api_url`` Patroni itself reports for the member,
never to a caller-supplied address.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx


class PatroniError(Exception):
    """A Patroni request failed; ``status`` is the HTTP status (0 for transport errors)."""

    def __init__(self, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class Member:
    name: str
    role: str  # leader | replica | sync_standby | standby_leader | ...
    state: str  # running | streaming | stopped | starting | ...
    host: str | None
    port: int | None
    api_url: str | None
    timeline: int | None
    lag: int | None  # bytes behind the leader (replicas only)
    lag_unknown: bool
    pending_restart: bool
    scheduled_restart: dict | None
    tags: dict = field(default_factory=dict)

    @property
    def base_url(self) -> str | None:
        """Member API root (``api_url`` minus the trailing ``/patroni``)."""
        if not self.api_url:
            return None
        url = self.api_url.rstrip("/")
        return url[: -len("/patroni")] if url.endswith("/patroni") else url


@dataclass
class HistoryEntry:
    timeline: int
    lsn: int | None
    reason: str
    timestamp: str | None
    new_leader: str | None


@dataclass
class ClusterStatus:
    scope: str | None
    patroni_version: str | None
    pause: bool
    scheduled_switchover: dict | None
    leader: str | None
    members: list[Member]
    node: dict  # normalised /patroni of the configured endpoint
    history: list[HistoryEntry]
    config: dict

    def to_dict(self) -> dict:
        return {
            "scope": self.scope,
            "patroni_version": self.patroni_version,
            "pause": self.pause,
            "scheduled_switchover": self.scheduled_switchover,
            "leader": self.leader,
            "members": [
                {
                    "name": m.name,
                    "role": m.role,
                    "state": m.state,
                    "host": m.host,
                    "port": m.port,
                    "api_url": m.api_url,
                    "timeline": m.timeline,
                    "lag": m.lag,
                    "lag_unknown": m.lag_unknown,
                    "pending_restart": m.pending_restart,
                    "scheduled_restart": m.scheduled_restart,
                    "tags": m.tags,
                }
                for m in self.members
            ],
            "node": self.node,
            "history": [h.__dict__ for h in self.history],
            "config": self.config,
        }


def _int(v: Any) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _member(raw: dict) -> Member:
    lag = raw.get("lag")
    return Member(
        name=str(raw.get("name", "?")),
        role=str(raw.get("role", "?")),
        state=str(raw.get("state", "?")),
        host=raw.get("host"),
        port=_int(raw.get("port")),
        api_url=raw.get("api_url"),
        timeline=_int(raw.get("timeline")),
        lag=_int(lag) if lag not in (None, "unknown") else None,
        lag_unknown=lag == "unknown",
        pending_restart=bool(raw.get("pending_restart")),
        scheduled_restart=raw.get("scheduled_restart"),
        tags=raw.get("tags") or {},
    )


def _history(raw: Any) -> list[HistoryEntry]:
    out: list[HistoryEntry] = []
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, list) or len(row) < 3:
            continue
        out.append(
            HistoryEntry(
                timeline=_int(row[0]) or 0,
                lsn=_int(row[1]),
                reason=str(row[2]),
                timestamp=str(row[3]) if len(row) > 3 and row[3] is not None else None,
                new_leader=str(row[4]) if len(row) > 4 and row[4] is not None else None,
            )
        )
    return out


def _node(raw: dict) -> dict:
    """Trim ``GET /patroni`` down to what the UI shows."""
    patroni = raw.get("patroni") or {}
    dcs_seen = raw.get("dcs_last_seen")
    return {
        "name": patroni.get("name"),
        "scope": patroni.get("scope"),
        "version": patroni.get("version"),
        "role": raw.get("role"),
        "state": raw.get("state"),
        "timeline": _int(raw.get("timeline")),
        "server_version": _int(raw.get("server_version")),
        "postmaster_start_time": raw.get("postmaster_start_time"),
        "dcs_last_seen": (
            datetime.fromtimestamp(dcs_seen, tz=UTC).isoformat()
            if isinstance(dcs_seen, int | float)
            else None
        ),
        "pending_restart": bool(raw.get("pending_restart")),
        "cluster_unlocked": bool(raw.get("cluster_unlocked")),
        "xlog": raw.get("xlog") or {},
        "replication": raw.get("replication") or [],
    }


class PatroniClient:
    def __init__(
        self,
        base_url: str,
        username: str | None = None,
        password: str | None = None,
        *,
        timeout: float = 15.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._auth = (username, password or "") if username else None
        self._client = httpx.AsyncClient(
            timeout=timeout, transport=transport, follow_redirects=False
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> PatroniClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def _request(
        self, method: str, url: str, *, json: Any = None, auth: bool = False
    ) -> httpx.Response:
        try:
            return await self._client.request(
                method, url, json=json, auth=self._auth if auth else None
            )
        except httpx.HTTPError as exc:
            raise PatroniError(f"Patroni request failed: {exc}") from exc

    async def _get_json(self, path: str, base: str | None = None) -> Any:
        r = await self._request("GET", f"{base or self.base_url}{path}")
        if r.status_code >= 400 and path != "/patroni":
            raise PatroniError(_text(r), r.status_code)
        try:
            return r.json()
        except ValueError as exc:
            raise PatroniError(f"Patroni returned a non-JSON body for {path}") from exc

    async def _action(
        self, method: str, url: str, json: Any = None, ok: tuple[int, ...] = (200, 202)
    ) -> str:
        """Run an unsafe endpoint and return Patroni's (text) response body."""
        r = await self._request(method, url, json=json, auth=True)
        if r.status_code not in ok:
            raise PatroniError(_text(r), r.status_code)
        return _text(r)

    # -- read ---------------------------------------------------------------------------

    async def cluster(self) -> dict:
        return await self._get_json("/cluster")

    async def node(self, base: str | None = None) -> dict:
        # /patroni answers 503 for a non-running or replica-with-no-primary node; still JSON.
        return await self._get_json("/patroni", base)

    async def config(self) -> dict:
        return await self._get_json("/config")

    async def history(self) -> list:
        return await self._get_json("/history")

    async def status(self) -> ClusterStatus:
        cluster = await self.cluster()
        node = await self.node()
        try:
            config = await self.config()
        except PatroniError:
            config = {}
        try:
            history = await self.history()
        except PatroniError:
            history = []
        members = [_member(m) for m in cluster.get("members", [])]
        leader = next((m.name for m in members if m.role in ("leader", "standby_leader")), None)
        patroni = node.get("patroni") or {}
        return ClusterStatus(
            scope=cluster.get("scope") or patroni.get("scope"),
            patroni_version=patroni.get("version"),
            pause=bool(cluster.get("pause")),
            scheduled_switchover=cluster.get("scheduled_switchover"),
            leader=leader,
            members=members,
            node=_node(node),
            history=_history(history),
            config=config if isinstance(config, dict) else {},
        )

    async def member(self, name: str) -> Member:
        for m in (_member(x) for x in (await self.cluster()).get("members", [])):
            if m.name == name:
                if not m.base_url:
                    raise PatroniError(f"Member {name} has no API URL", 409)
                return m
        raise PatroniError(f"Member {name} not found in cluster", 404)

    # -- cluster-wide operations --------------------------------------------------------

    async def switchover(
        self, leader: str, candidate: str | None, scheduled_at: str | None = None
    ) -> str:
        body: dict[str, Any] = {"leader": leader}
        if candidate:
            body["candidate"] = candidate
        if scheduled_at:
            body["scheduled_at"] = scheduled_at
        return await self._action("POST", f"{self.base_url}/switchover", body)

    async def cancel_switchover(self) -> str:
        return await self._action("DELETE", f"{self.base_url}/switchover")

    async def failover(self, candidate: str | None, leader: str | None = None) -> str:
        body: dict[str, Any] = {}
        if candidate:
            body["candidate"] = candidate
        if leader:
            body["leader"] = leader
        return await self._action("POST", f"{self.base_url}/failover", body)

    async def set_pause(self, paused: bool) -> str:
        return await self._action("PATCH", f"{self.base_url}/config", {"pause": paused})

    # -- member operations --------------------------------------------------------------

    async def restart(
        self, member: Member, pending_only: bool = False, schedule: str | None = None
    ) -> str:
        body: dict[str, Any] = {}
        if pending_only:
            body["restart_pending"] = True
        if schedule:
            body["schedule"] = schedule
        return await self._action("POST", f"{member.base_url}/restart", body)

    async def cancel_restart(self, member: Member) -> str:
        return await self._action("DELETE", f"{member.base_url}/restart")

    async def reinitialize(self, member: Member, force: bool = False) -> str:
        return await self._action(
            "POST", f"{member.base_url}/reinitialize", {"force": True} if force else {}
        )

    async def reload(self, member: Member) -> str:
        return await self._action("POST", f"{member.base_url}/reload")


def _text(r: httpx.Response) -> str:
    text = r.text.strip()
    if not text:
        return f"HTTP {r.status_code}"
    try:
        data = r.json()
    except ValueError:
        return text
    if isinstance(data, dict) and len(data) == 1 and isinstance(next(iter(data.values())), str):
        return next(iter(data.values()))
    return text
