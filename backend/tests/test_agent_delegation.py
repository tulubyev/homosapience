"""
Tests for HDAA: Human-Delegated Agent Authentication (/api/agent/*)

Coverage:
  test_delegate_success          — verified human creates a delegation token
  test_verify_valid_token        — public verify returns trust info
  test_verify_expired            — expired token → 403 + reason: expired
  test_verify_revoked            — revoked token → 403 + reason: revoked
  test_revoke_delegation         — DELETE /{id} works and blocks subsequent verify
  test_unverified_cannot_delegate — unverified DID → 403
  test_verify_no_human_did       — privacy: human_did absent from /verify response
"""
import os
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ["FEATURE_AGENT_PASSPORT"] = "true"

from services.db_service import DatabaseService   # noqa: E402
from routers import agent as agent_router          # noqa: E402
from routers.auth import _issue_jwt                # noqa: E402
from middleware.firewall import AptogonFirewall    # noqa: E402


HUMAN_DID       = "did:key:zHumanAAAAAAA"
UNVERIFIED_DID  = "did:key:zUnverified00"


def _bearer(did: str) -> dict:
    jwt = _issue_jwt(did, session_id="test-sid")
    return {"Authorization": f"Bearer {jwt['token']}"}


@pytest.fixture
async def client():
    app = FastAPI()
    app.add_middleware(AptogonFirewall)
    app.include_router(agent_router.router, prefix="/api/agent")

    db = DatabaseService()
    db._use_mem = True
    await db.connect()

    now = int(time.time())
    # Verified human with trust_score 0.95
    await db.save_credential(
        did=HUMAN_DID,
        did_hash="h_human",
        expression_proof="proof_human",
        bond_count=3,
        trust_score=0.95,
        trust_label="community_verified",
    )

    app.state.db = db
    return TestClient(app)


# ── 1. Verified human creates delegation ─────────────────────────────────────

async def test_delegate_success(client):
    r = client.post(
        "/api/agent/delegate",
        json={"agent_id": "my-shopping-agent", "permissions": ["read"]},
        headers=_bearer(HUMAN_DID),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body
    assert body["agent_id"] == "my-shopping-agent"
    assert body["permissions"] == ["read"]
    assert "delegation_id" in body
    assert body["expires_at"] > int(time.time())


# ── 2. Public verify returns trust info ───────────────────────────────────────

async def test_verify_valid_token(client):
    # Create a delegation first
    create = client.post(
        "/api/agent/delegate",
        json={"agent_id": "browsing-agent"},
        headers=_bearer(HUMAN_DID),
    )
    token = create.json()["token"]

    r = client.get(f"/api/agent/verify?token={token}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["valid"] is True
    assert body["human_trust_score"] == pytest.approx(0.95)
    assert body["human_trust_label"] == "community_verified"
    assert body["agent_id"] == "browsing-agent"
    assert body["permissions"] == ["read"]
    assert "expires_at" in body


# ── 3. Expired token → 403 ────────────────────────────────────────────────────

async def test_verify_expired(client):
    # Issue a token that expires in the past by passing expires_in=60
    # then manipulate the DB record to have expires_at in the past
    create = client.post(
        "/api/agent/delegate",
        json={"agent_id": "expired-agent", "expires_in": 60},
        headers=_bearer(HUMAN_DID),
    )
    assert create.status_code == 200
    token = create.json()["token"]
    delegation_id = create.json()["delegation_id"]

    # Force-expire by mutating the in-memory record
    db = client.app.state.db
    for d in db._mem_delegations:
        if d["id"] == delegation_id:
            d["expires_at"] = int(time.time()) - 10  # set to past

    r = client.get(f"/api/agent/verify?token={token}")
    assert r.status_code == 403
    assert r.json()["detail"]["reason"] == "expired"


# ── 4. Revoked token → 403 ────────────────────────────────────────────────────

async def test_verify_revoked(client):
    create = client.post(
        "/api/agent/delegate",
        json={"agent_id": "soon-revoked-agent"},
        headers=_bearer(HUMAN_DID),
    )
    token         = create.json()["token"]
    delegation_id = create.json()["delegation_id"]

    # Revoke it
    rev = client.delete(
        f"/api/agent/{delegation_id}",
        headers=_bearer(HUMAN_DID),
    )
    assert rev.status_code == 200

    # Verify now returns revoked
    r = client.get(f"/api/agent/verify?token={token}")
    assert r.status_code == 403
    assert r.json()["detail"]["reason"] == "revoked"


# ── 5. DELETE /{id} revoke endpoint ───────────────────────────────────────────

async def test_revoke_delegation(client):
    create = client.post(
        "/api/agent/delegate",
        json={"agent_id": "revoke-me-agent"},
        headers=_bearer(HUMAN_DID),
    )
    delegation_id = create.json()["delegation_id"]

    r = client.delete(f"/api/agent/{delegation_id}", headers=_bearer(HUMAN_DID))
    assert r.status_code == 200
    assert r.json()["status"] == "revoked"
    assert r.json()["delegation_id"] == delegation_id

    # Second revoke → 404
    r2 = client.delete(f"/api/agent/{delegation_id}", headers=_bearer(HUMAN_DID))
    assert r2.status_code == 404


# ── 6. Unverified DID cannot delegate ────────────────────────────────────────

async def test_unverified_cannot_delegate(client):
    # UNVERIFIED_DID has no credential in DB — require_proven_did should reject
    r = client.post(
        "/api/agent/delegate",
        json={"agent_id": "bad-agent"},
        headers=_bearer(UNVERIFIED_DID),
    )
    assert r.status_code in (401, 403)


# ── 7. Privacy: human_did absent from /verify response ───────────────────────

async def test_verify_no_human_did(client):
    create = client.post(
        "/api/agent/delegate",
        json={"agent_id": "privacy-check-agent"},
        headers=_bearer(HUMAN_DID),
    )
    token = create.json()["token"]

    r = client.get(f"/api/agent/verify?token={token}")
    assert r.status_code == 200
    body = r.json()
    assert "human_did" not in body, "human_did must never appear in /verify response"
    assert "valid" in body
    assert body["valid"] is True
