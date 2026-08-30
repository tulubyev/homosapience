# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
ASN / IP-type classifier — maps an IP address to a network-type label without
storing the raw IP.

Labels:
  datacenter  — cloud / hosting provider (AWS, GCP, Azure, DO, Hetzner, …)
  vpn         — known VPN / proxy exit node
  tor         — Tor exit node
  residential — ISP / mobile carrier (low risk)
  unknown     — lookup failed or timed out (fail-open, never blocks)

Uses ipinfo.io free tier (50 K req/month, no key required for basic fields).
A 24-hour in-memory LRU cache (keyed on ip_hash, NOT the raw IP) limits
external calls.

Feature flag: FEATURE_ASN_CLASSIFICATION (default False).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Optional

log = logging.getLogger("aptogon.asn")

# ── Datacenter / hosting org fragments ───────────────────────────────────────

_DATACENTER_ORGS = frozenset({
    "amazon", "aws", "google", "goog", "azure", "microsoft",
    "digitalocean", "linode", "akamai", "vultr", "hetzner", "ovh",
    "cloudflare", "fastly", "rackspace", "ibm cloud", "oracle cloud",
    "alibaba cloud", "tencent cloud", "huawei cloud", "choopa",
    "choopa llc", "constant", "psychz", "quadranet",
})

# ── Simple LRU cache (ip_hash → (asn_type, expires_at)) ─────────────────────

_CACHE_MAX   = 1_000      # max entries
_CACHE_TTL   = 86_400     # 24 h

_cache: dict[str, tuple[str, float]] = {}
_cache_lock = asyncio.Lock()


async def _cache_get(ip_hash: str) -> Optional[str]:
    async with _cache_lock:
        entry = _cache.get(ip_hash)
        if entry and entry[1] > time.monotonic():
            return entry[0]
        return None


async def _cache_set(ip_hash: str, asn_type: str) -> None:
    async with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            # Evict 10 % oldest entries (approximated by expiry)
            oldest = sorted(_cache.items(), key=lambda kv: kv[1][1])[:100]
            for k, _ in oldest:
                del _cache[k]
        _cache[ip_hash] = (asn_type, time.monotonic() + _CACHE_TTL)


# ── Classifier ────────────────────────────────────────────────────────────────

def _classify_from_data(data: dict) -> str:
    """Derive label from ipinfo.io JSON fields."""
    privacy = data.get("privacy", {})
    if isinstance(privacy, dict):
        if privacy.get("tor"):
            return "tor"
        if privacy.get("vpn") or privacy.get("proxy"):
            return "vpn"

    org = (data.get("org") or "").lower()
    hosting = data.get("hosting") or data.get("bogon")
    if hosting:
        return "datacenter"
    if any(frag in org for frag in _DATACENTER_ORGS):
        return "datacenter"

    return "residential"


async def classify_ip(ip: str) -> str:
    """
    Classify an IP address by network type.

    Returns 'datacenter' | 'residential' | 'vpn' | 'tor' | 'unknown'.
    Never raises — on any error returns 'unknown' (fail-open).
    Raw IP is never stored; cache key is a truncated SHA-256 of the IP.
    """
    if not ip or ip in ("unknown", "localhost", "127.0.0.1", "::1"):
        return "unknown"

    ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:32]

    cached = await _cache_get(ip_hash)
    if cached is not None:
        return cached

    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(
                f"https://ipinfo.io/{ip}/json",
                headers={"Accept": "application/json"},
            )
            if r.status_code == 429:
                log.debug("asn_classifier: ipinfo.io rate-limited, returning unknown")
                return "unknown"
            if r.status_code != 200:
                return "unknown"
            data = r.json()
    except Exception as exc:
        log.debug("asn_classifier: lookup failed for ip_hash=%s: %s", ip_hash[:8], exc)
        return "unknown"

    asn_type = _classify_from_data(data)
    await _cache_set(ip_hash, asn_type)
    log.debug("asn_classifier: ip_hash=%s → %s", ip_hash[:8], asn_type)
    return asn_type
