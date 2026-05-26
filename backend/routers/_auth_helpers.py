# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""Shared request-auth helpers for the console/embed routers."""

from __future__ import annotations

import time

from fastapi import HTTPException, Request


def extract_did(request: Request) -> str:
    """DID from firewall state, Bearer JWT, or legacy X-APTOGON-DID header."""
    did = getattr(request.state, "did", None)
    if did:
        return did
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            from routers.auth import decode_jwt
            payload = decode_jwt(auth[7:])
            if payload:
                return payload.get("did") or payload.get("sub") or ""
        except Exception:
            pass
    return request.headers.get("X-APTOGON-DID", "").strip()


async def require_verified_did(request: Request) -> str:
    """Caller must hold a valid (non-expired, non-revoked) credential. Returns the DID."""
    did = extract_did(request)
    if not did:
        raise HTTPException(status_code=403, detail="X-APTOGON-DID header or Bearer token required")
    db = request.app.state.db
    cred = await db.get_credential(did)
    now = int(time.time())
    valid = (cred is not None and not cred.get("revoked", False)
             and int(cred.get("valid_until", 0)) > now)
    if not valid:
        raise HTTPException(status_code=403, detail={"error": "verified_human_required"})
    return did
