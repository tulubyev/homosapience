# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/captcha — embeddable gesture-CAPTCHA (lite token, no DID / no on-chain).

Flow (reCAPTCHA-shaped):
  1. A customer site embeds our iframe (/embed/verify?pk=…). The visitor draws a
     gesture; the iframe POSTs it to  POST /api/captcha/verify.
  2. We validate the publishable key + parent origin, CLASSIFY the fresh gesture
     with the same local-GBM / LLM path as /verify — but we never mint a DID or
     write to Aptos — and return a short-lived signed JWT ("human: yes/no").
  3. The customer's backend calls  POST /api/captcha/siteverify  with its secret
     key to validate the token exactly once (anti-replay + quota).

Every classified gesture is logged to gesture_metrics with the site's api_key so
the row feeds per-site stats and GBM retraining.

Behind the CAPTCHA_API feature flag (router registered only when enabled).
Reuses embed_service (nonce/redeem/trust_band) + the org api-key/quota primitives.
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services import embed_service
from services import alert_service as _alert_svc
from services.device_fingerprint import categorize_device_hint
from routers.verify import TouchEventDTO, ChallengeDTO, BrowserFingerprintDTO

router = APIRouter()

_ISS = "https://homosapience.org"
_TOKEN_TTL = 120  # seconds — captcha token is short-lived (submit-then-verify round-trip)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")


def _get_redis(request: Request):
    rl = getattr(request.app.state, "rate_limiter", None)
    return getattr(rl, "_redis", None) if rl else None


def _resolve_origin(request: Request, body_origin: Optional[str]) -> str:
    """Body origin is authoritative (the iframe reports the PARENT site's origin;
    its own Origin header is homosapience.org). Security comes from
    origin ∈ allowed_origins(pk) + the sk-authenticated /siteverify."""
    return (body_origin or "").strip() or request.headers.get("Origin", "")


async def _validate_key_origin(request: Request, pk: str, origin: str) -> dict:
    """Look up an active publishable key and assert the origin is allow-listed.
    Raises 403 (and fires an owner alert) on mismatch. Returns the key row."""
    db = request.app.state.db
    key = await db.get_api_key_by_pk(pk)
    if not key or not key["active"]:
        raise HTTPException(status_code=403, detail={"error": "invalid_key"})
    if await db.is_owner_suspended(key["owner_did"]):
        raise HTTPException(status_code=403, detail={"error": "account_suspended"})
    if origin not in key["allowed_origins"]:
        await _alert_svc.record_alert(
            db=db, owner_did=key["owner_did"], event_type="unknown_origin",
            level=1, severity="info", detail={"origin": origin, "surface": "captcha"},
            api_key_pk=pk,
        )
        raise HTTPException(status_code=403, detail={
            "error": "origin_not_allowed",
            "message": f"Origin '{origin}' is not in allowed_origins for this key",
        })
    return key


# ── Models ────────────────────────────────────────────────────────────────────

class CaptchaVerifyReq(BaseModel):
    publishable_key: str
    origin: Optional[str] = None
    challenge_id: Optional[str] = None            # optional server-issued binding
    events: list[TouchEventDTO] = Field(..., min_length=10)
    session_id: Optional[str] = None
    challenges: Optional[list[ChallengeDTO]] = None
    browser_fp: Optional[BrowserFingerprintDTO] = None


class SiteVerifyReq(BaseModel):
    token: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/verify")
async def captcha_verify(body: CaptchaVerifyReq, request: Request):
    """Classify a fresh gesture and return a short signed token. No DID, no Aptos."""
    redis = _get_redis(request)
    origin = _resolve_origin(request, body.origin)
    key = await _validate_key_origin(request, body.publishable_key, origin)

    # Optional stronger binding: a challenge_id issued by /challenge ties this
    # submission to a validated pk+origin pair.
    if body.challenge_id:
        data = await embed_service.consume_nonce(redis, body.challenge_id)
        if not data or data.get("pk") != body.publishable_key or data.get("origin") != origin:
            raise HTTPException(status_code=400, detail={"error": "invalid_or_used_challenge"})

    # Hard webdriver block before any inference (same as /verify).
    if body.browser_fp is not None and body.browser_fp.webdriver:
        raise HTTPException(status_code=403, detail={
            "error": "automation_detected",
            "message": "Automated browser detected.",
        })

    session_id = body.session_id or secrets.token_urlsafe(16)
    gonka = request.app.state.gonka

    # Classify — reuse the /verify gray-zone/LLM branch WITHOUT minting a DID or
    # writing to Aptos. Fail CLOSED on any classifier error (never emit human:true).
    pattern = None
    try:
        from sapix.expression_engine import TouchEvent, PatternExtractor
        events = [
            TouchEvent(x=e.x, y=e.y, pressure=e.pressure,
                       timestamp_ms=e.timestamp_ms, pause_after_ms=e.pause_after_ms)
            for e in body.events
        ]
        pattern = PatternExtractor().extract(events)
        result = None
        if os.getenv("ML_CLASSIFIER_MODE", "off").lower() == "active":
            _clf = getattr(request.app.state, "ml_classifier", None)
            if _clf is not None and getattr(_clf, "available", False):
                result = gonka.expression.verify_local(
                    events, session_id, _clf,
                    float(os.getenv("ML_CONFIDENT_HIGH", "0.85")),
                    float(os.getenv("ML_CONFIDENT_LOW", "0.15")),
                )
        if result is None:
            result = await gonka.expression.verify(events, session_id=session_id)
    except HTTPException:
        raise
    except Exception as exc:
        import logging as _log
        _log.getLogger("aptogon.security").error(
            "captcha: classifier unavailable — rejected: %s", exc
        )
        raise HTTPException(status_code=503, detail={
            "error": "classifier_unavailable",
            "message": "Verification service is temporarily unavailable. Please try again.",
        })

    human = bool(result.passed)
    band = embed_service.trust_band(float(result.confidence))

    # Log the gesture for per-site stats + GBM training (attributed to this key).
    _db = getattr(request.app.state, "db", None)
    if _db is not None and pattern is not None:
        try:
            await _db.log_gesture_metrics(
                passed=human,
                via_fallback=bool(result.via_fallback),
                rhythm_irregularity=round(pattern.rhythm_irregularity, 4),
                correction_count=pattern.correction_count,
                velocity_std=round(pattern.velocity_std, 4),
                velocity_mean=round(pattern.velocity_mean, 4),
                velocity_curvature_r=round(pattern.velocity_curvature_r, 4),
                pause_entropy=round(pattern.pause_entropy, 4),
                point_count=pattern.point_count,
                duration_ms=pattern.total_duration_ms,
                device_hint=categorize_device_hint(request.headers.get("User-Agent")),
                possible_motor_difficulty=pattern.possible_motor_difficulty,
                api_key=body.publishable_key,
                origin=origin,
                lift_count=pattern.lift_count,
                total_lift_ms=pattern.total_lift_ms,
            )
        except Exception:
            pass

    now = int(time.time())
    claims = {
        "iss": _ISS,
        "aud": origin,
        "human": human,
        "band": band,
        "nonce": secrets.token_urlsafe(24),   # anti-replay id for /siteverify
        "iat": now,
        "exp": now + _TOKEN_TTL,
    }
    token = request.app.state.server_key.sign_jwt(claims)
    return {"token": token, "human": human, "band": band}


