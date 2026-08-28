"""OpenID Connect login (authorization code flow with PKCE).

The IdP is described by its discovery document; ID tokens are verified against the
published JWKS. PgControl users are matched by (auth_provider='oidc', subject) and
created on first login when ``PGCONTROL_OIDC_AUTO_CREATE`` is on.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from pgcontrol.config import Settings
from pgcontrol.security.auth import ROLE_RANK

STATE_TTL_SECONDS = 600


class OidcError(Exception):
    """Login could not be completed; the message is safe to show to the user."""


@dataclass
class Identity:
    subject: str
    username: str
    role: str
    claims: dict[str, Any]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class OidcClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        assert settings.oidc_issuer and settings.oidc_client_id
        self.settings = settings
        self.issuer = settings.oidc_issuer.rstrip("/")
        self.client_id = settings.oidc_client_id
        self._transport = transport
        self._metadata: dict[str, Any] | None = None
        self._jwks: dict[str, Any] | None = None
        self._jwks_fetched = 0.0
        self._signer = hmac.new(settings.secret_key.encode(), b"oidc-state", hashlib.sha256)

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self._transport, timeout=10)

    async def metadata(self) -> dict[str, Any]:
        if self._metadata is None:
            async with self._http() as http:
                r = await http.get(f"{self.issuer}/.well-known/openid-configuration")
                r.raise_for_status()
                self._metadata = r.json()
        return self._metadata

    async def jwks(self, force: bool = False) -> dict[str, Any]:
        if self._jwks is None or force or time.time() - self._jwks_fetched > 3600:
            meta = await self.metadata()
            async with self._http() as http:
                r = await http.get(meta["jwks_uri"])
                r.raise_for_status()
                self._jwks = r.json()
                self._jwks_fetched = time.time()
        return self._jwks

    # --- state cookie -------------------------------------------------------------------

    def _sign(self, payload: str) -> str:
        mac = self._signer.copy()
        mac.update(payload.encode())
        return mac.hexdigest()

    def new_state(self) -> tuple[dict[str, str], str]:
        """Return (state values, signed cookie value)."""
        values = {
            "state": secrets.token_urlsafe(24),
            "nonce": secrets.token_urlsafe(24),
            "verifier": secrets.token_urlsafe(48),
            "exp": str(int(time.time()) + STATE_TTL_SECONDS),
        }
        payload = _b64url(json.dumps(values).encode())
        return values, f"{payload}.{self._sign(payload)}"

    def read_state(self, cookie: str | None) -> dict[str, str]:
        if not cookie or "." not in cookie:
            raise OidcError("Login session missing or expired; start again.")
        payload, sig = cookie.rsplit(".", 1)
        if not hmac.compare_digest(sig, self._sign(payload)):
            raise OidcError("Login session is invalid; start again.")
        values = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if int(values.get("exp", 0)) < time.time():
            raise OidcError("Login session expired; start again.")
        return values

    # --- flow ---------------------------------------------------------------------------

    async def authorization_url(self, redirect_uri: str, state: dict[str, str]) -> str:
        meta = await self.metadata()
        challenge = _b64url(hashlib.sha256(state["verifier"].encode()).digest())
        query = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "scope": self.settings.oidc_scopes,
            "state": state["state"],
            "nonce": state["nonce"],
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return f"{meta['authorization_endpoint']}?{urlencode(query)}"

    async def exchange_code(self, code: str, redirect_uri: str, verifier: str) -> dict[str, Any]:
        meta = await self.metadata()
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": self.client_id,
            "code_verifier": verifier,
        }
        auth = None
        if self.settings.oidc_client_secret:
            auth = (self.client_id, self.settings.oidc_client_secret)
        async with self._http() as http:
            r = await http.post(meta["token_endpoint"], data=data, auth=auth)
        if r.status_code != 200:
            raise OidcError(f"Token exchange failed ({r.status_code}).")
        tokens = r.json()
        if "id_token" not in tokens:
            raise OidcError("The identity provider returned no ID token.")
        return tokens

    async def verify_id_token(self, token: str, nonce: str) -> dict[str, Any]:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "RS256")
        if alg.startswith("HS"):
            if not self.settings.oidc_client_secret:
                raise OidcError("ID token is HMAC-signed but no client secret is configured.")
            key: Any = self.settings.oidc_client_secret
        else:
            key = await self._signing_key(header.get("kid"))
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=self.client_id,
                issuer=self.issuer,
                options={"require": ["exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise OidcError(f"ID token rejected: {exc}") from exc
        if claims.get("nonce") != nonce:
            raise OidcError("ID token nonce mismatch.")
        return claims

    async def _signing_key(self, kid: str | None):
        for attempt in range(2):
            keys = (await self.jwks(force=attempt == 1)).get("keys", [])
            candidates = [k for k in keys if kid is None or k.get("kid") == kid]
            if candidates:
                return jwt.PyJWK.from_dict(candidates[0]).key
        raise OidcError("No matching signing key in the provider's JWKS.")

    # --- mapping ------------------------------------------------------------------------

    def identity(self, claims: dict[str, Any]) -> Identity:
        s = self.settings
        username = claims.get(s.oidc_username_claim) or claims.get("email") or claims["sub"]
        role = self._map_role(claims)
        if role is None:
            raise OidcError("Your account has no PgControl role; ask an administrator.")
        return Identity(
            subject=claims["sub"], username=str(username)[:64], role=role, claims=claims
        )

    def _map_role(self, claims: dict[str, Any]) -> str | None:
        s = self.settings
        if not s.oidc_role_claim:
            return s.oidc_default_role
        raw = claims.get(s.oidc_role_claim)
        groups = {str(g) for g in (raw if isinstance(raw, list) else [raw] if raw else [])}
        mapping: dict[str, str] = {}
        for pair in filter(None, (p.strip() for p in s.oidc_role_map.split(","))):
            group, _, role = pair.rpartition(":")
            if role in ROLE_RANK:
                mapping[group] = role
        matched = [mapping[g] for g in groups if g in mapping]
        if not matched:
            return s.oidc_default_role
        return max(matched, key=lambda r: ROLE_RANK[r])
