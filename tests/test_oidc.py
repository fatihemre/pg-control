"""OIDC login against an in-process mock identity provider (httpx.MockTransport)."""

import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient

from pgcontrol.config import get_settings
from pgcontrol.security.oidc import OidcClient

ISSUER = "https://idp.test"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUB_PEM = KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
)
JWK = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key()))
JWK["kid"] = "k1"
JWK["use"] = "sig"


class MockIdp:
    def __init__(self, claims: dict):
        self.claims = claims
        self.nonce: str | None = None
        self.token_requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/auth",
                    "token_endpoint": f"{ISSUER}/token",
                    "jwks_uri": f"{ISSUER}/jwks",
                },
            )
        if path == "/jwks":
            return httpx.Response(200, json={"keys": [JWK]})
        if path == "/token":
            form = parse_qs(request.content.decode())
            self.token_requests.append(form)
            if form.get("code") != ["good-code"]:
                return httpx.Response(400, json={"error": "invalid_grant"})
            now = int(time.time())
            payload = {
                **self.claims,
                "iss": ISSUER,
                "aud": "pgcontrol",
                "iat": now,
                "exp": now + 300,
                "nonce": self.nonce,
            }
            token = jwt.encode(payload, KEY, algorithm="RS256", headers={"kid": "k1"})
            return httpx.Response(200, json={"id_token": token, "access_token": "x"})
        return httpx.Response(404)


@pytest.fixture
def idp(client: AsyncClient):
    from pgcontrol.main import app

    idp = MockIdp({"sub": "user-1", "preferred_username": "alice", "groups": ["pg-ops"]})
    app.state.oidc = OidcClient(get_settings(), transport=httpx.MockTransport(idp.handler))
    return idp


async def _start(client: AsyncClient, idp: MockIdp) -> str:
    r = await client.get("/api/auth/oidc/login")
    assert r.status_code == 302
    url = urlparse(r.headers["location"])
    q = parse_qs(url.query)
    assert url.path == "/auth" and q["code_challenge_method"] == ["S256"]
    assert q["redirect_uri"] == ["http://pgcontrol.test/api/auth/oidc/callback"]
    idp.nonce = q["nonce"][0]
    return q["state"][0]


async def test_providers(client: AsyncClient):
    r = await client.get("/api/auth/providers")
    assert r.json() == {"local": True, "oidc": {"name": "Single sign-on"}}


async def test_oidc_login_creates_user_with_mapped_role(client: AsyncClient, idp: MockIdp):
    state = await _start(client, idp)
    r = await client.get(f"/api/auth/oidc/callback?code=good-code&state={state}")
    assert r.status_code == 302 and r.headers["location"] == "/"
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert body["username"] == "alice" and body["role"] == "operator"
    assert body["auth_provider"] == "oidc"
    # PKCE verifier was sent to the token endpoint
    assert "code_verifier" in idp.token_requests[-1]
    # a password login for an SSO-only account is refused
    r = await client.post("/api/auth/login", json={"username": "alice", "password": ""})
    assert r.status_code == 401


async def test_oidc_role_follows_idp_groups(client: AsyncClient, idp: MockIdp):
    state = await _start(client, idp)
    await client.get(f"/api/auth/oidc/callback?code=good-code&state={state}")
    assert (await client.get("/api/auth/me")).json()["role"] == "operator"
    await client.post("/api/auth/logout")
    idp.claims["groups"] = ["pg-admins", "pg-ops"]
    state = await _start(client, idp)
    await client.get(f"/api/auth/oidc/callback?code=good-code&state={state}")
    assert (await client.get("/api/auth/me")).json()["role"] == "admin"


async def test_oidc_rejects_bad_state_and_code(client: AsyncClient, idp: MockIdp):
    state = await _start(client, idp)
    r = await client.get("/api/auth/oidc/callback?code=good-code&state=forged")
    assert r.status_code == 302 and "error=" in r.headers["location"]
    assert (await client.get("/api/auth/me")).status_code == 401
    state = await _start(client, idp)
    r = await client.get(f"/api/auth/oidc/callback?code=bad-code&state={state}")
    assert (
        "Token+exchange+failed" in r.headers["location"]
        or "Token%20exchange" in r.headers["location"]
    )
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_oidc_rejects_wrong_nonce(client: AsyncClient, idp: MockIdp):
    state = await _start(client, idp)
    idp.nonce = "something-else"
    r = await client.get(f"/api/auth/oidc/callback?code=good-code&state={state}")
    assert "nonce" in r.headers["location"]
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_oidc_idp_error_is_relayed(client: AsyncClient, idp: MockIdp):
    await _start(client, idp)
    r = await client.get("/api/auth/oidc/callback?error=access_denied&error_description=Nope")
    assert r.headers["location"] == "/login?error=Nope"
