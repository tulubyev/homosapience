"""
Auth hardening tests for /api/pair/* (DEVICE_ACCOUNTS feature).

Threat model: knowing a victim's DID must NOT be enough to act in their name.
The unsigned X-APTOGON-DID header is rejected on privileged endpoints; only
Bearer JWT (proof of Ed25519 key ownership via /api/auth/session) is accepted.

These tests cover the 4 endpoints touched by Variant A hardening:
  POST /api/pair/create
  GET  /api/pair/devices
  GET  /api/pair/account
  POST /api/pair/unlink
"""
import os
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Enable feature flag BEFORE importing the router so _require_device_accounts passes.
os.environ["FEATURE_DEVICE_ACCOUNTS"] = "true"

from services.db_service import DatabaseService          # noqa: E402
from routers import pair as pair_router                   # noqa: E402
from routers.auth import _issue_jwt                       # noqa: E402
from middleware.firewall import AptogonFirewall          # noqa: E402


VICTIM_DID   = "did:key:zVictimAAAAAAAA"
ATTACKER_DID = "did:key:zAttackerBBBBBB"


class _StubAptos:
    """Minimal aptos stub: every DID is_human (test focuses on auth, not liveness)."""
    async def is_human(self, did: str) -> bool:
        return True


@pytest.fixture
async def client():
    app = FastAPI()
    # IMPORTANT: install the same firewall as prod. It promotes both Bearer
    # JWT and legacy X-APTOGON-DID into request.state.did — and our strict
    # auth helper must reject the legacy promotion. Without this middleware
    # the test would falsely pass (no state.did set → helper falls through
    # to direct Bearer parse only).
    app.add_middleware(AptogonFirewall)
    app.include_router(pair_router.router, prefix="/api/pair")

    db = DatabaseService()
    # Force the in-memory backend. TestClient runs the app in an anyio portal
    # event loop, but a real asyncpg pool would be created in the pytest-asyncio
    # loop — asyncpg connections are loop-bound, so crossing them raises
    # "another operation is in progress" / "attached to a different loop".
    # These auth tests don't care which DB engine is used, so we pin mem.
    db._use_mem = True
    await db.connect()   # no-op in mem mode
    app.state.db    = db
    app.state.aptos = _StubAptos()
    app.state.rate_limiter = None   # disable RL for tests

    # Both DIDs hold valid credentials (so require_*_did's credential check passes
    # whenever we get past the auth gate).
    await db.save_credential(
        did=VICTIM_DID,   did_hash="hV", expression_proof="p",
        bond_count=0, trust_score=0.1, trust_label="newcomer",
    )
    await db.save_credential(
        did=ATTACKER_DID, did_hash="hA", expression_proof="p",
        bond_count=0, trust_score=0.1, trust_label="newcomer",
    )
    return TestClient(app)


def _bearer(did: str) -> dict:
    """Mint a real Bearer JWT for `did` — the only way past require_proven_did."""
    jwt = _issue_jwt(did, session_id="test-sid")
    return {"Authorization": f"Bearer {jwt['token']}"}


# ── 1. /create — strict auth ──────────────────────────────────────────────────

async def test_create_rejects_unsigned_did_header(client):
    """The legacy X-APTOGON-DID header MUST NOT authenticate /create."""
    r = client.post("/api/pair/create", headers={"X-APTOGON-DID": VICTIM_DID})
    assert r.status_code == 401, r.text
    assert r.json()["detail"]["error"] == "bearer_jwt_required"


async def test_create_rejects_missing_auth(client):
    """No auth at all → the AptogonFirewall middleware rejects with 403
    auth_required BEFORE the request reaches require_proven_did. Either way
    the request is denied; we just assert the firewall gate (403) here, since
    that's what fires first in production for a completely unauthenticated call."""
    r = client.post("/api/pair/create")
    assert r.status_code == 403


async def test_create_accepts_bearer_jwt(client):
    r = client.post("/api/pair/create", headers=_bearer(VICTIM_DID))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["link_code"]) == 6
    assert body["verify_url"].endswith(body["link_code"])


# ── 2. /devices — strict auth ─────────────────────────────────────────────────

async def test_devices_rejects_unsigned_did_header(client):
    r = client.get("/api/pair/devices", headers={"X-APTOGON-DID": VICTIM_DID})
    assert r.status_code == 401


async def test_devices_accepts_bearer_jwt(client):
    r = client.get("/api/pair/devices", headers=_bearer(VICTIM_DID))
    assert r.status_code == 200
    assert r.json()["this_did"] == VICTIM_DID


# ── 3. /account — strict auth ─────────────────────────────────────────────────

async def test_account_rejects_unsigned_did_header(client):
    r = client.get("/api/pair/account", headers={"X-APTOGON-DID": VICTIM_DID})
    assert r.status_code == 401


async def test_account_accepts_bearer_jwt(client):
    r = client.get("/api/pair/account", headers=_bearer(VICTIM_DID))
    assert r.status_code == 200


# ── 4. /unlink — strict auth + same-person check ──────────────────────────────

async def test_unlink_rejects_unsigned_did_header(client):
    """Even with X-APTOGON-DID, attacker cannot impersonate victim to unlink."""
    r = client.post(
        "/api/pair/unlink",
        headers={"X-APTOGON-DID": VICTIM_DID},
        json={"did": VICTIM_DID},
    )
    assert r.status_code == 401


async def test_unlink_blocks_cross_person(client):
    """With a real JWT, attacker still cannot unlink a device in another person."""
    r = client.post(
        "/api/pair/unlink",
        headers=_bearer(ATTACKER_DID),
        json={"did": VICTIM_DID},
    )
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "not_your_device"


# ── 5. End-to-end attack scenario is now blocked ──────────────────────────────

async def test_attacker_cannot_join_victim_person_via_create_header_only(client):
    """
    The original Variant-A attack: attacker calls /create with X-APTOGON-DID:
    <victim_did> (no signature), expecting to mint a link_code in victim's name,
    then claim it with their own is_human DID and end up inside victim's person.

    With require_proven_did, step 1 is blocked → no link_code can be minted,
    so the whole chain fails at the door.
    """
    r = client.post("/api/pair/create", headers={"X-APTOGON-DID": VICTIM_DID})
    assert r.status_code == 401, "Attacker minted a link_code without signing!"
