# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/console/domains — R1-D1 domain-ownership verification (verified-DID auth).

Behind the EMBED_API feature flag. The console UI (D2/D3) consumes these.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel

from routers._auth_helpers import require_verified_did
from services import domain_verify

router = APIRouter()


class CreateDomainReq(BaseModel):
    origin: str


class VerifyDomainReq(BaseModel):
    method: Optional[str] = None


def _methods_block(origin: str, token: str) -> dict:
    return {
        "dns_txt": {
            "name": domain_verify.dns_record_name(origin),
            "value": domain_verify.dns_record_value(token),
        },
        "well_known": {
            "url": domain_verify.well_known_url(origin),
            "content": domain_verify.proof_string(token),
        },
    }


@router.post("/domains")
async def create_domain(body: CreateDomainReq, request: Request):
    owner = await require_verified_did(request)
    origin = domain_verify.normalize_origin(body.origin)
    if not origin:
        raise HTTPException(status_code=400, detail={"error": "invalid_origin"})
    db = request.app.state.db
    # Return existing record if one already exists for this owner+origin
    existing = await db.get_domain_verification_by_origin(owner, origin)
    if existing:
        token = existing["token"]
        return {
            "id": existing["id"], "origin": origin, "status": existing["status"],
            "token": token, "recommended": "dns_txt",
            "methods": _methods_block(origin, token),
        }
    token = domain_verify.generate_token()
    row = await db.create_domain_verification(owner, origin, token)
    return {
        "id": row["id"], "origin": origin, "status": row["status"], "token": token,
        "recommended": "dns_txt", "methods": _methods_block(origin, token),
    }


@router.post("/domains/{vid}/verify")
async def verify_domain(vid: int, request: Request,
                        body: VerifyDomainReq = Body(default_factory=VerifyDomainReq)):
    owner = await require_verified_did(request)
    db = request.app.state.db
    row = await db.get_domain_verification(vid, owner)
    if not row:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    method = await domain_verify.verify_origin(row["origin"], row["token"], body.method)
    if method:
        await db.mark_domain_verified(vid, method)
        return {"id": vid, "origin": row["origin"], "status": "verified", "method": method}
    await db.mark_domain_failed(vid)
    return {"id": vid, "origin": row["origin"], "status": "failed"}


@router.delete("/domains/{vid}")
async def delete_domain(vid: int, request: Request):
    """Owner-scoped removal of a domain verification (e.g. expired/unused domain)."""
    owner = await require_verified_did(request)
    db = request.app.state.db
    deleted = await db.delete_domain_verification(vid, owner)
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"id": vid, "deleted": True}


@router.get("/domains")
async def list_domains(request: Request):
    owner = await require_verified_did(request)
    db = request.app.state.db
    rows = await db.list_domain_verifications(owner)
    result = []
    for r in rows:
        item = {
            "id": r["id"],
            "origin": r["origin"],
            "status": r["status"],
            "method": r.get("method"),
            "created_at": r["created_at"],
            "verified_at": r.get("verified_at"),
        }
        if r["status"] != "verified":
            item["token"] = r["token"]
            item["methods"] = _methods_block(r["origin"], r["token"])
        result.append(item)
    return {"domains": result}
