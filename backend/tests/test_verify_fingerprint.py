"""Tests for browser_fp handling in /api/verify/expression."""
import os
import time
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("FEATURE_BOT_SHIELD", "false")  # disable bot_shield for unit tests

import routers.verify as verify_mod
from routers.verify import BrowserFingerprintDTO, _analyze_fp


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(verify_mod.router, prefix="/api/verify")
    # minimal state — webdriver check returns before accessing gonka/aptos
    app.state.rate_limiter = None
    app.state.db = None
    app.state.fp_store = None
    return app


@pytest.fixture
def client():
    return TestClient(_make_app(), raise_server_exceptions=False)


def _events(n: int = 15, duration_ms: int = 9000) -> list[dict]:
    """Generate n touch events spanning duration_ms milliseconds."""
    now_ms = int(time.time() * 1000)
    return [
        {
            "x": 0.1 + 0.05 * i,
            "y": 0.1 + 0.05 * i,
            "pressure": 0.5,
            "timestamp_ms": now_ms - duration_ms + int(duration_ms * i / (n - 1)),
            "pause_after_ms": 0,
        }
        for i in range(n)
    ]


def _clean_fp(**overrides) -> BrowserFingerprintDTO:
    """Normal browser fingerprint — no anomalies expected."""
    defaults = dict(
        webdriver=False,
        webgl_vendor="Google Inc.",
        webgl_renderer="ANGLE (Intel, Mesa Intel(R) UHD Graphics)",
        audio_hash="a1b2c3d4",
        hardware_concurrency=8,
        device_memory=8.0,
        touch_points=0,
        color_depth=24,
        pixel_ratio=2.0,
        timezone_offset=-120,
    )
    defaults.update(overrides)
    return BrowserFingerprintDTO(**defaults)


# ── _analyze_fp unit tests ─────────────────────────────────────────────────────

def test_analyze_fp_clean_no_anomalies():
    _, anomalies = _analyze_fp(_clean_fp())
    assert anomalies == []


def test_analyze_fp_no_webgl():
    _, anomalies = _analyze_fp(_clean_fp(webgl_vendor=None, webgl_renderer=None))
    assert "fp:no_webgl" in anomalies


def test_analyze_fp_no_audio():
    _, anomalies = _analyze_fp(_clean_fp(audio_hash=None))
    assert "fp:no_audio" in anomalies


def test_analyze_fp_low_cpu_single_core():
    _, anomalies = _analyze_fp(_clean_fp(hardware_concurrency=1))
    assert "fp:low_cpu" in anomalies


def test_analyze_fp_low_cpu_zero():
    _, anomalies = _analyze_fp(_clean_fp(hardware_concurrency=0))
    assert "fp:low_cpu" in anomalies


def test_analyze_fp_low_memory():
    _, anomalies = _analyze_fp(_clean_fp(device_memory=0.25))
    assert "fp:low_memory" in anomalies


def test_analyze_fp_borderline_memory_ok():
    """0.5 GB is threshold — exactly 0.5 should NOT trigger."""
    _, anomalies = _analyze_fp(_clean_fp(device_memory=0.5))
    assert "fp:low_memory" not in anomalies


def test_analyze_fp_multi_anomaly():
    _, anomalies = _analyze_fp(_clean_fp(
        webgl_vendor=None,
        audio_hash=None,
        hardware_concurrency=1,
        device_memory=0.1,
    ))
    assert set(anomalies) == {"fp:no_webgl", "fp:no_audio", "fp:low_cpu", "fp:low_memory"}


def test_analyze_fp_signals_dict_contains_all_keys():
    signals, _ = _analyze_fp(_clean_fp())
    expected_keys = {
        "webdriver", "webgl_vendor", "webgl_renderer", "audio_hash",
        "hardware_concurrency", "device_memory", "touch_points",
        "color_depth", "pixel_ratio", "timezone_offset", "anomalies",
    }
    assert expected_keys == set(signals.keys())


def test_analyze_fp_signals_anomalies_match():
    signals, anomalies = _analyze_fp(_clean_fp(webgl_vendor=None))
    assert signals["anomalies"] == anomalies
    assert "fp:no_webgl" in signals["anomalies"]


def test_analyze_fp_none_hardware_concurrency_no_flag():
    """hardware_concurrency=None (not reported) must not trigger fp:low_cpu."""
    _, anomalies = _analyze_fp(_clean_fp(hardware_concurrency=None))
    assert "fp:low_cpu" not in anomalies


def test_analyze_fp_none_device_memory_no_flag():
    """device_memory=None (not reported) must not trigger fp:low_memory."""
    _, anomalies = _analyze_fp(_clean_fp(device_memory=None))
    assert "fp:low_memory" not in anomalies


# ── HTTP integration tests (webdriver hard-block) ─────────────────────────────

def test_webdriver_true_returns_passed_false(client):
    r = client.post(
        "/api/verify/expression",
        json={
            "events": _events(),
            "session_id": "test-session-wd-1",
            "browser_fp": {
                "webdriver": True,
                "hardware_concurrency": 4,
                "timezone_offset": -120,
                "touch_points": 0,
                "color_depth": 24,
                "pixel_ratio": 1.0,
            },
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["passed"] is False
    assert body["is_human"] is False
    assert "webdriver" in body["anomalies"]
    assert "automation_detected" in body["reasoning"]


def test_webdriver_false_does_not_short_circuit(client):
    """With webdriver=False the request should proceed past the early check
    (and fail for other reasons — no gonka — but not because of webdriver)."""
    r = client.post(
        "/api/verify/expression",
        json={
            "events": _events(),
            "session_id": "test-session-wd-2",
            "browser_fp": {"webdriver": False},
        },
    )
    # Should NOT be a webdriver block (will fail later for missing gonka state)
    if r.status_code == 200:
        body = r.json()
        assert "automation_detected" not in body.get("reasoning", "")


def test_no_browser_fp_does_not_block(client):
    """Requests without browser_fp (e.g., API integrations) must not be blocked."""
    r = client.post(
        "/api/verify/expression",
        json={"events": _events(), "session_id": "test-session-no-fp"},
    )
    if r.status_code == 200:
        body = r.json()
        assert "automation_detected" not in body.get("reasoning", "")
