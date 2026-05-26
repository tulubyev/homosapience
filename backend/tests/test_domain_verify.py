from services import domain_verify as dv


def test_normalize_origin_basic():
    assert dv.normalize_origin("https://Example.com/") == "https://example.com"
    assert dv.normalize_origin("https://example.com:443") == "https://example.com"
    assert dv.normalize_origin("https://example.com:8443") == "https://example.com:8443"
    assert dv.normalize_origin("http://example.com:80/path") == "http://example.com"
    assert dv.normalize_origin("  https://EXAMPLE.com  ") == "https://example.com"


def test_normalize_origin_rejects_bad():
    assert dv.normalize_origin("ftp://example.com") is None
    assert dv.normalize_origin("file:///etc/passwd") is None
    assert dv.normalize_origin("not a url") is None
    assert dv.normalize_origin("") is None


def test_token_unique_and_urlsafe():
    a, b = dv.generate_token(), dv.generate_token()
    assert a != b and len(a) >= 16


def test_proof_and_builders():
    assert dv.proof_string("TOK") == "aptogon-domain-verification=TOK"
    assert dv.well_known_url("https://example.com") == \
        "https://example.com/.well-known/aptogon-domain-verification.txt"
    assert dv.well_known_url("https://example.com:8443") == \
        "https://example.com:8443/.well-known/aptogon-domain-verification.txt"
    assert dv.dns_record_name("https://example.com:8443") == "_aptogon.example.com"
    assert dv.dns_record_value("TOK") == "aptogon-domain-verification=TOK"


def test_host_of():
    assert dv._host_of("https://example.com:8443") == "example.com"
    assert dv._host_of("https://sub.example.com") == "sub.example.com"


import socket as _socket


def test_is_public_host_rejects_private(monkeypatch):
    def fake_getaddrinfo(host, *a, **k):
        return [(2, 1, 6, "", ("10.0.0.5", 0))]
    monkeypatch.setattr(dv.socket, "getaddrinfo", fake_getaddrinfo)
    assert dv._is_public_host("internal.example.com") is False


def test_is_public_host_accepts_public(monkeypatch):
    def fake_getaddrinfo(host, *a, **k):
        return [(2, 1, 6, "", ("93.184.216.34", 0))]
    monkeypatch.setattr(dv.socket, "getaddrinfo", fake_getaddrinfo)
    assert dv._is_public_host("example.com") is True


def test_is_public_host_unresolvable_is_false(monkeypatch):
    def fake_getaddrinfo(*a, **k):
        raise _socket.gaierror("nope")
    monkeypatch.setattr(dv.socket, "getaddrinfo", fake_getaddrinfo)
    assert dv._is_public_host("nope.invalid") is False


async def test_verify_origin_dns_first(monkeypatch):
    async def ok(origin, token): return True
    async def no(origin, token): return False
    monkeypatch.setattr(dv, "_check_dns_txt", ok)
    monkeypatch.setattr(dv, "_check_well_known", no)
    assert await dv.verify_origin("https://example.com", "TOK") == "dns_txt"


async def test_verify_origin_falls_back_to_well_known(monkeypatch):
    async def no(origin, token): return False
    async def ok(origin, token): return True
    monkeypatch.setattr(dv, "_check_dns_txt", no)
    monkeypatch.setattr(dv, "_check_well_known", ok)
    assert await dv.verify_origin("https://example.com", "TOK") == "well_known"


async def test_verify_origin_method_specific(monkeypatch):
    async def no(origin, token): return False
    async def ok(origin, token): return True
    monkeypatch.setattr(dv, "_check_dns_txt", ok)
    monkeypatch.setattr(dv, "_check_well_known", no)
    assert await dv.verify_origin("https://example.com", "TOK", method="well_known") is None


async def test_verify_origin_none_when_both_fail(monkeypatch):
    async def no(origin, token): return False
    monkeypatch.setattr(dv, "_check_dns_txt", no)
    monkeypatch.setattr(dv, "_check_well_known", no)
    assert await dv.verify_origin("https://example.com", "TOK") is None
