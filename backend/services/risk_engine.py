# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
risk_engine.py — R2 Risk Assessment Engine

Aggregates six signal categories into a risk_score ∈ [0, 1] and a
classification label (human / suspicious / bot / ai_agent).

Signal taxonomy
───────────────
S1  Network intel      datacenter ASN, VPN/proxy, Tor     (server-side, ip_intel.py)
S2  Automation/headless navigator.webdriver, CDP, plugins (client JS → riskSignals.ts)
S3  VM / emulator      canvas/audio fp anomalies, screen  (client JS)
S4  Behavioral micro   mouse entropy, typing rhythm       (client JS)
S5  Gesture/challenge  too_fast/slow/missed, pattern      (server-side, verify.py, EXISTING)
S6  FP/IP velocity     >N verifications/device or IP      (server-side, EXISTING)

Design principles
─────────────────
• Weighted sum → clamped [0, 1].  Hard-override rules can force score ≥ threshold.
• Explainable: every fired signal is listed in RiskResult.signals (strings).
• Zero-PII: raw IP/UA never stored — only boolean flags and region codes.
• Fail-open: if a signal source is unavailable, it contributes 0 (not error).
• RISK_GATE=false → assess() still returns a result, but verify.py ignores it.

Usage
─────
    from services.risk_engine import RiskEngine
    engine = RiskEngine()
    result = engine.assess(client_signals={...}, server_ctx={...})
    # RiskResult(score=0.72, classification="bot", signals=["datacenter_asn","webdriver"])
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional

from services.ip_intel import get_ip_intel

# ── Signal weights (sum ≠ 1; score is clamped to [0,1]) ──────────────────────
# Each weight represents the marginal contribution of ONE signal being true.
# Hard overrides (section below) take precedence for the strongest indicators.

_WEIGHTS: dict[str, float] = {
    # S1 — Network
    "datacenter_asn":    0.45,   # datacenter / cloud hosting ASN
    "vpn_proxy":         0.30,   # self-reported VPN/proxy flag (client-side heuristic)
    "tor_exit":          0.50,   # Tor exit node (ASN org contains "tor project")

    # S2 — Automation / headless
    "webdriver":         0.70,   # navigator.webdriver = true (selenium/puppeteer/playwright)
    "cdp_artifact":      0.65,   # Chrome DevTools Protocol artifact detected
    "no_plugins":        0.20,   # navigator.plugins.length === 0 in non-Firefox/Safari
    "headless_ua":       0.50,   # 'HeadlessChrome' in User-Agent
    "perm_denied":       0.20,   # navigator.permissions.query('notifications') = 'denied' when unconfigured
    "lang_mismatch":     0.15,   # navigator.language not in navigator.languages

    # S3 — VM / emulator
    "canvas_anomaly":    0.30,   # canvas fingerprint = known headless/vm hash
    "audio_anomaly":     0.25,   # AudioContext suspiciously flat/zero
    "hw_concurrency_0":  0.15,   # navigator.hardwareConcurrency === 0 (impossible on real hardware)
    "screen_anomaly":    0.20,   # screen size/depth impossible for real display (e.g. 0×0, 8-bit)
    "pixel_ratio_0":     0.15,   # window.devicePixelRatio === 0 or > 5

    # S4 — Behavioral micro
    "low_mouse_entropy": 0.30,   # mouse path entropy too low (straight lines, grid patterns)
    "robotic_timing":    0.35,   # inter-event intervals too regular (low std dev)
    "no_scroll_events":  0.10,   # zero scroll events before gesture (suspicious on desktop)
    "instant_focus":     0.20,   # page focus-to-gesture < 300ms (pre-loaded script)

    # S5 — Gesture / challenge (existing, from verify.py challenge_anomalies)
    "challenge_too_fast":  0.60,
    "challenge_missed":    0.35,
    "challenge_too_slow":  0.10,
    "challenge_tap_too_far": 0.15,
    "gesture_too_short":   0.25,  # custom flag: duration well below minimum

    # S6 — Velocity (existing rate-limiter signals)
    "ip_rate_limit":     0.40,   # IP exceeded verify rate limit
    "fp_rate_limit":     0.45,   # Device fingerprint exceeded 30-day limit
}

