"""Tests for AptogonFirewall public-path exemptions.

Regression: /api/captcha/* must not be gated by the DID firewall. The captcha
endpoints carry their own auth (publishable key ↔ allowed_origins for /verify,
`Authorization: Bearer sk_live_…` for /siteverify). Without the exemption the
firewall answers 403 auth_required before the router ever runs — and the
sk_live_ bearer is not a DID session JWT, so it cannot satisfy the firewall.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.firewall import AptogonFirewall


def _make_app() -> FastAPI:
    app = FastAPI()

    @app.post("/api/captcha/verify")
    def captcha_verify():
        return {"ok": True}

    @app.post("/api/captcha/siteverify")
    def captcha_siteverify():
        return {"ok": True}

    @app.get("/api/console/keys")
    def console_keys():
        return {"ok": True}

    app.add_middleware(AptogonFirewall)
    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(_make_app())


def test_captcha_verify_is_public(client: TestClient):
    r = client.post("/api/captcha/verify", json={})
    assert r.status_code == 200


def test_captcha_siteverify_passes_with_sk_bearer(client: TestClient):
    # sk_live_ is not a DID session JWT — the firewall must not try to gate it
    r = client.post("/api/captcha/siteverify", json={},
                    headers={"Authorization": "Bearer sk_live_notajwt"})
    assert r.status_code == 200


def test_non_public_api_path_still_gated(client: TestClient):
    r = client.get("/api/console/keys")
    assert r.status_code == 403
    assert r.json()["error"] == "auth_required"
