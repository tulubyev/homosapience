# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
R6.3 data-access — profile→level classification and tiered package builder.

Levels (auto-suggested from the DID profile; admin can override):
  full     gold_member OR trust_score >= 0.7 OR bond_count >= 3
  standard trust_score >= 0.4 OR bond_count >= 1
  basic    otherwise
Package windows: basic 30d (totals), standard 90d (+by_day), full 180d (+signals).
All aggregates — zero-PII preserved.
"""
from __future__ import annotations

LEVELS = ("basic", "standard", "full")
LEVEL_DAYS = {"basic": 30, "standard": 90, "full": 180}


def is_valid_level(level: str) -> bool:
    return level in LEVELS


def classify_level(profile: dict) -> str:
    """profile: {trust_score, bond_count, gold_member}. Returns basic|standard|full."""
    trust = float(profile.get("trust_score") or 0.0)
    bonds = int(profile.get("bond_count") or 0)
    if profile.get("gold_member") or trust >= 0.7 or bonds >= 3:
        return "full"
    if trust >= 0.4 or bonds >= 1:
        return "standard"
    return "basic"


async def build_package(db, level: str) -> dict:
    """Build the tiered stats package for an approved request."""
    if level not in LEVEL_DAYS:
        level = "basic"
    days = LEVEL_DAYS[level]
    pkg: dict = {"level": level, "period_days": days,
                 "totals": await db.get_attack_stats(days=days)}
    if level in ("standard", "full"):
        pkg["by_day"] = await db.get_attack_stats_by_day(days=days)
    if level == "full":
        pkg["signals"] = await db.get_signal_breakdown(days=days)
    return pkg
