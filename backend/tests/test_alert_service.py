import os
os.environ["FEATURE_ALERTS"] = "true"

import pytest
from services.db_service import DatabaseService
from services import alert_service


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_record_alert_creates_row(db):
    await alert_service.record_alert(
        db, owner_did="did:key:zSvc1",
        event_type="unknown_origin", level=1, severity="info",
        detail={"origin": "https://evil.example.com"},
        api_key_pk="pk_live_svc1",
    )
    rows = await db.list_alerts("did:key:zSvc1", status="active", limit=10)
    assert len(rows) == 1
    assert rows[0]["event_type"] == "unknown_origin"


async def test_record_alert_dedup_within_5min(db):
    for _ in range(3):
        await alert_service.record_alert(
            db, owner_did="did:key:zSvc2",
            event_type="cap_exceeded", level=1, severity="warning",
            detail={}, api_key_pk="pk_live_svc2",
        )
    rows = await db.list_alerts("did:key:zSvc2", status="active", limit=10)
    assert len(rows) == 1  # only first written, next two deduplicated


async def test_record_alert_no_dedup_different_key(db):
    await alert_service.record_alert(
        db, owner_did="did:key:zSvc3",
        event_type="unknown_origin", level=1, severity="info",
        detail={}, api_key_pk="pk_live_key_A",
    )
    await alert_service.record_alert(
        db, owner_did="did:key:zSvc3",
        event_type="unknown_origin", level=1, severity="info",
        detail={}, api_key_pk="pk_live_key_B",
    )
    rows = await db.list_alerts("did:key:zSvc3", status="active", limit=10)
    assert len(rows) == 2  # different keys → two alerts


async def test_auto_resolve_old(db):
    import time
    await alert_service.record_alert(
        db, owner_did="did:key:zSvc4",
        event_type="rate_limit_hit", level=1, severity="info",
        detail={},
    )
    # Age the alert
    for r in db._mem_alerts:
        if r["owner_did"] == "did:key:zSvc4":
            r["ts"] = int(time.time()) - 90000
    count = await alert_service.auto_resolve_old(db)
    assert count >= 1
    rows = await db.list_alerts("did:key:zSvc4", status="resolved", limit=10)
    assert rows[0]["resolved_by"] == "auto"


async def test_delete_expired(db):
    import time
    await alert_service.record_alert(
        db, owner_did="did:key:zSvc5",
        event_type="unknown_origin", level=1, severity="info",
        detail={},
    )
    for r in db._mem_alerts:
        if r["owner_did"] == "did:key:zSvc5":
            r["ts"] = int(time.time()) - (86400 * 31)
    count = await alert_service.delete_expired(db)
    assert count >= 1


async def test_record_alert_flag_off(db, monkeypatch):
    monkeypatch.setenv("FEATURE_ALERTS", "false")
    await alert_service.record_alert(
        db, owner_did="did:key:zSvc6",
        event_type="unknown_origin", level=1, severity="info",
        detail={},
    )
    rows = await db.list_alerts("did:key:zSvc6", status="active", limit=10)
    assert len(rows) == 0  # no-op when flag off