# ── Hard override rules ───────────────────────────────────────────────────────
# If these combinations fire, score is forced to at least this value.
# Evaluated AFTER weighted sum.
_HARD_OVERRIDES: list[tuple[set[str], float]] = [
    ({"webdriver"},                                 0.80),   # webdriver alone → bot
    ({"cdp_artifact"},                              0.75),   # CDP alone → likely bot
    ({"webdriver", "datacenter_asn"},               0.92),   # cloud + webdriver → block threshold
    ({"headless_ua"},                               0.70),
    ({"challenge_too_fast"},                        0.75),   # < 80ms human-impossible
    ({"webdriver", "challenge_too_fast"},           0.96),   # definitely bot
]

# ── Classification thresholds ─────────────────────────────────────────────────
_THRESH_HUMAN      = 0.25   # risk < 0.25 → human
_THRESH_BOT        = 0.60   # risk ≥ 0.60 → bot (unless ai_agent)
_THRESH_BLOCK      = 0.85   # risk ≥ 0.85 → hard block recommended

# ai_agent: human-LIKE behavior but automation artifacts present.
# Condition: score in [0.40, 0.85] AND (webdriver OR cdp_artifact) AND
#            no challenge_too_fast (it reacted at human speed).
_AI_AGENT_AUTOMATION = {"webdriver", "cdp_artifact", "headless_ua"}
_AI_AGENT_NO_BLOCK   = {"challenge_too_fast"}   # if present → plain bot, not ai_agent


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class RiskResult:
    score:          float               # ∈ [0.0, 1.0]
    classification: str                 # human | suspicious | bot | ai_agent
    signals:        list[str] = field(default_factory=list)
    blocked:        bool = False        # True if score ≥ THRESH_BLOCK
    step_up:        bool = False        # True if suspicious → ask harder challenge
    gesture_min_s:  int = 8            # recommended gesture minimum (adaptive)
    # Explainability
    raw_score:      float = 0.0        # score before hard-override
    overrides:      list[str] = field(default_factory=list)


