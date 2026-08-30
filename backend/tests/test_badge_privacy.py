"""
Phase A — Badge privacy-by-default (Shielded Human mode).

With FEATURE_BADGE_PRIVACY on:
  - newly declared handle is private by default → badge behaves as not-found
  - handle declared with is_public=true → badge shows verified
  - PATCH visibility public→private hides the badge
  - list_handles exposes is_public
With the flag off: legacy behaviour (all handles public) is preserved — covered
by test_handles.py.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
import routers.handles as handles_router
import routers.badge as badge_router


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("FEATURE_BADGE_PRIVACY", "true")
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


# ── 1. Private by default → badge hidden ──────────────────────────────────────

async def test_default_private_badge_hidden(client):
    c, did = client
    c.post("/api/handles", json={"platform": "github", "username": "Alice"},
           headers={"X-APTOGON-DID": did})
    # SVG: not-verified (grey), no leak of existence
    r = c.get("/badge/github/alice.svg")
    assert r.status_code == 200
    assert "94a3b8" in r.text          # grey = not verified
    # info: verified False, looks like unknown
    info = c.get("/badge/github/alice/info").json()
    assert info["verified"] is False


# ── 2. Explicit public → badge shows ──────────────────────────────────────────

async def test_public_optin_badge_shows(client):
    c, did = client
    c.post("/api/handles",
           json={"platform": "github", "username": "Alice", "is_public": True},
           headers={"X-APTOGON-DID": did})
    r = c.get("/badge/github/alice.svg")
    assert r.status_code == 200
    assert "22c55e" in r.text          # green = verified
    info = c.get("/badge/github/alice/info").json()
    assert info["verified"] is True


# ── 3. Toggle visibility public→private hides badge ──────────────────────────

async def test_toggle_to_private_hides(client):
    c, did = client
    c.post("/api/handles",
           json={"platform": "github", "username": "Alice", "is_public": True},
           headers={"X-APTOGON-DID": did})
    assert c.get("/badge/github/alice/info").json()["verified"] is True
    # flip to private
    r = c.patch("/api/handles/github/alice",
                json={"is_public": False}, headers={"X-APTOGON-DID": did})
    assert r.status_code == 200, r.text
    assert c.get("/badge/github/alice/info").json()["verified"] is False


# ── 4. list_handles exposes is_public ────────────────────────────────────────

async def test_list_exposes_is_public(client):
    c, did = client
    c.post("/api/handles",
           json={"platform": "github", "username": "Alice", "is_public": True},
           headers={"X-APTOGON-DID": did})
    handles = c.get("/api/handles", headers={"X-APTOGON-DID": did}).json()["handles"]
    gh = next(h for h in handles if h["platform"] == "github")
    assert gh["is_public"] is True


# ── 5. noindex header on badge (anti-enumeration) ────────────────────────────

async def test_badge_noindex_header(client):
    c, did = client
    c.post("/api/handles",
           json={"platform": "github", "username": "Alice", "is_public": True},
           headers={"X-APTOGON-DID": did})
    r = c.get("/badge/github/alice.svg")
    assert "noindex" in r.headers.get("X-Robots-Tag", "")
