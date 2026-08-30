# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
ip_intel.py — S1 Network Intelligence (R2 Risk Engine)

Offline MaxMind GeoLite2-ASN lookup.  Zero-PII: raw IP is never stored —
only derived flags (is_datacenter, country_band) are returned.

Degrades gracefully: if .mmdb absent → returns default ASNResult(is_datacenter=False).

Usage:
    from services.ip_intel import IPIntel
    intel = IPIntel()            # loads once at import (lazy, cached)
    result = intel.lookup("1.2.3.4")
    # ASNResult(asn=12345, org="AS12345 AMAZON-02", is_datacenter=True, country_band="US")
"""

from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    import maxminddb
    _HAS_MMDB = True
except ImportError:
    _HAS_MMDB = False

# ── Known datacenter / hosting ASN prefixes (conservative list) ──────────────
# These are used as a fallback AND to classify ASNs retrieved from GeoLite2.
# Format: (asn_number_or_0, name_fragment_lower) — name match is substring.
# Zero means "skip ASN number check, match by name only".
_DC_NAME_FRAGMENTS: tuple[str, ...] = (
    "amazon",       # AWS
    "google",       # GCP, Google Cloud
    "microsoft",    # Azure
    "digitalocean",
    "linode",
    "vultr",
    "ovh",
    "hetzner",
    "cloudflare",   # CF workers / pages
    "fastly",
    "akamai",
    "oracle cloud",
    "alibaba",
    "tencent cloud",
    "choopa",        # Vultr AS20473
    "datacamp",
    "leaseweb",
    "serverius",
    "contabo",
    "scaleway",
    "upcloud",
    "packet",       # Equinix Metal
    "equinix",
    "cogent",
    "zscaler",
    "tor project",  # Tor exit nodes sometimes
)

# Private / reserved ranges — skip ASN lookup for these
_PRIVATE_NETS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]

# Path to the .mmdb file; override via env MAXMIND_ASN_DB
_DEFAULT_DB_PATH = Path(__file__).parent.parent / "data" / "GeoLite2-ASN.mmdb"


@dataclass
class ASNResult:
    asn: Optional[int] = None
    org: Optional[str] = None           # "AS12345 AMAZON-02"
    is_datacenter: bool = False
    country_band: Optional[str] = None  # ISO-3166-1 alpha-2 or None


def _is_private(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in net for net in _PRIVATE_NETS)
    except ValueError:
        return False


def _classify_by_name(org: str) -> bool:
    """Return True if the org name matches known datacenter/hosting patterns."""
    org_lower = org.lower()
    return any(frag in org_lower for frag in _DC_NAME_FRAGMENTS)


class IPIntel:
    """
    Lazy-loaded GeoLite2-ASN reader.
    Thread-safe for reads; mmdb is opened once and kept in memory.
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        path_str = db_path or os.getenv("MAXMIND_ASN_DB", str(_DEFAULT_DB_PATH))
        self._db_path = Path(path_str)
        self._reader: "maxminddb.reader.Reader | None" = None
        self._available = False
        self._load()

    def _load(self) -> None:
        if not _HAS_MMDB:
            print("⚠️  ip_intel: maxminddb not installed — S1 signals disabled")
            return
        if not self._db_path.exists():
            print(f"⚠️  ip_intel: GeoLite2-ASN.mmdb not found at {self._db_path} — S1 signals disabled")
            return
        try:
            self._reader = maxminddb.open_database(str(self._db_path))
            self._available = True
            print(f"✅ ip_intel: GeoLite2-ASN loaded from {self._db_path}")
        except Exception as exc:
            print(f"⚠️  ip_intel: failed to open {self._db_path}: {exc}")

    def lookup(self, ip: str) -> ASNResult:
        """
        Look up ASN info for an IP address.
        Returns ASNResult with is_datacenter=False if lookup is unavailable.
        Never raises.
        """
        if not ip or ip == "unknown":
            return ASNResult()

        # Skip private/loopback ranges
        if _is_private(ip):
            return ASNResult()

        if not self._available or self._reader is None:
            return ASNResult()

        try:
            data = self._reader.get(ip)
            if not data:
                return ASNResult()

            asn_num = data.get("autonomous_system_number")
            asn_org = data.get("autonomous_system_organization") or ""

            is_dc = _classify_by_name(asn_org)

            return ASNResult(
                asn=asn_num,
                org=f"AS{asn_num} {asn_org}" if asn_num else asn_org,
                is_datacenter=is_dc,
                country_band=None,  # ASN db doesn't include country; use City db for that
            )
        except Exception:
            return ASNResult()

    def close(self) -> None:
        if self._reader:
            self._reader.close()
            self._reader = None

    @property
    def available(self) -> bool:
        return self._available


# Module-level singleton — imported by risk_engine
_intel: Optional[IPIntel] = None


def get_ip_intel() -> IPIntel:
    """Return (or lazily create) the module-level IPIntel singleton."""
    global _intel
    if _intel is None:
        _intel = IPIntel()
    return _intel
