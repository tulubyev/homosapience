"""Unit tests for backend/services/asn_classifier.py."""
import asyncio
import pytest
import importlib
from unittest.mock import AsyncMock, MagicMock, patch


# ── helpers ──────────────────────────────────────────────────────────────────

def _mock_response(status: int, json_data: dict):
    """Return a mock httpx response."""
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = json_data
    return resp


def _run(coro):
    # A fresh loop per call: under pytest-asyncio (asyncio_mode=auto) the shared
    # loop is created and closed by other async tests, so get_event_loop() here
    # would grab a closed loop and raise "Event loop is closed" depending on test
    # order. Isolating the loop makes these sync helpers order-independent.
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── fixture: clear module-level cache between tests ──────────────────────────

@pytest.fixture(autouse=True)
def clear_cache():
    import services.asn_classifier as mod
    mod._cache.clear()
    yield
    mod._cache.clear()


# ── classification logic (_classify_from_data) ───────────────────────────────

def test_classify_tor():
    from services.asn_classifier import _classify_from_data
    data = {"privacy": {"tor": True, "vpn": False}, "org": "AS1234 Some ISP"}
    assert _classify_from_data(data) == "tor"


def test_classify_vpn():
    from services.asn_classifier import _classify_from_data
    data = {"privacy": {"tor": False, "vpn": True, "proxy": False}, "org": "AS999"}
    assert _classify_from_data(data) == "vpn"


def test_classify_proxy():
    from services.asn_classifier import _classify_from_data
    data = {"privacy": {"tor": False, "vpn": False, "proxy": True}, "org": "AS999"}
    assert _classify_from_data(data) == "vpn"


def test_classify_datacenter_hosting_flag():
    from services.asn_classifier import _classify_from_data
    data = {"privacy": {}, "org": "AS1234 SomeISP", "hosting": True}
    assert _classify_from_data(data) == "datacenter"


def test_classify_datacenter_org_aws():
    from services.asn_classifier import _classify_from_data
    data = {"privacy": {}, "org": "AS16509 Amazon.com, Inc.", "hosting": False}
    assert _classify_from_data(data) == "datacenter"


def test_classify_datacenter_org_hetzner():
    from services.asn_classifier import _classify_from_data
    data = {"privacy": {}, "org": "AS24940 Hetzner Online GmbH"}
    assert _classify_from_data(data) == "datacenter"


def test_classify_residential():
    from services.asn_classifier import _classify_from_data
    data = {"privacy": {}, "org": "AS3320 Deutsche Telekom AG"}
    assert _classify_from_data(data) == "residential"


# ── classify_ip: skip loopback / reserved ────────────────────────────────────

def test_loopback_returns_unknown():
    from services.asn_classifier import classify_ip
    assert _run(classify_ip("127.0.0.1")) == "unknown"


def test_localhost_string_returns_unknown():
    from services.asn_classifier import classify_ip
    assert _run(classify_ip("localhost")) == "unknown"


def test_ipv6_loopback_returns_unknown():
    from services.asn_classifier import classify_ip
    assert _run(classify_ip("::1")) == "unknown"


def test_empty_string_returns_unknown():
    from services.asn_classifier import classify_ip
    assert _run(classify_ip("")) == "unknown"


# ── classify_ip: HTTP responses ───────────────────────────────────────────────

@patch("httpx.AsyncClient")
def test_classify_ip_datacenter(mock_client_cls):
    mock_resp = _mock_response(200, {
        "org": "AS16509 Amazon Technologies Inc.",
        "privacy": {},
        "hosting": False,
    })
    ctx = AsyncMock()
    ctx.get = AsyncMock(return_value=mock_resp)
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=ctx)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

    from services.asn_classifier import classify_ip
    result = _run(classify_ip("3.5.140.2"))
    assert result == "datacenter"


@patch("httpx.AsyncClient")
def test_classify_ip_residential(mock_client_cls):
    mock_resp = _mock_response(200, {
        "org": "AS3320 Deutsche Telekom AG",
        "privacy": {},
    })
    ctx = AsyncMock()
    ctx.get = AsyncMock(return_value=mock_resp)
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=ctx)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

    from services.asn_classifier import classify_ip
    result = _run(classify_ip("217.0.0.1"))
    assert result == "residential"


@patch("httpx.AsyncClient")
def test_rate_limit_returns_unknown(mock_client_cls):
    mock_resp = _mock_response(429, {})
    ctx = AsyncMock()
    ctx.get = AsyncMock(return_value=mock_resp)
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=ctx)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

    from services.asn_classifier import classify_ip
    result = _run(classify_ip("1.2.3.4"))
    assert result == "unknown"


@patch("httpx.AsyncClient")
def test_non_200_returns_unknown(mock_client_cls):
    mock_resp = _mock_response(500, {})
    ctx = AsyncMock()
    ctx.get = AsyncMock(return_value=mock_resp)
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=ctx)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

    from services.asn_classifier import classify_ip
    result = _run(classify_ip("1.2.3.4"))
    assert result == "unknown"


@patch("httpx.AsyncClient")
def test_exception_returns_unknown(mock_client_cls):
    ctx = AsyncMock()
    ctx.get = AsyncMock(side_effect=Exception("network error"))
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=ctx)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

    from services.asn_classifier import classify_ip
    result = _run(classify_ip("1.2.3.4"))
    assert result == "unknown"


# ── classify_ip: LRU cache behavior ─────────────────────────────────────────

@patch("httpx.AsyncClient")
def test_cache_hit_avoids_second_http_call(mock_client_cls):
    mock_resp = _mock_response(200, {
        "org": "AS16509 Amazon Technologies Inc.",
        "privacy": {},
    })
    ctx = AsyncMock()
    ctx.get = AsyncMock(return_value=mock_resp)
    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=ctx)
    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

    from services.asn_classifier import classify_ip
    r1 = _run(classify_ip("8.8.8.8"))
    r2 = _run(classify_ip("8.8.8.8"))

    assert r1 == r2 == "datacenter"
    # HTTP was called exactly once — second call hit the cache
    assert ctx.get.call_count == 1
