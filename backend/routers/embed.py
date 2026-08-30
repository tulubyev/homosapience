# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/embed — R1 org-facing verification protocol.

challenge → assert → verify (S2S, billable) + jwks.
Behind the EMBED_API feature flag (router registered only when enabled).
"""

from __future__ import annotations

import secrets
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.did_key import DIDKey, did_hash
from services import embed_service
from services import alert_service as _alert_svc

router = APIRouter()

_ISS = "https://homosapience.org"
_VERIFY_URL = "https://homosapience.org/verify"
_NONCE_TTL = 300
_TOKEN_TTL = 300


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")


def _get_redis(request: Request):
    rl = getattr(request.app.state, "rate_limiter", None)
    return getattr(rl, "_redis", None) if rl else None


def _resolve_origin(request: Request, body_origin: Optional[str]) -> str:
    """
    Body origin is authoritative (the popup signer asserts on behalf of the
    customer origin from its URL, while its own Origin header is homosapience.org).
    Fall back to the Origin header only when the body omits it. Security comes
    from origin ∈ allowed_origins(pk) + the sk-authenticated /verify, not the header.
    """
    return (body_origin or "").strip() or request.headers.get("Origin", "")


# ── Models ──────────────────────────────────────────────────────────────────────

class ChallengeReq(BaseModel):
    publishable_key: str
    origin: Optional[str] = None


class AssertReq(BaseModel):
    publishable_key: str
    nonce: str
    did: str
    signature: str


class VerifyReq(BaseModel):
    token: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/challenge")
async def challenge(body: ChallengeReq, request: Request):
    db = request.app.state.db
    key = await db.get_api_key_by_pk(body.publishable_key)
    if not key or not key["active"]:
        raise HTTPException(status_code=403, detail={"error": "invalid_key"})
    origin = _resolve_origin(request, body.origin)
    if origin not in key["allowed_origins"]:
        await _alert_svc.record_alert(
            db=request.app.state.db,
            owner_did=key["owner_did"],
            event_type="unknown_origin",
            level=1,
            severity="info",
            detail={"origin": origin},
            api_key_pk=body.publishable_key,
        )
        raise HTTPException(status_code=403, detail={
            "error": "origin_not_allowed",
            "message": f"Origin '{origin}' is not in allowed_origins for this key",
        })
    # R1-D1: domain-ownership enforcement (flag-gated; admin-owned keys bypass)
    from services.feature_flags import feature_enabled
    if feature_enabled("REQUIRE_DOMAIN_VERIFICATION") or feature_enabled("SELF_SERVE_KEYS"):
        from services import domain_verify
        owner = key["owner_did"]
        is_admin = await db.is_admin_did(owner[-8:])
        # Verified origins are stored normalized; normalize the request origin to match.
        check_origin = domain_verify.normalize_origin(origin) or origin
        if not is_admin and not await db.is_origin_verified(owner, check_origin):
            raise HTTPException(status_code=403, detail={
                "error": "origin_not_verified",
                "message": f"Origin '{origin}' is not domain-verified for this key's owner.",
            })
    # R1-D4: IP rate-limit check (fire alert before raising).
    # Gated behind FEATURE_ALERTS so the /challenge flow is byte-for-byte
    # identical to pre-D4 when the flag is off (no new throttle introduced).
    rl = getattr(request.app.state, "rate_limiter", None)
    if feature_enabled("ALERTS") and rl:
        ip = _client_ip(request)
        # Use a dedicated challenge bucket so /challenge traffic does not
        # consume the shared verify:hourly counter used by /verify and /risk.
        allowed, _ = await rl.check_challenge_ip(ip)
        if not allowed:
            owner_did = key["owner_did"]
            await _alert_svc.record_alert(
                db=request.app.state.db,
                owner_did=owner_did,
                event_type="rate_limit_hit",
                level=1,
                severity="info",
                detail={"ip_hash": __import__("hashlib").sha256(ip.encode()).hexdigest()[:16],
                        "origin": origin},
                api_key_pk=body.publishable_key,
            )
            raise HTTPException(status_code=429, detail={"error": "rate_limit_hit"})

    nonce = secrets.token_urlsafe(32)
    await embed_service.store_nonce(_get_redis(request), nonce,
                                    body.publishable_key, origin, ttl=_NONCE_TTL)
    return {"nonce": nonce, "expires_in": _NONCE_TTL}


@router.post("/assert")
async def assert_human(body: AssertReq, request: Request):
    db = request.app.state.db
    redis = _get_redis(request)

    data = await embed_service.consume_nonce(redis, body.nonce)
    if not data or data.get("pk") != body.publishable_key:
        raise HTTPException(status_code=400, detail={"error": "invalid_or_used_nonce"})
    origin = data["origin"]

    if not body.did.startswith("did:key:z"):
        raise HTTPException(status_code=400, detail={"error": "invalid_did"})

    # Verify the user controls the DID key (signature over canonical message)
    msg = embed_service.assert_message(body.nonce, origin, body.did)
    if not DIDKey.verify(body.did, msg, body.signature):
        raise HTTPException(status_code=401, detail={"error": "invalid_signature"})

    # The DID must already have a valid, non-expired, non-revoked credential
    cred = await db.get_credential(body.did)
    now = int(time.time())
    valid = (
        cred is not None
        and not cred.get("revoked", False)
        and int(cred.get("valid_until", 0)) > now
    )
    if not valid:
        return {"needs_verification": True, "verify_url": _VERIFY_URL}

    # R1-D4: check behavior status — alert if suspect/blocked DID uses an org key
    behavior = getattr(request.app.state, "behavior", None)
    if behavior:
        beh = await behavior.get_status(body.did[-8:])
        if beh.get("level") in ("suspect", "blocked"):
            owner_did = await request.app.state.db.get_key_owner(body.publishable_key)
            if owner_did:
                await _alert_svc.record_alert(
                    db=request.app.state.db,
                    owner_did=owner_did,
                    event_type="blocked_did",
                    level=2,
                    severity="warning",
                    detail={
                        "did_short": body.did[-8:],
                        "reason": beh.get("level", ""),
                        "request_origin": data.get("origin", ""),
                    },
                    api_key_pk=body.publishable_key,
                )
            # R1-D4: cascade tracker
            ip = _client_ip(request)
            ip_hash = __import__("hashlib").sha256(ip.encode()).hexdigest()[:16]
            await behavior.record_key_suspect(
                did_short=body.did[-8:],
                api_key_pk=body.publishable_key,
                ip_hash=ip_hash,
                db=request.app.state.db,
            )
            if beh.get("level") == "blocked":
                raise HTTPException(status_code=403, detail={"error": "did_blocked"})

    band = embed_service.trust_band(float(cred.get("trust_score", 0.1)))
    claims = {
        "iss": _ISS,
        "aud": origin,
        "sub": did_hash(body.did),
        "nonce": body.nonce,
        "trust_band": band,
        "iat": now,
        "exp": now + _TOKEN_TTL,
    }
    token = request.app.state.server_key.sign_jwt(claims)
    return {"token": token, "trust_band": band}


@router.post("/verify")
async def verify_token(body: VerifyReq, request: Request):
    db = request.app.state.db
    redis = _get_redis(request)

    # S2S auth: Authorization: Bearer sk_live_…
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"error": "missing_secret_key"})
    sk = auth[7:].strip()

    from services.api_keys import hash_secret
    key = await db.get_api_key_by_secret_hash(hash_secret(sk))
    if not key or not key["active"]:
        raise HTTPException(status_code=401, detail={"error": "invalid_secret_key"})

    claims = request.app.state.server_key.verify_jwt(body.token)
    if not claims:
        raise HTTPException(status_code=400, detail={"error": "invalid_token"})

    if claims.get("aud") not in key["allowed_origins"]:
        raise HTTPException(status_code=403, detail={"error": "audience_mismatch"})

    # R1-D2 / R1-E: monthly quota enforcement (admin-owned keys exempt)
    import os
    period = time.strftime("%Y-%m", time.gmtime())
    owner_did = key["owner_did"]
    if not await db.is_admin_did(owner_did[-8:]):
        from services.feature_flags import feature_enabled
        if feature_enabled("BILLING"):
            from services import billing
            plan = await db.get_owner_plan(owner_did)
            cap = billing.plan_cap(plan)
            if cap is not None:                                  # None = unlimited
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

    # Anti double-spend: a token's nonce can only be redeemed once
    if not await embed_service.mark_redeemed(redis, claims.get("nonce", ""), ttl=_TOKEN_TTL):
        raise HTTPException(status_code=409, detail={"error": "token_already_redeemed"})

    # Billable event
    await db.increment_usage(key["publishable_key"], period)
    await db.touch_api_key(key["publishable_key"])

    # R1-D4: usage spike detection
    behavior = getattr(request.app.state, "behavior", None)
    if behavior:
        await behavior.check_usage_spike(
            api_key_pk=key["publishable_key"],
            owner_did=key["owner_did"],
            db=request.app.state.db,
        )

    return {
        "human": True,
        "did_hash": claims.get("sub"),
        "trust_band": claims.get("trust_band"),
        "issued_at": claims.get("iat"),
    }


@router.get("/jwks")
async def jwks(request: Request):
    return request.app.state.server_key.jwks()
