"""Tests for BotShield middleware."""
import os
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

os.environ["FEATURE_BOT_SHIELD"] = "true"  # must override any prior setdefault

from middleware.bot_shield import BotShield


def _make_app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/some-endpoint")
    def api_endpoint():
        return {"ok": True}

    @app.post("/api/verify/expression")
    def verify_expression():
        return {"ok": True}

    @app.get("/badge/github/user.svg")
    def badge():
        return JSONResponse({"svg": True})

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/page")
    def page():
        return {"page": True}

    app.add_middleware(BotShield)
    return app


@pytest.fixture
def client():
    return TestClient(_make_app(), raise_server_exceptions=False)


# ── UA blocklist ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("ua", [
    "curl/8.7.1",
    "python-requests/2.32.0",
    "python-httpx/0.27.0",
    "Scrapy/2.11.1 (+https://scrapy.org)",
    "Go-http-client/2.0",
    "Java/21.0.2",
    "libwww-perl/6.67",
    "axios/1.6.5",
    "node-fetch/3.3.2",
    "puppeteer/21.0",
    "playwright/1.44",
])
def test_bot_ua_blocked_on_regular_endpoint(client, ua):
    r = client.get("/api/some-endpoint", headers={"User-Agent": ua})
    assert r.status_code == 403
    assert r.json()["error"] == "bot_detected"


def test_libwww_perl_blocked(client):
    r = client.get("/api/some-endpoint", headers={"User-Agent": "libwww-perl/6.67"})
    assert r.status_code == 403


def test_normal_browser_ua_allowed(client):
    ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    r = client.get("/api/some-endpoint", headers={"User-Agent": ua})
    assert r.status_code == 200


# ── Open API exempt from UA check ────────────────────────────────────────────

def test_verify_expression_not_ua_blocked(client):
    """curl UA must not be blocked on /api/verify/expression — it's the open API."""
    r = client.post(
        "/api/verify/expression",
        headers={
            "User-Agent": "curl/8.7.1",
            "Accept-Language": "en-US",
            "Origin": "https://homosapience.org",
        },
    )
    # Must NOT be 403 due to UA — the endpoint itself may return whatever it wants
    assert r.status_code != 403 or r.json().get("error") not in ("bot_detected",)


def test_verify_expression_still_checks_origin(client):
    """Even though UA is exempt, a disallowed origin should still be rejected."""
    r = client.post(
        "/api/verify/expression",
        headers={
            "User-Agent": "Mozilla/5.0",
            "Origin": "https://evil.example.com",
            "Accept-Language": "en",
        },
    )
    assert r.status_code == 403
    assert r.json()["error"] == "origin_not_allowed"


def test_verify_expression_no_origin_no_accept_lang_blocked(client):
    """Script with no Origin and no Accept-Language is blocked (not a browser)."""
    r = client.post(
        "/api/verify/expression",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    assert r.status_code == 403
    assert r.json()["error"] == "bot_detected"


# ── Public paths fully exempt ─────────────────────────────────────────────────

def test_badge_endpoint_not_blocked(client):
    r = client.get("/badge/github/user.svg", headers={"User-Agent": "curl/8.7.1"})
    assert r.status_code == 200


def test_health_endpoint_not_blocked(client):
    r = client.get("/api/health", headers={"User-Agent": "python-requests/2.31"})
    assert r.status_code == 200


# ── X-Robots-Tag header ───────────────────────────────────────────────────────

def test_xrobots_tag_on_api_path(client):
    ua = "Mozilla/5.0"
    r = client.get("/api/some-endpoint", headers={"User-Agent": ua})
    assert r.headers.get("x-robots-tag") == "noindex, nofollow"


def test_xrobots_tag_on_health(client):
    r = client.get("/api/health", headers={"User-Agent": "curl/8.0"})
    assert r.headers.get("x-robots-tag") == "noindex, nofollow"


def test_xrobots_tag_absent_on_non_api_path(client):
    ua = "Mozilla/5.0"
    r = client.get("/page", headers={"User-Agent": ua})
    assert "x-robots-tag" not in r.headers


def test_xrobots_tag_absent_on_badge(client):
    r = client.get("/badge/github/user.svg", headers={"User-Agent": "curl/8.0"})
    assert "x-robots-tag" not in r.headers
