# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""Shared request-auth helpers for the console/embed routers."""

from __future__ import annotations

import logging
import time
from threading import Lock

from fastapi import HTTPException, Request

# ── Variant-B phase 1: instrumentation of the legacy X-APTOGON-DID fallback ──
# We still accept the unsigned header in extract_did() for backward compat
# (console / embed / alerts / billing / data-access were never tightened —
# see docs/SECURITY-pairing-auth.md "Variant B planned cleanup"). Before we
# can flip the kill switch globally we need to KNOW who still calls through
# the legacy path. Phase 1 = counter + sampled log. Phase 2 = removal.
#
# Sampled logging keeps signal-to-noise high: we log the FIRST hit per
# (route, user-agent-prefix, did-tail-8) tuple, plus a per-tuple counter
# accessible via /api/admin/auth-fallback (added when needed). Reset on SW
# restart, which is fine — we just need a few days of data.

_log = logging.getLogger("aptogon.auth.fallback")
_fallback_counter: dict[tuple[str, str, str], int] = {}
_fallback_seen:    set[tuple[str, str, str]] = set()
_fallback_lock = Lock()


def _record_fallback(request: Request, did_tail: str) -> None:
    """Bookkeeping for legacy X-APTOGON-DID usage. Never raises."""
    try:
        path = getattr(getattr(request, "url", None), "path", "") or "?"
        ua   = request.headers.get("user-agent", "") or "?"
        ua_short = ua[:40]
        key = (path, ua_short, did_tail)
        with _fallback_lock:
            _fallback_counter[key] = _fallback_counter.get(key, 0) + 1
            new_tuple = key not in _fallback_seen
            if new_tuple:
                _fallback_seen.add(key)
        if new_tuple:
            _log.warning(
                "legacy X-APTOGON-DID fallback used: path=%s ua=%s did_tail=%s",
                path, ua_short, did_tail,
            )
    except Exception:
        pass


def get_fallback_usage() -> dict[str, int]:
    """Snapshot of legacy-header counters. Used by an admin debug endpoint
    when needed; safe to call from anywhere. Keys are 'path|ua|did_tail'."""
    with _fallback_lock:
        return {
            f"{path}|{ua}|{did_tail}": count
            for (path, ua, did_tail), count in _fallback_counter.items()
        }


def extract_did(request: Request) -> str:
    """DID from firewall state, Bearer JWT, or legacy X-APTOGON-DID header.

    NOTE: this helper is intentionally PERMISSIVE — it accepts the unsigned
    X-APTOGON-DID header for read-side endpoints that have not yet been
    migrated. For privilege-granting endpoints use extract_proven_did /
    require_proven_did, which reject that header (Variant A; commit a608f7f).
    """
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
    legacy = request.headers.get("X-APTOGON-DID", "").strip()
    if legacy:
        _record_fallback(request, legacy[-8:])
    return legacy


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


async def require_owner_did(request: Request) -> str:
    """Console/owner auth: admins always pass; non-admins need a valid credential.

    Admins are registered via ADMIN_DIDS in .env and may not have a row in
    human_credentials (they never go through gesture verification). Using
    require_verified_did on console endpoints therefore locked out all admins.
    """
    did = extract_did(request)
    if did:
        db = request.app.state.db
        if await db.is_admin_did(did[-8:]):
            return did
    return await require_verified_did(request)


def extract_proven_did(request: Request) -> str:
    """
    Strict-auth variant: returns a DID only if it was proven via cryptographic
    signature (Bearer JWT obtained from /api/auth/session, or firewall state set
    after equivalent verification). The legacy X-APTOGON-DID header is NOT
    accepted — that header carries an unsigned DID string and any attacker who
    knows the DID can forge it.

    CRITICAL: the AptogonFirewall middleware (middleware/firewall.py) promotes
    BOTH JWT and legacy X-APTOGON-DID into request.state.did, marking the
    source via request.state.auth_mode ∈ {"jwt", "legacy_did"}. We accept
    only "jwt" here. Trusting request.state.did blindly would let the legacy
    header sneak in unsigned — defeating the whole point of this helper.

    Use this on endpoints where the caller's claimed identity actually grants
    privilege over THIS DID's data (account aggregate, device unlink, pairing
    code creation in this DID's name).
    """
    did       = getattr(request.state, "did",       None)
    auth_mode = getattr(request.state, "auth_mode", None)
    if did and auth_mode == "jwt":
        return did
    # Fallback: direct Bearer parse (covers test client paths where the
    # firewall middleware is not installed). NEVER read X-APTOGON-DID here.
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            from routers.auth import decode_jwt
            payload = decode_jwt(auth[7:])
            if payload:
                return payload.get("did") or payload.get("sub") or ""
        except Exception:
            return ""
    return ""


async def require_proven_did(request: Request) -> str:
    """
    Like require_verified_did but rejects the unsigned X-APTOGON-DID fallback.
    Use on privileged endpoints (account aggregate, unlink, pairing /create).

    Security: prevents 'I know your DID → I am you' attacks. The caller must
    present a Bearer JWT that was issued by /api/auth/session after a real
    Ed25519 signature over a server-issued nonce.
    """
    did = extract_proven_did(request)
    if not did:
        raise HTTPException(status_code=401, detail={
            "error":   "bearer_jwt_required",
            "message": "This endpoint requires a Bearer JWT (signed-session). "
                       "The X-APTOGON-DID header is not accepted here.",
        })
    db = request.app.state.db
    cred = await db.get_credential(did)
    now = int(time.time())
    valid = (cred is not None and not cred.get("revoked", False)
             and int(cred.get("valid_until", 0)) > now)
    if not valid:
        raise HTTPException(status_code=403, detail={"error": "verified_human_required"})
    return did