@router.post("/siteverify")
async def captcha_siteverify(body: SiteVerifyReq, request: Request):
    """Server-to-server token validation (reCAPTCHA-style). Single-use + quota."""
    db = request.app.state.db
    redis = _get_redis(request)

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"error": "missing_secret_key"})
    sk = auth[7:].strip()

    from services.api_keys import hash_secret
    key = await db.get_api_key_by_secret_hash(hash_secret(sk))
    if not key or not key["active"]:
        raise HTTPException(status_code=401, detail={"error": "invalid_secret_key"})
    if await db.is_owner_suspended(key["owner_did"]):
        raise HTTPException(status_code=403, detail={"error": "account_suspended"})

    claims = request.app.state.server_key.verify_jwt(body.token)
    if not claims:
        raise HTTPException(status_code=400, detail={"error": "invalid_token"})
    if claims.get("aud") not in key["allowed_origins"]:
        raise HTTPException(status_code=403, detail={"error": "audience_mismatch"})

    # Monthly quota (admin-owned keys exempt) — same policy as embed /verify.
    period = time.strftime("%Y-%m", time.gmtime())
    owner_did = key["owner_did"]
    if not await db.is_admin_did(owner_did[-8:]):
        from services.feature_flags import feature_enabled
        if feature_enabled("BILLING"):
            from services import billing
            plan = await db.get_owner_plan(owner_did)
            cap = billing.plan_cap(plan)
            if cap is not None:
                used = await db.get_owner_usage(owner_did, period)
                if int(cap * 0.8) <= used < cap:
                    await _alert_svc.record_alert(
                        db=db, owner_did=owner_did, event_type="quota_warning",
                        level=1, severity="info",
                        detail={"plan": plan, "used": used, "cap": cap,
                                "pct": round(used / cap * 100)},
                        api_key_pk=key["publishable_key"],
                    )
                if used >= cap:
                    await _alert_svc.record_alert(
                        db=db, owner_did=owner_did, event_type="cap_exceeded",
                        level=1, severity="warning",
                        detail={"plan": plan, "used": used, "cap": cap, "period": period},
                        api_key_pk=key["publishable_key"],
                    )
                    raise HTTPException(status_code=429, detail={"error": "quota_exceeded"})
        else:
            cap = int(os.getenv("FREE_VERIFY_CAP", "1000"))
            if await db.get_usage(key["publishable_key"], period) >= cap:
                await _alert_svc.record_alert(
                    db=db, owner_did=owner_did, event_type="cap_exceeded",
                    level=1, severity="warning",
                    detail={"key_pk": key["publishable_key"], "period": period, "cap": cap},
                    api_key_pk=key["publishable_key"],
                )
                raise HTTPException(status_code=429, detail={"error": "quota_exceeded"})

    # Single-use: a token's nonce can be redeemed exactly once.
    if not await embed_service.mark_redeemed(redis, claims.get("nonce", ""), ttl=_TOKEN_TTL):
        raise HTTPException(status_code=409, detail={"error": "token_already_redeemed"})

    await db.increment_usage(key["publishable_key"], period)
    await db.touch_api_key(key["publishable_key"])

    return {
        "success": True,
        "human": bool(claims.get("human")),
        "band": claims.get("band"),
        "issued_at": claims.get("iat"),
        "hostname": claims.get("aud"),
    }


@router.post("/challenge")
async def captcha_challenge(body: dict, request: Request):
    """(Optional) Issue a single-use challenge_id bound to pk+origin, for sites
    that want the widget load itself gated. MVP widgets may skip this."""
    pk = str(body.get("publishable_key", ""))
    origin = _resolve_origin(request, body.get("origin"))
    await _validate_key_origin(request, pk, origin)
    nonce = secrets.token_urlsafe(32)
    await embed_service.store_nonce(_get_redis(request), nonce, pk, origin, ttl=300)
    return {"challenge_id": nonce, "expires_in": 300}


@router.get("/jwks")
async def captcha_jwks(request: Request):
    """Public keys for stateless local token verification (alias of embed jwks)."""
    return request.app.state.server_key.jwks()
