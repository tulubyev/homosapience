import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.db_service import DatabaseService
from services import domain_verify
import routers.domain as domain_router


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(domain_router.router, prefix="/api/console")
    db = DatabaseService()
    await db.connect()
    app.state.db = db
    await db.save_credential(
        did="did:key:zCaller", did_hash="h", expression_proof="p",
        bond_count=0, trust_score=0.1, trust_label="newcomer",
    )
    return TestClient(app), "did:key:zCaller"


async def test_create_returns_token_and_methods(client):
    c, did = client
    r = c.post("/api/console/domains", json={"origin": "https://example.com"},
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["recommended"] == "dns_txt"
    assert body["methods"]["dns_txt"]["name"] == "_aptogon.example.com"
    assert body["methods"]["well_known"]["url"].endswith(
        "/.well-known/aptogon-domain-verification.txt")
    assert body["token"] in body["methods"]["dns_txt"]["value"]


async def test_create_rejects_bad_origin(client):
    c, did = client
    r = c.post("/api/console/domains", json={"origin": "ftp://x"},
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 400


async def test_requires_verified_did(client):
    c, _ = client
    r = c.post("/api/console/domains", json={"origin": "https://example.com"},
               headers={"X-APTOGON-DID": "did:key:zNobody"})
    assert r.status_code == 403


async def test_verify_success(client, monkeypatch):
    c, did = client
    created = c.post("/api/console/domains", json={"origin": "https://example.com"},
                     headers={"X-APTOGON-DID": did}).json()

    async def fake_verify(origin, token, method=None):
        return "dns_txt"
    monkeypatch.setattr(domain_verify, "verify_origin", fake_verify)

    r = c.post(f"/api/console/domains/{created['id']}/verify",
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "verified"
    assert r.json()["method"] == "dns_txt"


async def test_verify_failure(client, monkeypatch):
    c, did = client
    created = c.post("/api/console/domains", json={"origin": "https://example.com"},
                     headers={"X-APTOGON-DID": did}).json()

    async def fake_verify(origin, token, method=None):
        return None
    monkeypatch.setattr(domain_verify, "verify_origin", fake_verify)

    r = c.post(f"/api/console/domains/{created['id']}/verify",
               headers={"X-APTOGON-DID": did})
    assert r.status_code == 200
    assert r.json()["status"] == "failed"


async def test_list(client):
    c, did = client
    c.post("/api/console/domains", json={"origin": "https://example.com"},
           headers={"X-APTOGON-DID": did})
    r = c.get("/api/console/domains", headers={"X-APTOGON-DID": did})
    assert r.status_code == 200
    assert len(r.json()["domains"]) == 1


async def test_list_domains_includes_token_and_methods_for_pending(client):
    c, did = client
    # Create a domain
    create_r = c.post("/api/console/domains",
                      json={"origin": "https://listtest.com"},
                      headers={"X-APTOGON-DID": did})
    assert create_r.status_code == 200

    # List should include token and methods for pending domain
    list_r = c.get("/api/console/domains",
                   headers={"X-APTOGON-DID": did})
    assert list_r.status_code == 200
    domains = list_r.json()["domains"]
    pending = [d for d in domains if d["origin"] == "https://listtest.com"]
    assert len(pending) == 1
    d = pending[0]
    assert d["status"] == "pending"
    assert "token" in d
    assert "methods" in d
    assert "dns_txt" in d["methods"]
    assert "well_known" in d["methods"]
    assert "_aptogon.listtest.com" in d["methods"]["dns_txt"]["name"]


async def test_list_domains_omits_token_for_verified(client, monkeypatch):
    c, did = client
    from services import domain_verify as dv
    async def _always_true(origin, token):
        return True
    monkeypatch.setattr(dv, "_check_dns_txt", _always_true)

    create_r = c.post("/api/console/domains",
                      json={"origin": "https://verifiedlist.com"},
                      headers={"X-APTOGON-DID": did})
    vid = create_r.json()["id"]
    c.post(f"/api/console/domains/{vid}/verify",
           json={"method": "dns_txt"},
           headers={"X-APTOGON-DID": did})

    list_r = c.get("/api/console/domains",
                   headers={"X-APTOGON-DID": did})
    verified = [d for d in list_r.json()["domains"] if d["origin"] == "https://verifiedlist.com"]
    assert len(verified) == 1
    d = verified[0]
    assert d["status"] == "verified"
    assert "token" not in d
    assert "methods" not in d


async def test_delete_domain_removes_it(client):
    c, did = client
    created = c.post("/api/console/domains", json={"origin": "https://gone.com"},
                     headers={"X-APTOGON-DID": did}).json()
    r = c.request("DELETE", f"/api/console/domains/{created['id']}",
                  headers={"X-APTOGON-DID": did})
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] is True
    # gone from list
    listed = c.get("/api/console/domains", headers={"X-APTOGON-DID": did}).json()["domains"]
    assert all(d["origin"] != "https://gone.com" for d in listed)


async def test_delete_domain_owner_scoped(client):
    c, did = client
    created = c.post("/api/console/domains", json={"origin": "https://mine.com"},
                     headers={"X-APTOGON-DID": did}).json()
    # different verified DID cannot delete someone else's domain
    db = c.app.state.db
    await db.save_credential(did="did:key:zStranger", did_hash="h", expression_proof="p",
                             bond_count=0, trust_score=0.1, trust_label="newcomer")
    r = c.request("DELETE", f"/api/console/domains/{created['id']}",
                  headers={"X-APTOGON-DID": "did:key:zStranger"})
    assert r.status_code == 404
    # still present for the real owner
    listed = c.get("/api/console/domains", headers={"X-APTOGON-DID": did}).json()["domains"]
    assert any(d["origin"] == "https://mine.com" for d in listed)


async def test_delete_missing_domain_404(client):
    c, did = client
    r = c.request("DELETE", "/api/console/domains/99999", headers={"X-APTOGON-DID": did})
    assert r.status_code == 404
