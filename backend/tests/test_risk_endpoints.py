"""R2 endpoint / DB / ip_intel / zero-PII tests."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
from services.ip_intel import IPIntel
import routers.risk as risk_mod


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(risk_mod.router, prefix="/api/risk")
    db = DatabaseService()
    await db.connect()
    app.state.db = db
    return TestClient(app), db


# ── POST /assess ─────────────────────────────────────────────────────────────

def test_assess_returns_full_shape(client, monkeypatch):
    monkeypatch.setenv("FEATURE_STATS_COLLECT", "false")
    c, _ = client
    r = c.post("/api/risk/assess", json={"webdriver": True})
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("risk_score", "classification", "signals", "blocked", "step_up", "gesture_min_s"):
        assert key in body
    assert "webdriver" in body["signals"]


def test_assess_persists_event_when_stats_collect_on(client, monkeypatch):
    monkeypatch.setenv("FEATURE_STATS_COLLECT", "true")
    c, db = client
    r = c.post("/api/risk/assess", json={"cdp_artifact": True, "session_id": "sess-abc"})
    assert r.status_code == 200
    assert len(db._mem_risk_events) == 1
    ev = db._mem_risk_events[0]
    assert ev["classification"] == r.json()["classification"]


def test_assess_does_not_persist_when_flag_off(client, monkeypatch):
    monkeypatch.setenv("FEATURE_STATS_COLLECT", "false")
    c, db = client
    c.post("/api/risk/assess", json={"webdriver": True})
    assert db._mem_risk_events == []


# ── Zero-PII audit ───────────────────────────────────────────────────────────

def test_zero_pii_no_raw_session_or_ip(client, monkeypatch):
    monkeypatch.setenv("FEATURE_STATS_COLLECT", "true")
    c, db = client
    secret = "raw-session-secret-123"
    c.post("/api/risk/assess", json={"webdriver": True, "session_id": secret},
           headers={"X-Forwarded-For": "203.0.113.7"})
    ev = db._mem_risk_events[0]
    # session_id is hashed, never stored raw
    assert ev["session_hash"] is not None
    assert secret not in str(ev)
    # no raw IP / UA anywhere in the persisted record (ip_hash is a hash, checked above)
    assert "203.0.113.7" not in str(ev)
    assert set(ev.keys()) == {
        "ts", "api_key", "session_hash", "risk_score",
        "classification", "signals", "outcome", "country_band",
        "ip_hash", "asn_type",   # added by the IP-audit feature (696f2d4); both non-PII
    }


# ── GET /stats (flag gated) ──────────────────────────────────────────────────

def test_stats_unavailable_when_flag_off(client, monkeypatch):
    monkeypatch.setenv("FEATURE_STATS_PAGE", "false")
    c, _ = client
    r = c.get("/api/risk/stats")
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_stats_available_when_flag_on(client, monkeypatch):
    monkeypatch.setenv("FEATURE_STATS_PAGE", "true")
    c, _ = client
    r = c.get("/api/risk/stats?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["period_days"] == 7
    assert "totals" in body and "sessions" in body["totals"]


# ── DB stats counters ────────────────────────────────────────────────────────

async def test_record_and_count_attack_stats(client):
    _, db = client
    await db.record_risk_event(session_hash="h1", risk_score=0.1,
                               classification="human", signals=[], outcome="passed")
    await db.record_risk_event(session_hash="h2", risk_score=0.9,
                               classification="bot", signals=["webdriver"], outcome="blocked")
    await db.record_risk_event(session_hash="h3", risk_score=0.7,
                               classification="ai_agent", signals=["cdp_artifact"], outcome="stepped_up")
    stats = await db.get_attack_stats(days=1)
    assert stats["sessions"] == 3
    assert stats["humans"] == 1
    assert stats["bots"] == 1
    assert stats["ai_agents"] == 1
    assert stats["blocked"] == 1


# ── ip_intel graceful degradation ────────────────────────────────────────────

def test_ip_intel_safe_defaults():
    intel = IPIntel(db_path="/nonexistent/path.mmdb")  # forces unavailable
    assert intel.available is False
    for ip in ("", "unknown", "10.0.0.1", "not-an-ip", "192.168.1.1"):
        res = intel.lookup(ip)
        assert res.is_datacenter is False
        assert res.asn is None
