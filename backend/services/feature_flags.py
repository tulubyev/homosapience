# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
Feature flags — позволяют лить новый код (R1–R6) в main, но держать его
«тёмным», пока фича не созрела. Включается одной env-переменной без слияния
веток и с мгновенным откатом.

Использование (backend):
    from services.feature_flags import feature_enabled
    if feature_enabled("EMBED_API"):
        app.include_router(embed.router, prefix="/api/embed", tags=["Embed"])

Использование (frontend узнаёт через GET /api/features):
    скрываем страницы /console, /stats, /pricing пока флаг off.

Формат env (.env): FEATURE_<NAME>=true|false (регистр и true/1/yes/on — все ок).
"""

from __future__ import annotations

import os

# Известные флаги + значения по умолчанию (всё выключено = текущее поведение прода).
# Добавляй сюда новый флаг при старте каждой фичи R1–R6.
DEFAULT_FLAGS: dict[str, bool] = {
    "EMBED_API":      False,  # R1 — org-facing /api/embed/* (drop-in verify)
    "CAPTCHA_API":    False,  # gesture-CAPTCHA — /api/captcha/* embeddable widget (iframe + siteverify)
    "CONSOLE":        False,  # R1 — org dashboard /console (API keys, usage, billing)
    "REQUIRE_DOMAIN_VERIFICATION": False,  # R1-D1 — enforce verified origins in embed challenge
    "SELF_SERVE_KEYS": False,  # R1-D2 — verified humans self-manage keys (couples domain enforcement)
    "STATS_COLLECT":  False,  # R2 — пассивный сбор risk_events (независимо от RISK_GATE)
    "STATS_PAGE":     False,  # R2 — публичная страница статистики атак /stats
    "RISK_GATE":      False,  # R2 — адаптивный жест в verify.py (risk-based длина)
    "BENCHMARK_PAGE": False,  # R6 — /research бенчмарк
    "ALERTS":        False,  # R1-D4 — org-owner alert feed + extension push
    "BILLING":       False,  # R1-E — plan-based pooled quota enforcement + console/admin UI
    "DEVICE_ACCOUNTS": False, # B — per-device keys linked into one person (account aggregate, unlink)
    "GOLD_NETWORK_LIVE": False, # Gold Member vouching network is in production (flip ON to drop the "Test" badge on /stats community block)
    "BOT_SHIELD":  True,   # HTTP-layer bot detection: UA blocklist + Origin + Accept-Language
    "ASN_CLASSIFICATION": False,  # ASN/IP-type classification via ipinfo.io (datacenter/residential/vpn/tor)
    "AGENT_PASSPORT": False,  # HDAA: Human-Delegated Agent Authentication delegation tokens
    "BADGE_PRIVACY": False,  # Shielded Human: badges private-by-default; public only on opt-in
    "GESTURE_STUDY": False,  # consented lab study: /research/study collects labelled gestures
}

_TRUTHY = {"1", "true", "yes", "on", "y"}


def feature_enabled(name: str, default: bool | None = None) -> bool:
    """
    True, если фича включена через env FEATURE_<NAME>.
    Если переменная не задана — берём DEFAULT_FLAGS, иначе переданный default,
    иначе False. Имя нечувствительно к регистру.
    """
    key = name.strip().upper()
    raw = os.getenv(f"FEATURE_{key}")
    if raw is not None:
        return raw.strip().lower() in _TRUTHY
    if default is not None:
        return default
    return DEFAULT_FLAGS.get(key, False)


def all_flags() -> dict[str, bool]:
    """Текущее состояние всех известных флагов (для /api/features и дебага)."""
    return {name: feature_enabled(name) for name in DEFAULT_FLAGS}
