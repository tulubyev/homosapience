import os
os.environ["FEATURE_ALERTS"] = "true"

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services.db_service import DatabaseService
import routers.alerts as alerts_mod


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(alerts_mod.console_router, prefix="/api/console")
    app.include_router(alerts_mod.admin_router,   prefix="/api/admin")
    db = DatabaseService()
    await db.connect()
    app.state.db = db
    # Seed admin DID
    await db.upsert_admin_did(did_short="zAdmin12", did_full="did:key:zAdmin12", role="admin")
    # Seed a verified human credential for owner
    import time
    await db.save_credential(
        did="did:key:zOwner99",
        did_hash="hash99",
        expression_proof="ep99",
        trust_score=0.8,
        trust_label="trusted",
        tx_hash=None,
        valid_until=int(time.time()) + 86400,
    )
    return TestClient(app), "did:key:zAdmin12", "did:key:zOwner99"


async def test_list_alerts_empty(client):
    c, admin_did, owner_did = client
    r = c.get("/api/console/alerts", headers={"X-APTOGON-DID": owner_did})
    assert r.status_code == 200
    assert r.json()["alerts"] == []


async def test_count_unread_zero(client):
    c, admin_did, owner_did = client
    r = c.get("/api/console/alerts/unread", headers={"X-APTOGON-DID": owner_did})
    assert r.status_code == 200
    assert r.json()["count"] == 0


async def test_acknowledge_alert(client):
    c, admin_did, owner_did = client
    db = c.app.state.db
    row = await db.create_alert(owner_did, "pk_live_1", "warning", 2, "blocked_did", {})
    r = c.post(f"/api/console/alerts/{row['id']}/acknowledge",
               headers={"X-APTOGON-DID": owner_did})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    rows = await db.list_alerts(owner_did, status="acknowledged")
    assert len(rows) == 1


async def test_escalate_alert(client):
    c, admin_did, owner_did = client
    db = c.app.state.db
    row = await db.create_alert(owner_did, "pk_live_2", "warning", 2, "usage_spike", {})
    r = c.post(f"/api/console/alerts/{row['id']}/escalate",
               json={"comment": "Suspicious pattern"},
               headers={"X-APTOGON-DID": owner_did})
    assert r.status_code == 200
    escalated = await db.list_alerts(owner_did, status="escalated")
    assert escalated[0]["level"] == 3


async def test_freeze_key_alert(client):
    c, admin_did, owner_did = client
    db = c.app.state.db
    db._mem_api_keys["pk_live_freeze"] = {
        "owner_did": owner_did, "active": True, "name": "Test",
        "allowed_origins": [], "created_at": 0, "last_used_at": None,
    }
    row = await db.create_alert(owner_did, "pk_live_freeze", "warning", 2, "blocked_did", {})
    r = c.post(f"/api/console/alerts/{row['id']}/freeze-key",
               headers={"X-APTOGON-DID": owner_did})
    assert r.status_code == 200
    key = db._mem_api_keys["pk_live_freeze"]
    assert key["active"] is False


async def test_admin_list_alerts(client):
    c, admin_did, owner_did = client
    db = c.app.state.db
    await db.create_alert("did:key:zSomeone", None, "critical", 3, "behavior_cascade", {})
    r = c.get("/api/admin/alerts", headers={"X-APTOGON-DID": admin_did})
    assert r.status_code == 200
    assert len(r.json()["alerts"]) >= 1


async def test_admin_resolve_alert(client):
    c, admin_did, owner_did = client
    db = c.app.state.db
    row = await db.create_alert("did:key:zOther", None, "critical", 3, "behavior_cascade", {})
    r = c.post(f"/api/admin/alerts/{row['id']}/resolve",
               headers={"X-APTOGON-DID": admin_did})
    assert r.status_code == 200
    resolved = await db.list_all_alerts(status="resolved")
    assert any(a["id"] == row["id"] for a in resolved)


async def test_console_alerts_requires_auth(client):
    c, _, _ = client
    r = c.get("/api/console/alerts")
    assert r.status_code == 403


async def test_admin_alerts_requires_admin(client):
    c, _, owner_did = client
    r = c.get("/api/admin/alerts", headers={"X-APTOGON-DID": owner_did})
    assert r.status_code == 403
