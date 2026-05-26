import pytest
from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_create_and_get_latest(db):
    row = await db.create_data_request(
        did="did:key:zA", name="Ann", company="Acme",
        email="a@acme.com", phone=None, suggested_level="standard")
    assert row["status"] == "pending"
    assert row["suggested_level"] == "standard"
    latest = await db.get_latest_data_request("did:key:zA")
    assert latest["id"] == row["id"]
    assert latest["company"] == "Acme"
    assert await db.get_latest_data_request("did:key:zNone") is None


async def test_list_and_decide(db):
    r = await db.create_data_request(did="did:key:zB", name="Bo", company="BCo",
                                     email="b@b.com", phone="123", suggested_level="basic")
    pending = await db.list_data_requests(status="pending")
    assert any(x["id"] == r["id"] for x in pending)
    updated = await db.decide_data_request(r["id"], status="approved",
                                           granted_level="full", reason=None, decided_by="zAdmin12")
    assert updated["status"] == "approved"
    assert updated["granted_level"] == "full"
    assert updated["decided_by"] == "zAdmin12"
    assert await db.decide_data_request(999999, status="denied",
                                        granted_level=None, reason="no", decided_by="zAdmin12") is None


async def test_signal_breakdown(db):
    await db.record_risk_event(session_hash="h1", risk_score=0.9, classification="bot",
                               signals=["webdriver", "datacenter_asn"], outcome="blocked")
    await db.record_risk_event(session_hash="h2", risk_score=0.8, classification="bot",
                               signals=["webdriver"], outcome="stepped_up")
    bd = await db.get_signal_breakdown(days=90)
    counts = {x["signal"]: x["count"] for x in bd}
    assert counts["webdriver"] == 2
    assert counts["datacenter_asn"] == 1
