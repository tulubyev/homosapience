import base64
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption

from services.did_key import DIDKey
from services.db_service import DatabaseService
from services.server_key import ServerKey
from services import embed_service
import routers.embed as embed_router


def _make_user_did() -> DIDKey:
    return DIDKey.generate()


@pytest.fixture
async def app_client():
    # Build a minimal app with only the embed router
    app = FastAPI()
    app.include_router(embed_router.router, prefix="/api/embed")

    db = DatabaseService()
    await db.connect()
    app.state.db = db
    app.state.server_key = ServerKey(__import__("os").environ["APTOGON_JWT_PRIVATE_KEY"])
    app.state.aptos = None
    # no rate_limiter → embed router uses in-memory nonce fallback

    # Seed one API key with a REAL secret hash so /verify can be exercised
    from services.api_keys import hash_secret
    await db.create_api_key("pk_live_test", hash_secret("sk_live_TESTSECRET"),
                            "did:key:zOwner", "Test", ["https://site.com"])

    # Seed a verified user credential
    user = _make_user_did()
    await db.save_credential(
        did=user.did, did_hash="h", expression_proof="p",
        bond_count=3, trust_score=0.5, trust_label="community_verified",
    )

    client = TestClient(app)
    # Reset in-memory nonce stores between tests
    embed_service._mem_nonces.clear()
    embed_service._mem_redeemed.clear()
    return client, user


async def test_full_happy_path(app_client):
    client, user = app_client
    # challenge
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    assert r.status_code == 200
    nonce = r.json()["nonce"]
    # assert
    msg = embed_service.assert_message(nonce, "https://site.com", user.did)
    sig = user.sign(msg)
    r = client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_test", "nonce": nonce,
        "did": user.did, "signature": sig,
    })
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert token
    # verify (S2S) with the real secret key
    r = client.post("/api/embed/verify", json={"token": token},
                    headers={"Authorization": "Bearer sk_live_TESTSECRET"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["human"] is True
    assert body["trust_band"] == "community"
    # double-spend rejected
    r2 = client.post("/api/embed/verify", json={"token": token},
                     headers={"Authorization": "Bearer sk_live_TESTSECRET"})
    assert r2.status_code == 409


async def test_assert_no_credential_returns_needs_verification(app_client):
    client, _ = app_client
    stranger = _make_user_did()
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    msg = embed_service.assert_message(nonce, "https://site.com", stranger.did)
    sig = stranger.sign(msg)
    r = client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_test", "nonce": nonce,
        "did": stranger.did, "signature": sig,
    })
    assert r.status_code == 200
    body = r.json()
    assert body.get("needs_verification") is True
    assert "verify_url" in body


async def test_assert_replay_rejected(app_client):
    client, user = app_client
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    msg = embed_service.assert_message(nonce, "https://site.com", user.did)
    sig = user.sign(msg)
    body = {"publishable_key": "pk_live_test", "nonce": nonce, "did": user.did, "signature": sig}
    assert client.post("/api/embed/assert", json=body).status_code == 200
    # replay same nonce
    assert client.post("/api/embed/assert", json=body).status_code == 400


async def test_assert_bad_signature_rejected(app_client):
    client, user = app_client
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    r = client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_test", "nonce": nonce,
        "did": user.did, "signature": "AAAA",
    })
    assert r.status_code == 401


async def test_challenge_origin_not_allowed_rejected(app_client):
    client, _ = app_client
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://evil.com"})
    assert r.status_code == 403


async def test_jwks_endpoint(app_client):
    client, _ = app_client
    r = client.get("/api/embed/jwks")
    assert r.status_code == 200
    assert r.json()["keys"][0]["crv"] == "Ed25519"


async def test_verify_wrong_secret_rejected(app_client):
    client, user = app_client
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    msg = embed_service.assert_message(nonce, "https://site.com", user.did)
    sig = user.sign(msg)
    token = client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_test", "nonce": nonce,
        "did": user.did, "signature": sig,
    }).json()["token"]
    r = client.post("/api/embed/verify", json={"token": token},
                    headers={"Authorization": "Bearer sk_live_WRONG"})
    assert r.status_code == 401


