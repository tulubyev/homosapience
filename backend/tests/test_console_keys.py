import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
import routers.console_keys as ck


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(ck.router, prefix="/api/console")
    db = DatabaseService()
    await db.connect()
    app.state.db = db
    # Seed admin DID (last 8 chars are the did_short used by is_admin_did)
    await db.upsert_admin_did(did_short="zAdmin12", did_full="did:key:zAdmin12",
                              role="admin")
    return TestClient(app), "did:key:zAdmin12"


async def test_create_key_returns_secret_once(client):
    c, admin_did = client
    r = c.post("/api/console/keys",
               json={"name": "My App", "allowed_origins": ["https://a.com"]},
               headers={"X-APTOGON-DID": admin_did})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["publishable_key"].startswith("pk_live_")
    assert body["secret_key"].startswith("sk_live_")


async def test_list_keys_hides_secret(client):
    c, admin_did = client
    c.post("/api/console/keys",
           json={"name": "App", "allowed_origins": []},
           headers={"X-APTOGON-DID": admin_did})
    r = c.get("/api/console/keys", headers={"X-APTOGON-DID": admin_did})
    assert r.status_code == 200
    keys = r.json()["keys"]
    assert len(keys) == 1
    assert "secret_key" not in keys[0]
    assert "secret_hash" not in keys[0]


async def test_non_admin_rejected(client):
    c, _ = client
    r = c.post("/api/console/keys",
               json={"name": "X", "allowed_origins": []},
               headers={"X-APTOGON-DID": "did:key:zNobody9"})
    assert r.status_code == 403


async def test_deactivate_key(client):
    c, admin_did = client
    c.post("/api/console/keys",
           json={"name": "App", "allowed_origins": []},
           headers={"X-APTOGON-DID": admin_did}).json()
    # find id via list
    keys = c.get("/api/console/keys", headers={"X-APTOGON-DID": admin_did}).json()["keys"]
    kid = keys[0]["id"]
    r = c.delete(f"/api/console/keys/{kid}", headers={"X-APTOGON-DID": admin_did})
    assert r.status_code == 200
    assert r.json()["deactivated"] is True


import services.feature_flags as _ff
import routers.console_keys as _ck


import time as _time


async def _seed_verified(db, did):
    await db.save_credential(did=did, did_hash="h", expression_proof="p",
                             bond_count=0, trust_score=0.1, trust_label="newcomer")


async def _seed_email_verified(db, did, email="owner@example.com"):
    """Give `did` a verified email so self-serve key creation passes the gate."""
    now = int(_time.time())
    h = _ck._hash_token("seed-" + did)
    await db.upsert_owner_email(did, email, h, now + 3600, now)
    await db.verify_owner_email(h, now)


async def test_self_serve_off_requires_admin(client):
    c, _ = client
    db = c.app.state.db
    await _seed_verified(db, "did:key:zUser0001")
    r = c.post("/api/console/keys", json={"name": "X", "allowed_origins": []},
               headers={"X-APTOGON-DID": "did:key:zUser0001"})
    assert r.status_code == 403


async def test_self_serve_on_verified_did_creates_key(client, monkeypatch):
    c, _ = client
    db = c.app.state.db
    await _seed_verified(db, "did:key:zUser0001")
    await _seed_email_verified(db, "did:key:zUser0001")
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "SELF_SERVE_KEYS")
    r = c.post("/api/console/keys", json={"name": "My App", "allowed_origins": ["https://a.com"]},
               headers={"X-APTOGON-DID": "did:key:zUser0001"})
    assert r.status_code == 200, r.text
    assert r.json()["secret_key"].startswith("sk_live_")


async def test_self_serve_key_blocked_without_email(client, monkeypatch):
    c, _ = client
    db = c.app.state.db
    did = "did:key:zNoEmail01"
    await _seed_verified(db, did)   # human, but no verified email
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "SELF_SERVE_KEYS")
    r = c.post("/api/console/keys", json={"name": "X", "allowed_origins": []},
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "email_verification_required"


async def test_self_serve_key_cap(client, monkeypatch):
    c, _ = client
    db = c.app.state.db
    did = "did:key:zUser0002"
    await _seed_verified(db, did)
    await _seed_email_verified(db, did)
    monkeypatch.setattr(_ck, "MAX_KEYS_PER_OWNER", 2)
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "SELF_SERVE_KEYS")
    for i in range(2):
        r = c.post("/api/console/keys", json={"name": f"k{i}", "allowed_origins": []},
                   headers={"X-APTOGON-DID": did})
        assert r.status_code == 200
    r = c.post("/api/console/keys", json={"name": "k3", "allowed_origins": []},
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "key_limit_reached"


async def test_list_keys_includes_usage_fields(client):
    c, admin_did = client
    r = c.post("/api/console/keys",
               json={"name": "Usage Test", "allowed_origins": []},
               headers={"X-APTOGON-DID": admin_did})
    assert r.status_code == 200
    keys = c.get("/api/console/keys",
                 headers={"X-APTOGON-DID": admin_did}).json()["keys"]
    assert len(keys) >= 1
    key = next(k for k in keys if k["name"] == "Usage Test")
    assert "usage_this_month" in key
    assert key["usage_this_month"] == 0
    assert "monthly_cap" in key
    assert key["monthly_cap"] == 1000


async def test_reactivate_endpoint(client, monkeypatch):
    c, _ = client
    db = c.app.state.db
    did = "did:key:zUser0003"
    await _seed_verified(db, did)
    await _seed_email_verified(db, did)
    monkeypatch.setattr(_ff, "feature_enabled",
                        lambda name, default=None: name == "SELF_SERVE_KEYS")
    c.post("/api/console/keys", json={"name": "k", "allowed_origins": []},
           headers={"X-APTOGON-DID": did})
    kid = c.get("/api/console/keys", headers={"X-APTOGON-DID": did}).json()["keys"][0]["id"]
    c.delete(f"/api/console/keys/{kid}", headers={"X-APTOGON-DID": did})
    r = c.post(f"/api/console/keys/{kid}/reactivate", headers={"X-APTOGON-DID": did})
    assert r.status_code == 200
    assert r.json()["reactivated"] is True
