# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
domain_verify.py — R1-D1 domain-ownership proof.

An org proves control of an origin via a DNS-TXT record (preferred) or a
well-known file. Network checks are isolated in _check_dns_txt / _check_well_known
so tests can monkeypatch them. The well-known fetch is SSRF-guarded.
"""

from __future__ import annotations

import asyncio
import ipaddress
import secrets
import socket
import urllib.request
from urllib.parse import urlsplit

PROOF_PREFIX = "aptogon-domain-verification"
WELL_KNOWN_PATH = "/.well-known/aptogon-domain-verification.txt"
_MAX_BODY = 65536
_TIMEOUT = 5.0


def normalize_origin(raw: str) -> "str | None":
    """Return scheme://host[:port] lowercased, default port stripped, or None."""
    raw = (raw or "").strip()
    if not raw:
        return None
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.hostname
    if not host:
        return None
    host = host.lower()
    try:
        port = parts.port
    except ValueError:
        return None
    default = 443 if parts.scheme == "https" else 80
    netloc = host if (port is None or port == default) else f"{host}:{port}"
    return f"{parts.scheme}://{netloc}"


def generate_token() -> str:
    return secrets.token_urlsafe(24)


def proof_string(token: str) -> str:
    return f"{PROOF_PREFIX}={token}"


def _host_of(origin: str) -> str:
    return (urlsplit(origin).hostname or "").lower()


def _netloc_of(origin: str) -> str:
    return urlsplit(origin).netloc.lower()


def well_known_url(origin: str) -> str:
    # Always probe over HTTPS on the origin's host[:port].
    return f"https://{_netloc_of(origin)}{WELL_KNOWN_PATH}"


def dns_record_name(origin: str) -> str:
    return f"_aptogon.{_host_of(origin)}"


def dns_record_value(token: str) -> str:
    return proof_string(token)


# ── SSRF-guarded checks ─────────────────────────────────────────────────────

# RFC 6598 carrier-grade NAT ("shared address space"). Python < 3.11 does NOT
# classify this as private via is_private, so block it explicitly.
_CGNAT = ipaddress.ip_network("100.64.0.0/10")


def _is_public_host(host: str) -> bool:
    """True only if every resolved IP is a public address."""
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    if not infos:
        return False
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_multicast or addr.is_unspecified):
            return False
        if addr.version == 4 and addr in _CGNAT:
            return False
    return True


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # disallow redirects (SSRF)


def _fetch_well_known_sync(url: str, host: str) -> str:
    if not _is_public_host(host):
        return ""
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": "APTOGON-DomainVerify/1"})
    try:
        with opener.open(req, timeout=_TIMEOUT) as resp:
            return resp.read(_MAX_BODY).decode("utf-8", "replace")
    except Exception:
        return ""


async def _check_well_known(origin: str, token: str) -> bool:
    body = await asyncio.to_thread(_fetch_well_known_sync, well_known_url(origin), _host_of(origin))
    return proof_string(token) in body


def _resolve_txt_sync(name: str) -> "list[str]":
    try:
        import dns.resolver
        resolver = dns.resolver.Resolver()
        resolver.lifetime = _TIMEOUT
        answers = resolver.resolve(name, "TXT")
        out: list[str] = []
        for rdata in answers:
            try:
                out.append(b"".join(rdata.strings).decode("utf-8", "replace"))
            except Exception:
                out.append(str(rdata).strip('"'))
        return out
    except Exception:
        return []


async def _check_dns_txt(origin: str, token: str) -> bool:
    records = await asyncio.to_thread(_resolve_txt_sync, dns_record_name(origin))
    want = proof_string(token)
    return any(want in r for r in records)


async def verify_origin(origin: str, token: str, method: "str | None" = None) -> "str | None":
    """Return the method that proved ownership ('dns_txt'/'well_known'), or None."""
    if method == "dns_txt":
        return "dns_txt" if await _check_dns_txt(origin, token) else None
    if method == "well_known":
        return "well_known" if await _check_well_known(origin, token) else None
    # default: DNS-TXT preferred, then well-known
    if await _check_dns_txt(origin, token):
        return "dns_txt"
    if await _check_well_known(origin, token):
        return "well_known"
    return None
