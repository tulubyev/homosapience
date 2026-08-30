import os
os.environ.setdefault("FEATURE_ALERTS", "true")

import pytest
from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_create_and_list_alert(db):
    row = await db.create_alert(
        owner_did="did:key:zOwner1",
        api_key_pk="pk_live_test1",
        severity="warning",
        level=2,
        event_type="blocked_did",
        detail={"did_short": "AbCdEfGh", "reason": "msg_rate:20/min"},
    )
    assert row["id"] is not None
    assert row["status"] == "active"
    assert row["event_type"] == "blocked_did"

    rows = await db.list_alerts("did:key:zOwner1", status="active", limit=10)
    assert len(rows) == 1
    assert rows[0]["id"] == row["id"]


async def test_count_unread_alerts(db):
    await db.create_alert("did:key:zOwner2", None, "info", 1, "unknown_origin", {})
    await db.create_alert("did:key:zOwner2", None, "info", 1, "rate_limit_hit", {})
    count = await db.count_unread_alerts("did:key:zOwner2")
    assert count == 2


async def test_update_alert_status(db):
    row = await db.create_alert("did:key:zOwner3", "pk_live_x", "warning", 2, "usage_spike", {})
    ok = await db.update_alert_status(row["id"], "did:key:zOwner3", "acknowledged")
    assert ok is True
    rows = await db.list_alerts("did:key:zOwner3", status="acknowledged", limit=10)
    assert rows[0]["status"] == "acknowledged"


async def test_update_alert_status_wrong_owner(db):
    row = await db.create_alert("did:key:zOwner4", None, "info", 1, "cap_exceeded", {})
    ok = await db.update_alert_status(row["id"], "did:key:zWrongOwner", "acknowledged")
    assert ok is False


async def test_escalate_alert(db):
    row = await db.create_alert("did:key:zOwner5", "pk_live_y", "warning", 2, "blocked_did", {})
    ok = await db.escalate_alert(row["id"], "did:key:zOwner5", comment="Looks coordinated")
    assert ok is True
    rows = await db.list_alerts("did:key:zOwner5", status="escalated", limit=10)
    assert rows[0]["level"] == 3
    assert "comment" in rows[0]["detail"]


async def test_get_key_owner(db):
    # owner registered via create_api_key path (in-memory)
    db._mem_api_keys["pk_live_abc"] = {"owner_did": "did:key:zKeyOwner", "active": True}
    owner = await db.get_key_owner("pk_live_abc")
    assert owner == "did:key:zKeyOwner"
    missing = await db.get_key_owner("pk_live_nonexistent")
    assert missing is None


async def test_list_all_alerts_admin(db):
    await db.create_alert("did:key:zA", "pk_live_1", "critical", 3, "behavior_cascade", {})
    await db.create_alert("did:key:zB", "pk_live_2", "warning", 2, "usage_spike", {})
    rows = await db.list_all_alerts(limit=50)
    assert len(rows) >= 2


async def test_auto_resolve_old_alerts(db):
    import time
    row = await db.create_alert("did:key:zOld", None, "info", 1, "rate_limit_hit", {})
    # Manually set ts to 25 hours ago
    if db._use_mem:
        for r in db._mem_alerts:
            if r["id"] == row["id"]:
                r["ts"] = int(time.time()) - 90000
    count = await db.auto_resolve_alerts(int(time.time()) - 86400)
    assert count >= 1


async def test_delete_old_alerts(db):
    import time
    row = await db.create_alert("did:key:zExpired", None, "info", 1, "unknown_origin", {})
    if db._use_mem:
        for r in db._mem_alerts:
            if r["id"] == row["id"]:
                r["ts"] = int(time.time()) - (86400 * 31)
    count = await db.delete_old_alerts(int(time.time()) - (86400 * 30))
    assert count >= 1
