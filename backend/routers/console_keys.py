# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/console/keys — organization API key management (admin-auth).

Behind the EMBED_API feature flag. The console UI (subsystem D) will later
wrap these same endpoints. Secret key is shown exactly once at creation.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import time as _time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from routers._auth_helpers import extract_did, require_owner_did
from services import email_service, feature_flags
from services.api_keys import generate_key_pair, hash_secret

router = APIRouter()

MAX_KEYS_PER_OWNER = int(os.getenv("MAX_KEYS_PER_OWNER", "5"))
EMAIL_TOKEN_TTL = 24 * 3600  # magic-link validity
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _public_base(request: Request) -> str:
    """Origin for links we email + redirect back to. PUBLIC_BASE_URL wins; else the
    request's own scheme+host."""
    env = os.getenv("PUBLIC_BASE_URL")
    if env:
        return env.rstrip("/")
    return str(request.base_url).rstrip("/")


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _require_admin(request: Request) -> str:
    did = extract_did(request)
    if not did:
        raise HTTPException(status_code=403, detail="X-APTOGON-DID header required")
    db = request.app.state.db
    if not await db.is_admin_did(did[-8:]):
        raise HTTPException(status_code=403, detail={"error": "admin_required"})
    return did


async def _require_key_owner(request: Request) -> str:
    """Admin always passes (via require_owner_did); non-admins need SELF_SERVE_KEYS +
    credential, and must not be suspended."""
    if feature_flags.feature_enabled("SELF_SERVE_KEYS"):
        did = await require_owner_did(request)
        db = request.app.state.db
        if not await db.is_admin_did(did[-8:]) and await db.is_owner_suspended(did):
            raise HTTPException(status_code=403, detail={"error": "account_suspended"})
        return did
    return await _require_admin(request)


class CreateKeyReq(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    allowed_origins: list[str] = Field(default_factory=list)


@router.post("/keys")
async def create_key(body: CreateKeyReq, request: Request):
    owner_did = await _require_key_owner(request)
    db = request.app.state.db
    if feature_flags.feature_enabled("SELF_SERVE_KEYS") and not await db.is_admin_did(owner_did[-8:]):
        # Two-level trust: the DID proves a human; a verified email proves a real,
        # contactable person before we hand out keys.
        if not await db.is_owner_email_verified(owner_did):
            raise HTTPException(status_code=409, detail={"error": "email_verification_required"})
        if await db.count_active_api_keys(owner_did) >= MAX_KEYS_PER_OWNER:
            raise HTTPException(status_code=403, detail={"error": "key_limit_reached"})
    pk, sk = generate_key_pair()
    await db.create_api_key(
        publishable_key=pk,
        secret_hash=hash_secret(sk),
        owner_did=owner_did,
        name=body.name,
        allowed_origins=body.allowed_origins,
    )
    # secret_key returned ONCE — never stored, never shown again
    return {"publishable_key": pk, "secret_key": sk, "name": body.name,
            "allowed_origins": body.allowed_origins}


# ── Self-serve owner account: email verification (magic-link) ──────────────────

class RegisterEmailReq(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)


@router.get("/account")
async def get_account(request: Request):
    """The owner's email + verification status (for the console). `email_required`
    tells the UI to force the email step first: true only for a non-admin whose
    email is unverified while self-serve is on (admins bypass the gate)."""
    did = await require_owner_did(request)
    db = request.app.state.db
    acct = await db.get_owner_account(did)
    verified = bool(acct and acct["email_verified"])
    is_admin = await db.is_admin_did(did[-8:])
    email_required = (feature_flags.feature_enabled("SELF_SERVE_KEYS")
                      and not is_admin and not verified)
    return {
        "email": acct["email"] if acct else None,
        "email_verified": verified,
        "email_required": email_required,
        "suspended": bool(acct and acct.get("suspended")),
        "suspended_reason": acct.get("suspended_reason") if acct else None,
    }


@router.post("/account/register")
async def register_email(body: RegisterEmailReq, request: Request):
    """Bind an email to the caller's DID and send a magic-link to confirm it. Always
    responds the same way for a well-formed address (no account enumeration)."""
    did = await require_owner_did(request)
    db = request.app.state.db
    email = body.email.strip()
    if not _EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=400, detail={"error": "invalid_email"})
    if await db.email_taken_by_other(email, did):
        raise HTTPException(status_code=409, detail={"error": "email_taken"})

    raw = secrets.token_urlsafe(32)
    now = int(_time.time())
    await db.upsert_owner_email(did, email, _hash_token(raw), now + EMAIL_TOKEN_TTL, now)
    link = f"{_public_base(request)}/api/console/account/verify?token={raw}"
    sent = email_service.send_verification(email, link)
    # `sent` is False when SMTP is unconfigured (dev): the link is in the server log.
    return {"ok": True, "email": email, "sent": sent}


