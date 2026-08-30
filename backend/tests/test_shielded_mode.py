"""
Phase C — Shielded Human mode: mode field + separate-DID handle ban.

A shielded credential is anonymity-first: it must never be linkable to a public
handle. The enforceable invariant tested here is that a shielded DID cannot
declare or publish a platform handle.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
import routers.handles as handles_router


# ── DB layer: mode persists ───────────────────────────────────────────────────

async def test_save_credential_mode_persists():
    db = DatabaseService()
    await db.connect()
    await db.save_credential(
        did="did:key:zShielded", did_hash="h", expression_proof="p",
        mode="shielded",
    )
    cred = await db.get_credential("did:key:zShielded")
    assert cred["mode"] == "shielded"


async def test_default_mode_public():
    db = DatabaseService()
    await db.connect()
    await db.save_credential(did="did:key:zPub", did_hash="h", expression_proof="p")
    cred = await db.get_credential("did:key:zPub")
    assert cred["mode"] == "public"


# ── handles router: shielded DID cannot declare/publish a handle ──────────────

@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(handles_router.router, prefix="/api/handles")
    db = DatabaseService()
    await db.connect()
    await db.save_credential(
        did="did:key:zPublic", did_hash="hp", expression_proof="p",
        trust_score=0.5, trust_label="community_verified", mode="public",
    )
    await db.save_credential(
        did="did:key:zHidden", did_hash="hh", expression_proof="p",
        trust_score=0.1, trust_label="newcomer", mode="shielded",
    )
    app.state.db = db
    return TestClient(app)


async def test_shielded_did_cannot_declare_handle(client):
    r = client.post("/api/handles",
                    json={"platform": "github", "username": "ghost"},
                    headers={"X-APTOGON-DID": "did:key:zHidden"})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "shielded_no_handles"


async def test_public_did_can_declare_handle(client):
    r = client.post("/api/handles",
                    json={"platform": "github", "username": "alice"},
                    headers={"X-APTOGON-DID": "did:key:zPublic"})
    assert r.status_code == 200, r.text


async def test_shielded_did_cannot_set_visibility(client):
    r = client.patch("/api/handles/github/ghost",
                     json={"is_public": True},
                     headers={"X-APTOGON-DID": "did:key:zHidden"})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "shielded_no_handles"


# ── bond router: shielded DID cannot request bonds (stays newcomer) ───────────

@pytest.fixture
async def bond_client():
    import routers.bond as bond_router
    app = FastAPI()
    app.include_router(bond_router.router, prefix="/api/bond")
    db = DatabaseService()
    await db.connect()
    await db.save_credential(did="did:key:zHidden2", did_hash="hh", expression_proof="p",
                             mode="shielded")
    await db.save_credential(did="did:key:zPublic2", did_hash="hp", expression_proof="p",
                             mode="public")
    app.state.db = db
    app.state.aptos = None
    app.state.behavior = None
    return TestClient(app)


async def test_shielded_did_cannot_request_bond(bond_client):
    r = bond_client.post("/api/bond/request",
                         json={"requester_did": "did:key:zHidden2",
                               "expression_proof": "p", "confidence": 0.99})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "shielded_no_bonds"
