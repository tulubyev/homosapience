import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
import routers.handles as handles_router
import routers.badge as badge_router


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(handles_router.router, prefix="/api/handles")
    app.include_router(badge_router.router, prefix="/badge")
    db = DatabaseService()
    await db.connect()
    await db.save_credential(
        did="did:key:zAlice", did_hash="h", expression_proof="p",
        bond_count=0, trust_score=0.5, trust_label="community_verified",
    )
    app.state.db = db
    return TestClient(app), "did:key:zAlice"


async def test_declare_handle_ok(client):
    c, did = client
    r = c.post("/api/handles", json={"platform": "github", "username": "Alice"},
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == "alice"


async def test_declare_handle_unsupported_platform(client):
    c, did = client
    r = c.post("/api/handles", json={"platform": "myspace", "username": "Alice"},
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "unsupported_platform"


async def test_declare_handle_invalid_username(client):
    c, did = client
    r = c.post("/api/handles", json={"platform": "github", "username": "a b"},
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "invalid_username"


async def test_list_handles(client):
    c, did = client
    c.post("/api/handles", json={"platform": "github", "username": "Alice"},
           headers={"X-APTOGON-DID": did})
    r = c.get("/api/handles", headers={"X-APTOGON-DID": did})
    assert r.status_code == 200, r.text
    handles = r.json()["handles"]
    assert any(h["platform"] == "github" for h in handles)


async def test_delete_handle(client):
    c, did = client
    c.post("/api/handles", json={"platform": "github", "username": "Alice"},
           headers={"X-APTOGON-DID": did})
    r = c.delete("/api/handles/github/alice", headers={"X-APTOGON-DID": did})
    assert r.status_code == 200, r.text
    listed = c.get("/api/handles", headers={"X-APTOGON-DID": did}).json()["handles"]
    assert all(not (h["platform"] == "github" and h["username_lc"] == "alice") for h in listed)


async def test_delete_handle_not_owned(client):
    """A verified stranger cannot delete Alice's handle — DB ownership check returns 404."""
    c, alice_did = client
    # Alice declares her handle
    c.post("/api/handles", json={"platform": "reddit", "username": "alice_rdt"},
           headers={"X-APTOGON-DID": alice_did})
    # Seed Bob as a separate verified DID
    bob_did = "did:key:zBob"
    await c.app.state.db.save_credential(
        did=bob_did, did_hash="hbob", expression_proof="pbob",
        bond_count=0, trust_score=0.3, trust_label="newcomer",
    )
    # Bob tries to delete Alice's handle — passes auth but DB ownership check fails
    r = c.delete("/api/handles/reddit/alice_rdt",
                 headers={"X-APTOGON-DID": bob_did})
    assert r.status_code == 404


async def test_badge_svg_verified(client):
    c, did = client
    c.post("/api/handles", json={"platform": "github", "username": "Alice"},
           headers={"X-APTOGON-DID": did})
    r = c.get("/badge/github/alice.svg")
    assert r.status_code == 200
    assert "image/svg+xml" in r.headers["content-type"]
    assert "22c55e" in r.text


async def test_badge_svg_not_found(client):
    c, _ = client
    r = c.get("/badge/github/nobody.svg")
    assert r.status_code == 200
    assert "94a3b8" in r.text


async def test_badge_info_verified(client):
    c, did = client
    c.post("/api/handles", json={"platform": "github", "username": "Alice"},
           headers={"X-APTOGON-DID": did})
    r = c.get("/badge/github/alice/info")
    assert r.status_code == 200
    body = r.json()
    assert body["verified"] is True
    assert body["trust_label"] == "community_verified"


async def test_badge_info_unknown(client):
    c, _ = client
    r = c.get("/badge/github/nobody/info")
    assert r.status_code == 200
    body = r.json()
    assert body["verified"] is False
