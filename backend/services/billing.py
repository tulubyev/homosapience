# backend/services/billing.py
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
R1-E billing plans. Plan names + labels are defined in code; monthly caps are
overridable per-plan from the environment (PLAN_<NAME>_CAP), with the code dict
as the fallback default. None cap = unlimited.
"""
from __future__ import annotations

import os

DEFAULT_PLAN = "free"

PLANS: dict[str, dict] = {
    "free":       {"label": "Free",       "monthly_cap": 1000},
    "pro":        {"label": "Pro",        "monthly_cap": 50000},
    "enterprise": {"label": "Enterprise", "monthly_cap": None},   # None = unlimited
}

_UNLIMITED_TOKENS = {"", "0", "none", "unlimited", "inf"}


def is_valid_plan(plan: str) -> bool:
    return plan in PLANS


def plan_label(plan: str) -> str:
    return PLANS.get(plan, PLANS[DEFAULT_PLAN])["label"]


def plan_cap(plan: str) -> "int | None":
    """Monthly cap for a plan; None = unlimited. Unknown plan → free.
    Resolution: PLAN_<NAME>_CAP env → (FREE_VERIFY_CAP for free) → code default."""
    if plan not in PLANS:
        plan = DEFAULT_PLAN
    raw = os.getenv(f"PLAN_{plan.upper()}_CAP")
    if raw is None and plan == "free":
        raw = os.getenv("FREE_VERIFY_CAP")
    if raw is not None:
        return None if raw.strip().lower() in _UNLIMITED_TOKENS else int(raw)
    return PLANS[plan]["monthly_cap"]


def all_plans() -> list[dict]:
    """For admin/console UIs: [{plan, label, monthly_cap}] with env-resolved caps."""
    return [{"plan": p, "label": v["label"], "monthly_cap": plan_cap(p)}
            for p, v in PLANS.items()]
