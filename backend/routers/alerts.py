# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
R1-D4 alerts endpoints.

console_router → registered at /api/console (org-owner, require_verified_did)
admin_router   → registered at /api/admin   (system admin, _require_admin)
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from routers._auth_helpers import require_verified_did, extract_did

console_router = APIRouter()
admin_router   = APIRouter()


# ── Shared helper (duplicated to avoid circular import) ───────────────────────

async def _require_admin(request: Request) -> str:
    did = extract_did(request)
    if not did:
        raise HTTPException(status_code=403, detail="X-APTOGON-DID header required")
    db = request.app.state.db
    if not await db.is_admin_did(did[-8:]):
        raise HTTPException(status_code=403, detail={"error": "admin_required"})
    return did


# ── Pydantic models ───────────────────────────────────────────────────────────

class EscalateReq(BaseModel):
    comment: str


# ── Console endpoints (org-owner) ─────────────────────────────────────────────

@console_router.get("/alerts")
async def list_alerts(
    request: Request,
    status: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
):
    owner = await require_verified_did(request)
    db = request.app.state.db
    rows = await db.list_alerts(owner, status=status, limit=limit)
    return {"alerts": rows, "count": len(rows)}


@console_router.get("/alerts/unread")
async def count_unread(request: Request):
    owner = await require_verified_did(request)
    db = request.app.state.db
    count = await db.count_unread_alerts(owner)
    return {"count": count}


@console_router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: int, request: Request):
    owner = await require_verified_did(request)
    db = request.app.state.db
    ok = await db.update_alert_status(alert_id, owner, "acknowledged")
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"ok": True}


@console_router.post("/alerts/{alert_id}/escalate")
async def escalate_alert(alert_id: int, body: EscalateReq, request: Request):
    owner = await require_verified_did(request)
    db = request.app.state.db
    ok = await db.escalate_alert(alert_id, owner, body.comment)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"ok": True}


@console_router.post("/alerts/{alert_id}/freeze-key")
async def freeze_key_alert(alert_id: int, request: Request):
    owner = await require_verified_did(request)
    db = request.app.state.db
    alert = await db.get_alert(alert_id, owner)
    if not alert:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    if alert.get("api_key_pk"):
        await db.deactivate_key_by_pk(alert["api_key_pk"])
    await db.update_alert_status(alert_id, owner, "resolved", resolved_by=owner)
    return {"ok": True}


# ── Admin endpoints ───────────────────────────────────────────────────────────

@admin_router.get("/alerts")
async def admin_list_alerts(
    request: Request,
    level: Optional[int]  = Query(None),
    severity: Optional[str] = Query(None),
    status: Optional[str]   = Query(None),
    owner_did: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    await _require_admin(request)
    db = request.app.state.db
    rows = await db.list_all_alerts(
        level=level, severity=severity, status=status,
        owner_did_filter=owner_did, limit=limit,
    )
    return {"alerts": rows, "count": len(rows)}


@admin_router.post("/alerts/{alert_id}/resolve")
async def admin_resolve_alert(alert_id: int, request: Request):
    resolver_did = await _require_admin(request)
    db = request.app.state.db
    ok = await db.update_alert_status_admin(alert_id, "resolved", resolved_by=resolver_did)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"ok": True}
