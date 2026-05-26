# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/risk — R2 Risk Assessment endpoints

POST /api/risk/assess   → client submits S2–S4 signals → returns risk_score + classification
GET  /api/risk/stats    → public attack statistics (behind STATS_PAGE flag)

Registration in main.py (behind feature flag):
    if feature_enabled("RISK_GATE") or feature_enabled("STATS_COLLECT"):
        from routers import risk as risk_router
        app.include_router(risk_router.router, prefix="/api/risk", tags=["Risk"])
"""

from __future__ import annotations

import hashlib
import time
from typing import Any, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from services.feature_flags import feature_enabled

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class ClientSignals(BaseModel):
    """
    Client-side risk signals collected by riskSignals.ts.
    All fields are boolean.  Extra fields are silently ignored.
    """
    # S2 — Automation / headless
    webdriver:     bool = False
    cdp_artifact:  bool = False
    no_plugins:    bool = False
    headless_ua:   bool = False
    perm_denied:   bool = False
    lang_mismatch: bool = False

    # S3 — VM / emulator
    canvas_anomaly:    bool = False
    audio_anomaly:     bool = False
    hw_concurrency_0:  bool = False
    screen_anomaly:    bool = False
    pixel_ratio_0:     bool = False

    # S4 — Behavioral micro
    low_mouse_entropy: bool = False
    robotic_timing:    bool = False
    no_scroll_events:  bool = False
    instant_focus:     bool = False

    # Client-declared VPN/proxy (low trust, but captured)
    vpn_proxy: bool = False

    # Optional session identifier (for de-duplication; hashed server-side)
    session_id: Optional[str] = Field(None, max_length=128)


class RiskAssessResponse(BaseModel):
    risk_score:     float
    classification: str         # human | suspicious | bot | ai_agent
    signals:        list[str]   # list of fired signal names
    blocked:        bool
    step_up:        bool
    gesture_min_s:  int         # recommended gesture length in seconds


# ── POST /api/risk/assess ─────────────────────────────────────────────────────

@router.post("/assess", response_model=RiskAssessResponse)
async def assess_risk(body: ClientSignals, request: Request):
    """
    Receive client-side signals and compute risk score.
    Called by the frontend before or during the gesture challenge.

    Returns risk assessment — the frontend can use gesture_min_s to adjust
    its timer before submitting to /api/verify/expression.
    Result is also persisted to risk_events if STATS_COLLECT flag is on.
    """
    from services.risk_engine import RiskEngine

    # Extract server-side context
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "")
    )

    # Rate-limit signals from server state
    rl = getattr(request.app.state, "rate_limiter", None)
    ip_rate_limited = False
    if rl:
        allowed, _ = await rl.check_verify_ip(client_ip)
        ip_rate_limited = not allowed

    server_ctx: dict[str, Any] = {
        "client_ip": client_ip,
        "challenge_anomalies": [],     # not yet available at this stage
        "ip_rate_limit": ip_rate_limited,
        "fp_rate_limit": False,        # FP check happens in /api/verify/expression
    }

    engine: RiskEngine = getattr(request.app.state, "risk_engine", None) or RiskEngine()
    result = engine.assess(
        client_signals=body.model_dump(exclude={"session_id"}),
        server_ctx=server_ctx,
    )

    # ── Persist event if STATS_COLLECT is enabled ─────────────────────────────
    if feature_enabled("STATS_COLLECT"):
        db = getattr(request.app.state, "db", None)
        if db:
            # Hash session_id for de-duplication (zero-PII)
            sess_hash = (
                hashlib.sha256(body.session_id.encode()).hexdigest()[:32]
                if body.session_id else None
            )
            outcome = (
                "blocked" if result.blocked
                else "stepped_up" if result.step_up
                else "passed"
            )
            await db.record_risk_event(
                session_hash=sess_hash,
                risk_score=result.score,
                classification=result.classification,
                signals=result.signals,
                outcome=outcome,
                api_key=request.headers.get("X-APTOGON-API-Key"),
            )

    return RiskAssessResponse(
        risk_score=result.score,
        classification=result.classification,
        signals=result.signals,
        blocked=result.blocked,
        step_up=result.step_up,
        gesture_min_s=result.gesture_min_s,
    )


# ── GET /api/risk/stats ───────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(request: Request, days: int = 30):
    """
    Public attack statistics.
    Available when STATS_PAGE feature flag is enabled.
    """
    if not feature_enabled("STATS_PAGE"):
        return {"available": False, "message": "Stats page not yet enabled."}

    db = getattr(request.app.state, "db", None)
    if not db:
        return {"available": False, "message": "Database not connected."}

    totals = await db.get_attack_stats(days=days)
    by_day = await db.get_attack_stats_by_day(days=days)

    return {
        "available": True,
        "period_days": days,
        "totals": totals,
        "by_day": by_day,
        "generated_at": int(time.time()),
    }
