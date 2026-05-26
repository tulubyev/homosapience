# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/research — R6.1 public benchmark summary.

GET /api/research/summary?days=90 → live attack-stats totals for the /research
page. Behind the BENCHMARK_PAGE feature flag (returns available:false when off).
Reuses db.get_attack_stats (same aggregate the /stats page uses). No auth.
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from routers._auth_helpers import require_verified_did
from services.feature_flags import feature_enabled

router = APIRouter()


@router.get("/summary")
async def research_summary(request: Request, days: int = 90):
    if not feature_enabled("BENCHMARK_PAGE"):
        return {"available": False}
    db = getattr(request.app.state, "db", None)
    if not db:
        return {"available": False}
    totals = await db.get_attack_stats(days=days)
    return {
        "available": True,
        "period_days": days,
        "totals": totals,
        "generated_at": int(time.time()),
    }


class DataRequestBody(BaseModel):
    name: str
    company: str
    email: str
    phone: Optional[str] = None


@router.post("/data-request")
async def submit_data_request(body: DataRequestBody, request: Request):
    """R6.3: a verified human requests access to our statistical data."""
    if not feature_enabled("BENCHMARK_PAGE"):
        raise HTTPException(status_code=404, detail={"error": "not_available"})
    did = await require_verified_did(request)
    name, company, email = body.name.strip(), body.company.strip(), body.email.strip()
    if not (name and company and email):
        raise HTTPException(status_code=400, detail={"error": "invalid_fields"})
    db = request.app.state.db
    from services import data_access
    cred = await db.get_credential(did) or {}
    suggested = data_access.classify_level(cred)
    await db.create_data_request(did=did, name=name, company=company, email=email,
                                 phone=(body.phone or None), suggested_level=suggested)
    return {"status": "pending", "suggested_level": suggested}