@router.get("/account/verify")
async def verify_email(token: str, request: Request):
    """Magic-link target (opened from the email, so NO DID auth — the token itself is
    the proof). Redirects back into the console with the result."""
    db = request.app.state.db
    did = await db.verify_owner_email(_hash_token(token), int(_time.time()))
    ok = did is not None
    dest = f"{_public_base(request)}/console?email_verified={'1' if ok else '0'}"
    return RedirectResponse(dest, status_code=302)


@router.get("/keys")
async def list_keys(request: Request):
    owner_did = await _require_key_owner(request)
    db = request.app.state.db
    rows = await db.list_api_keys(owner_did)
    period = _time.strftime("%Y-%m", _time.gmtime())
    cap = int(os.getenv("FREE_VERIFY_CAP", "1000"))
    safe = []
    for r in rows:
        usage = await db.get_usage(r["publishable_key"], period)
        gestures = await db.get_gesture_count(r["publishable_key"], period)
        safe.append({
            "id": r["id"],
            "publishable_key": r["publishable_key"],
            "name": r["name"],
            "allowed_origins": r["allowed_origins"],
            "active": r["active"],
            "created_at": r["created_at"],
            "last_used_at": r.get("last_used_at"),
            "usage_this_month": usage,          # billed: server-side /siteverify
            "gestures_this_month": gestures,    # attempts: gestures drawn (GBM data)
            "monthly_cap": cap,
        })
    return {"keys": safe}


@router.delete("/keys/{key_id}")
async def delete_key(key_id: int, request: Request):
    owner_did = await _require_key_owner(request)
    db = request.app.state.db
    ok = await db.deactivate_api_key(key_id, owner_did)
    if not ok:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"deactivated": True}


@router.post("/keys/{key_id}/reactivate")
async def reactivate_key(key_id: int, request: Request):
    owner_did = await _require_key_owner(request)
    db = request.app.state.db
    if feature_flags.feature_enabled("SELF_SERVE_KEYS") and not await db.is_admin_did(owner_did[-8:]):
        if await db.count_active_api_keys(owner_did) >= MAX_KEYS_PER_OWNER:
            raise HTTPException(status_code=403, detail={"error": "key_limit_reached"})
    ok = await db.reactivate_api_key(key_id, owner_did)
    if not ok:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"reactivated": True}


@router.get("/plan")
async def get_plan(request: Request):
    """Owner's current plan + pooled monthly usage (for the console)."""
    owner_did = await require_owner_did(request)
    db = request.app.state.db
    from services import billing
    period = _time.strftime("%Y-%m", _time.gmtime())
    plan = await db.get_owner_plan(owner_did)
    used = await db.get_owner_usage(owner_did, period)
    return {
        "plan": plan,
        "label": billing.plan_label(plan),
        "monthly_cap": billing.plan_cap(plan),   # None = unlimited
        "used_this_month": used,
    }


@router.get("/data-access")
async def get_data_access(request: Request):
    """R6.3: requester's latest data-access request + approved package."""
    owner_did = await require_owner_did(request)
    if not feature_flags.feature_enabled("BENCHMARK_PAGE"):
        return {"available": False, "request": None}
    db = request.app.state.db
    req = await db.get_latest_data_request(owner_did)
    out: dict = {"available": True, "request": req}
    if req and req["status"] == "approved":
        from services import data_access
        out["package"] = await data_access.build_package(db, req["granted_level"] or "basic")
    return out
