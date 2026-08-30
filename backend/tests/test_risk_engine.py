"""Unit tests for the R2 RiskEngine (services/risk_engine.py).

Signals are exercised without S1 (network) by passing an empty client_ip, so
these tests are deterministic and do not depend on the GeoLite ASN database.
"""
from services.risk_engine import RiskEngine, _classify, _gesture_seconds


def _assess(client=None, server=None):
    engine = RiskEngine()
    return engine.assess(
        client_signals=client or {},
        server_ctx={"client_ip": "", **(server or {})},  # empty IP → skip S1
    )


# ── Clean human ────────────────────────────────────────────────────────────

def test_clean_human_is_human():
    r = _assess()
    assert r.score == 0.0
    assert r.classification == "human"
    assert r.blocked is False
    assert r.step_up is False
    assert r.gesture_min_s == 3   # low-risk → short gesture
    assert r.signals == []


# ── Suspicious (mid-score, no automation) ───────────────────────────────────

def test_behavioral_only_is_suspicious():
    # low_mouse_entropy (0.30) + no_scroll_events (0.10) = 0.40, no automation
    r = _assess(client={"low_mouse_entropy": True, "no_scroll_events": True})
    assert 0.25 <= r.score < 0.60
    assert r.classification == "suspicious"
    assert r.step_up is True
    assert r.blocked is False
    assert r.gesture_min_s == 8


# ── ai_agent: automation artifact + human-like (no challenge_too_fast) ───────

def test_cdp_artifact_clean_behavior_is_ai_agent():
    # cdp_artifact (0.65) → hard override → 0.75; no challenge_too_fast
    r = _assess(client={"cdp_artifact": True})
    assert r.classification == "ai_agent"
    assert 0.60 <= r.score < 0.85
    assert "cdp_artifact" in r.signals


# ── bot: automation + human-impossible challenge speed ──────────────────────

def test_webdriver_plus_too_fast_is_bot_blocked():
    r = _assess(
        client={"webdriver": True},
        server={"challenge_anomalies": ["challenge_too_fast[0]:42ms"]},
    )
    assert r.classification == "bot"
    assert r.blocked is True            # score ≥ 0.85
    assert r.score >= 0.85
    assert "webdriver" in r.signals
    assert "challenge_too_fast" in r.signals


# ── Hard override raises score even for a single strong signal ──────────────

def test_headless_ua_override_floor():
    # headless_ua weight 0.50, but override forces ≥ 0.70
    r = _assess(client={"headless_ua": True})
    assert r.score >= 0.70
    assert any(o.startswith("override:") for o in r.overrides)


# ── Signals are de-duplicated and explainable ───────────────────────────────

def test_signals_are_listed_and_deduped():
    r = _assess(
        client={"webdriver": True},
        server={"challenge_anomalies": ["challenge_too_fast", "challenge_too_fast[1]"]},
    )
    # challenge_too_fast collapsed to a single entry
    assert r.signals.count("challenge_too_fast") == 1


# ── Velocity signals from server context ────────────────────────────────────

def test_ip_rate_limit_signal_counts():
    r = _assess(server={"ip_rate_limit": True})
    assert "ip_rate_limit" in r.signals
    assert r.score >= 0.40   # ip_rate_limit weight


# ── Pure classifier / gesture helpers ───────────────────────────────────────

def test_classify_thresholds():
    assert _classify(0.10, set()) == "human"
    assert _classify(0.40, set()) == "suspicious"
    assert _classify(0.70, set()) == "bot"
    # automation + mid score, no human-speed failure → ai_agent
    assert _classify(0.50, {"webdriver"}) == "ai_agent"
    # automation + high score but human-speed failure → plain bot
    assert _classify(0.90, {"webdriver", "challenge_too_fast"}) == "bot"


def test_gesture_seconds_scale():
    assert _gesture_seconds(0.10) == 3
    assert _gesture_seconds(0.40) == 8
    assert _gesture_seconds(0.90) == 10


# ── Regression: mobile soft-signal stack must NOT hard-block (2026-07) ────────

def test_mobile_soft_stack_not_hard_blocked():
    """A real phone legitimately trips several soft signals (no plugins, denied
    notifications, suspended AudioContext, no scroll, lang quirk). Their sum can
    cross 0.85 — but with NO automation artifact it must not lock the user out."""
    r = _assess(client={
        "no_plugins": True, "perm_denied": True, "audio_anomaly": True,
        "no_scroll_events": True, "lang_mismatch": True,
    })
    assert r.score >= 0.85            # soft signals do stack high
    assert r.blocked is False         # …but never a HARD block without automation
    assert r.step_up is True          # instead: escalate to a harder challenge


def test_webdriver_still_hard_blocks():
    """A strong automation artifact at high score must still hard-block."""
    r = _assess(client={"webdriver": True, "no_plugins": True})
    assert r.blocked is True
