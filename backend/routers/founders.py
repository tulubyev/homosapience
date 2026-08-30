# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
Public founders roster.

GET /api/founders — admins + Gold members, grouped by person. Founders are
public by design (named, reputation-backed — unlike anonymous verified users),
so this endpoint is unauthenticated. It exposes only what they chose to make
public: name, role, avatar, vouches given, joined date, online status, and DIDs
truncated to the last 8 chars. No full DID, no PII beyond the public name.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("")
@router.get("/")
async def list_founders(request: Request):
    db = getattr(request.app.state, "db", None)
    if not db:
        return {"founders": [], "generated_at": int(time.time())}

    # Online = any live WebSocket presence: the Gold bond panel (full DIDs) or
    # general app/chat connections (keyed by did_hash[:16]). Covers admins too.
    ws = getattr(request.app.state, "ws_manager", None)
    panel = set(ws._panel_connections.keys()) if ws else set()
    conns = set(ws._connections.keys()) if ws else set()
    founders = await db.get_founders(online_gold_dids=panel, online_did_hashes=conns)
    return {"founders": founders, "generated_at": int(time.time())}