class RiskEngine:
    """
    Stateless risk assessment engine.
    Instantiate once (e.g. as app.state.risk_engine) and call assess() per request.
    """

    def assess(
        self,
        client_signals: dict[str, Any],
        server_ctx: dict[str, Any],
    ) -> RiskResult:
        """
        Compute risk score from combined client and server signals.

        client_signals (from riskSignals.ts, POST /api/risk/assess):
            webdriver: bool
            cdp_artifact: bool
            no_plugins: bool
            headless_ua: bool
            perm_denied: bool
            lang_mismatch: bool
            canvas_anomaly: bool
            audio_anomaly: bool
            hw_concurrency_0: bool
            screen_anomaly: bool
            pixel_ratio_0: bool
            low_mouse_entropy: bool
            robotic_timing: bool
            no_scroll_events: bool
            instant_focus: bool
            vpn_proxy: bool (client-declared, low trust)

        server_ctx (populated by verify.py / risk.py):
            client_ip: str
            challenge_anomalies: list[str]   — from verify.py (may be empty pre-gesture)
            fp_rate_limit: bool
            ip_rate_limit: bool
            gesture_duration_ms: int | None
        """
        fired: list[str] = []

        # ── S1: Network ────────────────────────────────────────────────────────
        client_ip = server_ctx.get("client_ip", "")
        if client_ip:
            intel = get_ip_intel()
            asn_result = intel.lookup(client_ip)
            if asn_result.is_datacenter:
                fired.append("datacenter_asn")
            # Tor: MaxMind ASN org sometimes contains "Tor"
            if asn_result.org and "tor" in asn_result.org.lower():
                fired.append("tor_exit")

        # Client-declared VPN (low weight — can be gamed, but signals intent)
        if client_signals.get("vpn_proxy"):
            fired.append("vpn_proxy")

        # ── S2: Automation / headless ──────────────────────────────────────────
        for key in ("webdriver", "cdp_artifact", "no_plugins",
                    "headless_ua", "perm_denied", "lang_mismatch"):
            if client_signals.get(key):
                fired.append(key)

        # ── S3: VM / emulator ─────────────────────────────────────────────────
        for key in ("canvas_anomaly", "audio_anomaly", "hw_concurrency_0",
                    "screen_anomaly", "pixel_ratio_0"):
            if client_signals.get(key):
                fired.append(key)

        # ── S4: Behavioral micro ──────────────────────────────────────────────
        for key in ("low_mouse_entropy", "robotic_timing",
                    "no_scroll_events", "instant_focus"):
            if client_signals.get(key):
                fired.append(key)

        # ── S5: Gesture / challenge (passed from verify.py) ───────────────────
        challenge_anomalies: list[str] = server_ctx.get("challenge_anomalies", [])
        for anom in challenge_anomalies:
            # Normalise to base name (strip [idx] suffix and "reaction_ms:…")
            if anom.startswith("challenge_too_fast"):
                fired.append("challenge_too_fast")
            elif anom.startswith("challenge_missed"):
                fired.append("challenge_missed")
            elif anom.startswith("challenge_too_slow"):
                fired.append("challenge_too_slow")
            elif anom.startswith("challenge_tap_too_far"):
                fired.append("challenge_tap_too_far")

        # Gesture duration sanity (only if we have the value)
        gdur = server_ctx.get("gesture_duration_ms")
        if gdur is not None and gdur < 5000:
            fired.append("gesture_too_short")

        # ── S6: Velocity ──────────────────────────────────────────────────────
        if server_ctx.get("ip_rate_limit"):
            fired.append("ip_rate_limit")
        if server_ctx.get("fp_rate_limit"):
            fired.append("fp_rate_limit")

        # ── Weighted sum ──────────────────────────────────────────────────────
        raw = sum(_WEIGHTS.get(s, 0.0) for s in fired)
        raw = min(raw, 1.0)

        # ── Hard overrides ────────────────────────────────────────────────────
        fired_set = set(fired)
        score = raw
        applied_overrides: list[str] = []
        for (required_signals, min_score) in _HARD_OVERRIDES:
            if required_signals.issubset(fired_set) and score < min_score:
                score = min_score
                applied_overrides.append(
                    f"override:{'+'.join(sorted(required_signals))}→{min_score}"
                )
        score = round(min(score, 1.0), 4)

        # ── Classification ────────────────────────────────────────────────────
        classification = _classify(score, fired_set)

        # ── Adaptive gesture ──────────────────────────────────────────────────
        gesture_min_s = _gesture_seconds(score)

        return RiskResult(
            score=score,
            classification=classification,
            signals=list(dict.fromkeys(fired)),   # deduplicated, order preserved
            blocked=(score >= _THRESH_BLOCK),
            step_up=(score >= _THRESH_HUMAN and score < _THRESH_BLOCK),
            gesture_min_s=gesture_min_s,
            raw_score=round(raw, 4),
            overrides=applied_overrides,
        )


def _classify(score: float, fired: set[str]) -> str:
    """
    Determine threat classification from score and signal set.

    ai_agent: acts human-like (passed behavioral checks, no challenge_too_fast)
              but has automation artifacts (webdriver/CDP/headless).
    bot:      automation artifacts OR high score from other signals.
    suspicious: borderline, needs step-up challenge.
    human:    low risk, no automation artifacts.
    """
    has_automation = bool(fired & _AI_AGENT_AUTOMATION)
    has_human_speed_failure = bool(fired & _AI_AGENT_NO_BLOCK)

    if score >= _THRESH_BOT:
        if has_automation and not has_human_speed_failure and score < _THRESH_BLOCK:
            # Automation artifacts + human-speed reaction → likely AI agent / agentic browser
            return "ai_agent"
        return "bot"

    if score >= _THRESH_HUMAN:
        if has_automation:
            # Mid-range score but with automation signal → suspicious, could be ai_agent
            return "ai_agent" if not has_human_speed_failure else "suspicious"
        return "suspicious"

    return "human"


def _gesture_seconds(score: float) -> int:
    """Adaptive gesture minimum based on risk score (used by RISK_GATE)."""
    if score < 0.20:
        return 3    # Low-risk: shorter gesture, less friction
    if score < 0.60:
        return 8    # Default (current production)
    return 10       # High-risk: longer gesture, stricter
