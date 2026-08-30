# backend/tests/test_billing_enforcement.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
from services.server_key import ServerKey
from services.api_keys import hash_secret
from services.did_key import DIDKey
from services import embed_service
import routers.embed as embed_router

OWNER = "did:key:zBillOwner"


def _make_user():
    return DIDKey.generate()


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(embed_router.router, prefix="/api/embed")
    db = DatabaseService()
    await db.connect()
    app.state.db = db
    app.state.server_key = ServerKey(__import__("os").environ["APTOGON_JWT_PRIVATE_KEY"])
    app.state.aptos = None
    await db.create_api_key("pk_live_bill", hash_secret("sk_live_BILL"),
                            OWNER, "Bill", ["https://site.com"])
    user = _make_user()
    await db.save_credential(did=user.did, did_hash="h", expression_proof="p",
                             bond_count=1, trust_score=0.5, trust_label="community_verified")
    embed_service._mem_nonces.clear()
    embed_service._mem_redeemed.clear()
    return TestClient(app), db, user


def _drive_verify(client, user):
    """Run challenge → assert → verify; return the /verify Response."""
    r = client.post("/api/embed/challenge",
                    json={"publishable_key": "pk_live_bill", "origin": "https://site.com"})
    nonce = r.json()["nonce"]
    msg = embed_service.assert_message(nonce, "https://site.com", user.did)
    r = client.post("/api/embed/assert", json={
        "publishable_key": "pk_live_bill", "nonce": nonce,
        "did": user.did, "signature": user.sign(msg)})
    token = r.json()["token"]
    return client.post("/api/embed/verify", json={"token": token},
                       headers={"Authorization": "Bearer sk_live_BILL"})


async def test_free_owner_blocked_at_cap(client, monkeypatch):
    c, db, user = client
    monkeypatch.setenv("FEATURE_BILLING", "true")
    monkeypatch.setenv("PLAN_FREE_CAP", "2")
    import time as _t
    period = _t.strftime("%Y-%m", _t.gmtime())
    # pre-seed pooled usage to the cap
    await db.increment_usage("pk_live_bill", period)
    await db.increment_usage("pk_live_bill", period)
    r = _drive_verify(c, user)
    assert r.status_code == 429, r.text
    assert r.json()["detail"]["error"] == "quota_exceeded"


async def test_pro_owner_allowed_past_free_cap(client, monkeypatch):
    c, db, user = client
    monkeypatch.setenv("FEATURE_BILLING", "true")
    monkeypatch.setenv("PLAN_FREE_CAP", "2")
    monkeypatch.setenv("PLAN_PRO_CAP", "100")
    await db.set_owner_plan(OWNER, "pro", updated_by="zAdmin12")
    import time as _t
    period = _t.strftime("%Y-%m", _t.gmtime())
    await db.increment_usage("pk_live_bill", period)
    await db.increment_usage("pk_live_bill", period)   # at free cap, under pro cap
    r = _drive_verify(c, user)
    assert r.status_code == 200, r.text


async def test_flag_off_uses_legacy_cap(client, monkeypatch):
    c, db, user = client
    monkeypatch.setenv("FEATURE_BILLING", "false")
    monkeypatch.setenv("FREE_VERIFY_CAP", "2")
    import time as _t
    period = _t.strftime("%Y-%m", _t.gmtime())
    await db.increment_usage("pk_live_bill", period)
    await db.increment_usage("pk_live_bill", period)
    r = _drive_verify(c, user)
    assert r.status_code == 429   # legacy per-key global cap still enforced
