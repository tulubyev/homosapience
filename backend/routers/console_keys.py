# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/console/keys — organization API key management (admin-auth).

Behind the EMBED_API feature flag. The console UI (subsystem D) will later
wrap these same endpoints. Secret key is shown exactly once at creation.
"""

from __future__ import annotations

import os
import time as _time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from routers._auth_helpers import extract_did, require_verified_did
from services import feature_flags
from services.api_keys import generate_key_pair, hash_secret

router = APIRouter()

MAX_KEYS_PER_OWNER = int(os.getenv("MAX_KEYS_PER_OWNER", "5"))


async def _require_admin(request: Request) -> str:
    did = extract_did(request)
    if not did:
        raise HTTPException(status_code=403, detail="X-APTOGON-DID header required")
    db = request.app.state.db
    if not await db.is_admin_did(did[-8:]):
        raise HTTPException(status_code=403, detail={"error": "admin_required"})
    return did


async def _require_key_owner(request: Request) -> str:
    """Admin when self-serve is off; any verified human (owner-scoped) when on."""
    if feature_flags.feature_enabled("SELF_SERVE_KEYS"):
        return await require_verified_did(request)
    return await _require_admin(request)


class CreateKeyReq(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    allowed_origins: list[str] = Field(default_factory=list)


@router.post("/keys")
async def create_key(body: CreateKeyReq, request: Request):
    owner_did = await _require_key_owner(request)
    db = request.app.state.db
    if feature_flags.feature_enabled("SELF_SERVE_KEYS") and not await db.is_admin_did(owner_did[-8:]):
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
        safe.append({
            "id": r["id"],
            "publishable_key": r["publishable_key"],
            "name": r["name"],
            "allowed_origins": r["allowed_origins"],
            "active": r["active"],
            "created_at": r["created_at"],
            "last_used_at": r.get("last_used_at"),
            "usage_this_month": usage,
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
    owner_did = await require_verified_did(request)
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
    owner_did = await require_verified_did(request)
    if not feature_flags.feature_enabled("BENCHMARK_PAGE"):
        return {"available": False, "request": None}
    db = request.app.state.db
    req = await db.get_latest_data_request(owner_did)
    out: dict = {"available": True, "request": req}
    if req and req["status"] == "approved":
        from services import data_access
        out["package"] = await data_access.build_package(db, req["granted_level"] or "basic")
    return out