async def test_verify_increments_usage(app_client):
    import time as _t
    client, user = app_client
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    msg = embed_service.assert_message(nonce, "https://site.com", user.did)
    sig = user.sign(msg)
    token = client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_test", "nonce": nonce,
        "did": user.did, "signature": sig,
    }).json()["token"]
    client.post("/api/embed/verify", json={"token": token},
                headers={"Authorization": "Bearer sk_live_TESTSECRET"})
    period = _t.strftime("%Y-%m", _t.gmtime())
    db = client.app.state.db
    assert await db.get_usage("pk_live_test", period) == 1


async def test_challenge_uses_body_origin_over_header(app_client):
    client, _ = app_client
    # Send a misleading Origin header; body origin must win.
    r = client.post(
        "/api/embed/challenge",
        json={"publishable_key": "pk_live_test", "origin": "https://site.com"},
        headers={"Origin": "https://homosapience.org"},
    )
    assert r.status_code == 200, r.text
    # https://site.com is in allowed_origins; https://homosapience.org is not.
    # If the header had won, this would have been 403.


async def test_assert_returns_trust_band(app_client):
    client, user = app_client
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    msg = embed_service.assert_message(nonce, "https://site.com", user.did)
    sig = user.sign(msg)
    r = client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_test", "nonce": nonce,
        "did": user.did, "signature": sig,
    })
    assert r.status_code == 200, r.text
    assert r.json()["trust_band"] == "community"   # seeded credential trust_score 0.5


import services.feature_flags as _ff


async def test_challenge_enforces_domain_verification_when_flag_on(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "REQUIRE_DOMAIN_VERIFICATION")
    # owner "did:key:zOwner" is NOT an admin and origin is NOT verified → 403
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "origin_not_verified"


async def test_challenge_allows_when_origin_verified(app_client, monkeypatch):
    client, _ = app_client
    db = client.app.state.db
    await db.create_domain_verification("did:key:zOwner", "https://site.com", "tok")
    row = (await db.list_domain_verifications("did:key:zOwner"))[0]
    await db.mark_domain_verified(row["id"], "dns_txt")
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "REQUIRE_DOMAIN_VERIFICATION")
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    assert r.status_code == 200, r.text


async def test_challenge_admin_owner_bypasses(app_client, monkeypatch):
    client, _ = app_client
    db = client.app.state.db
    owner = "did:key:zOwner"   # the owner_did the fixture seeds the key with
    await db.upsert_admin_did(did_short=owner[-8:], did_full=owner, role="admin")
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "REQUIRE_DOMAIN_VERIFICATION")
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    assert r.status_code == 200, r.text


async def test_challenge_flag_off_no_enforcement(app_client):
    # default env: REQUIRE_DOMAIN_VERIFICATION unset → off → 200
    client, _ = app_client
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    assert r.status_code == 200, r.text


async def _mk_token(client, user):
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    msg = embed_service.assert_message(nonce, "https://site.com", user.did)
    sig = user.sign(msg)
    return client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_test", "nonce": nonce,
        "did": user.did, "signature": sig,
    }).json()["token"]


async def test_verify_free_cap_blocks_when_exceeded(app_client, monkeypatch):
    client, user = app_client
    db = client.app.state.db
    import time as _t
    monkeypatch.setenv("FREE_VERIFY_CAP", "1")
    period = _t.strftime("%Y-%m", _t.gmtime())
    await db.increment_usage("pk_live_test", period)   # usage now == cap (1)
    token = await _mk_token(client, user)
    r = client.post("/api/embed/verify", json={"token": token},
                    headers={"Authorization": "Bearer sk_live_TESTSECRET"})
    assert r.status_code == 429
    assert r.json()["detail"]["error"] == "quota_exceeded"


async def test_verify_free_cap_admin_exempt(app_client, monkeypatch):
    client, user = app_client
    db = client.app.state.db
    import time as _t
    await db.upsert_admin_did(did_short="did:key:zOwner"[-8:], did_full="did:key:zOwner", role="admin")
    monkeypatch.setenv("FREE_VERIFY_CAP", "1")
    period = _t.strftime("%Y-%m", _t.gmtime())
    await db.increment_usage("pk_live_test", period)
    token = await _mk_token(client, user)
    r = client.post("/api/embed/verify", json={"token": token},
                    headers={"Authorization": "Bearer sk_live_TESTSECRET"})
    assert r.status_code == 200, r.text


async def test_challenge_coupling_self_serve_implies_enforcement(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "SELF_SERVE_KEYS")
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_test", "origin": "https://site.com"})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "origin_not_verified"
