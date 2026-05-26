import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
import routers.research as research_mod


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(research_mod.router, prefix="/api/research")
    db = DatabaseService()
    await db.connect()
    app.state.db = db
    return TestClient(app), db


def test_summary_unavailable_when_flag_off(client, monkeypatch):
    monkeypatch.setenv("FEATURE_BENCHMARK_PAGE", "false")
    c, _ = client
    r = c.get("/api/research/summary")
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_summary_available_shape_when_flag_on(client, monkeypatch):
    monkeypatch.setenv("FEATURE_BENCHMARK_PAGE", "true")
    c, _ = client
    r = c.get("/api/research/summary?days=30")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["period_days"] == 30
    assert "sessions" in body["totals"]


async def test_summary_counts_from_risk_events(client, monkeypatch):
    monkeypatch.setenv("FEATURE_BENCHMARK_PAGE", "true")
    c, db = client
    await db.record_risk_event(session_hash="h1", risk_score=0.1,
                               classification="human", signals=[], outcome="passed")
    await db.record_risk_event(session_hash="h2", risk_score=0.9,
                               classification="bot", signals=["webdriver"], outcome="blocked")
    r = c.get("/api/research/summary?days=90")
    body = r.json()
    assert body["totals"]["sessions"] == 2
    assert body["totals"]["humans"] == 1
    assert body["totals"]["bots"] == 1
