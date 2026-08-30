"""Self-serve owner email verification (magic-link) — register, verify, gate."""
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
import routers.console_keys as ck
import services.email_service as email_service


@pytest.fixture
async def client(monkeypatch):
    app = FastAPI()
    app.include_router(ck.router, prefix="/api/console")
    db = DatabaseService()
    await db.connect()
    app.state.db = db
    await db.save_credential(did="did:key:zPerson01", did_hash="h", expression_proof="p",
                             bond_count=0, trust_score=0.1, trust_label="newcomer")
    # Never touch real SMTP in tests; capture the link the service would send.
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(email_service, "send_verification",
                        lambda email, link: sent.append((email, link)) or True)
    # console_keys imported the symbol by reference — patch there too.
    monkeypatch.setattr(ck.email_service, "send_verification",
                        lambda email, link: sent.append((email, link)) or True)
    return TestClient(app), db, sent


def _did_hdr(did="did:key:zPerson01"):
    return {"X-APTOGON-DID": did}


async def test_account_empty_before_register(client):
    c, _db, _sent = client
    r = c.get("/api/console/account", headers=_did_hdr())
    assert r.status_code == 200
    body = r.json()
    assert body["email"] is None
    assert body["email_verified"] is False
    assert "email_required" in body


async def test_register_sends_link_and_stays_unverified(client):
    c, _db, sent = client
    r = c.post("/api/console/account/register", json={"email": "dev@site.com"},
               headers=_did_hdr())
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "dev@site.com"
    assert len(sent) == 1 and sent[0][0] == "dev@site.com"
    # not verified until the link is opened
    acct = c.get("/api/console/account", headers=_did_hdr()).json()
    assert acct["email"] == "dev@site.com"
    assert acct["email_verified"] is False


async def test_register_rejects_bad_email(client):
    c, _db, _sent = client
    r = c.post("/api/console/account/register", json={"email": "not-an-email"},
               headers=_did_hdr())
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "invalid_email"


async def test_magic_link_verifies(client):
    c, _db, sent = client
    c.post("/api/console/account/register", json={"email": "dev@site.com"},
           headers=_did_hdr())
    link = sent[0][1]
    token = link.split("token=", 1)[1]
    # opened from the email — no DID header, follow no redirect
    r = c.get("/api/console/account/verify", params={"token": token}, follow_redirects=False)
    assert r.status_code == 302
    assert "email_verified=1" in r.headers["location"]
    acct = c.get("/api/console/account", headers=_did_hdr()).json()
    assert acct["email_verified"] is True


async def test_magic_link_single_use(client):
    c, _db, sent = client
    c.post("/api/console/account/register", json={"email": "dev@site.com"},
           headers=_did_hdr())
    token = sent[0][1].split("token=", 1)[1]
    c.get("/api/console/account/verify", params={"token": token}, follow_redirects=False)
    # second use fails (token cleared on success)
    r = c.get("/api/console/account/verify", params={"token": token}, follow_redirects=False)
    assert "email_verified=0" in r.headers["location"]


async def test_bad_token_redirects_failure(client):
    c, _db, _sent = client
    r = c.get("/api/console/account/verify", params={"token": "garbage"}, follow_redirects=False)
    assert r.status_code == 302
    assert "email_verified=0" in r.headers["location"]


async def test_email_taken_by_other_did(client):
    c, db, _sent = client
    await db.save_credential(did="did:key:zPerson02", did_hash="h", expression_proof="p",
                             bond_count=0, trust_score=0.1, trust_label="newcomer")
    c.post("/api/console/account/register", json={"email": "shared@site.com"},
           headers=_did_hdr("did:key:zPerson01"))
    r = c.post("/api/console/account/register", json={"email": "shared@site.com"},
               headers=_did_hdr("did:key:zPerson02"))
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "email_taken"


async def test_expired_token_fails(client, monkeypatch):
    c, db, sent = client
    c.post("/api/console/account/register", json={"email": "dev@site.com"},
           headers=_did_hdr())
    token = sent[0][1].split("token=", 1)[1]
    # force the stored token to be already expired
    acct = await db.get_owner_account("did:key:zPerson01")
    got = await db.verify_owner_email(ck._hash_token(token), acct["token_expires"] + 1)
    assert got is None
