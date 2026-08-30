# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/agent — Human-Delegated Agent Authentication (HDAA / Agent Passport)

A verified human can issue delegation tokens to AI agents, allowing third-party
sites to verify that the agent acts on behalf of a trust-scored human.

POST   /api/agent/delegate  — create a delegation token (JWT auth required)
GET    /api/agent/list      — list caller's delegations (JWT auth required)
DELETE /api/agent/{id}      — revoke a delegation (JWT auth required)
GET    /api/agent/verify    — verify a token (public, no auth)

Privacy: GET /api/agent/verify intentionally omits human_did from the response.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import jwt as pyjwt
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, field_validator

from routers._auth_helpers import require_proven_did

router = APIRouter()

# ── Signing key (HS256 shared with session JWTs) ───────────────────────────────
# We read JWT_SECRET at import time so all delegation sign/verify operations in
# this process use the same key. The fallback random token is consistent within
# the process lifetime (important for tests that don't set JWT_SECRET).
_JWT_SECRET = os.getenv("JWT_SECRET") or secrets.token_hex(32)
_JWT_ALGO   = "HS256"

# Default delegation lifetime: 30 days
_DEFAULT_TTL = 30 * 86_400

# Maximum permissions vocabulary
_VALID_PERMISSIONS = {"read", "search", "write", "admin"}


def _sign(payload: dict) -> str:
    return pyjwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGO)  # nosemgrep


def _verify_token(token: str) -> Optional[dict]:
    """Decode and verify delegation JWT. Returns payload or None."""
    try:
        return pyjwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGO])
    except Exception:
        return None


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── Request / Response models ─────────────────────────────────────────────────

class DelegateBody(BaseModel):
    agent_id:   str
    agent_name: Optional[str] = None
    permissions: list[str] = ["read"]
    expires_in: int = _DEFAULT_TTL  # seconds from now

    @field_validator("agent_id")
    @classmethod
    def _agent_id_ok(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 128:
            raise ValueError("agent_id must be 1–128 chars")
        return v

    @field_validator("permissions")
    @classmethod
    def _perms_ok(cls, v: list[str]) -> list[str]:
        v = [p.strip().lower() for p in v]
        invalid = set(v) - _VALID_PERMISSIONS
        if invalid:
            raise ValueError(f"unknown permissions: {invalid}")
        if not v:
            raise ValueError("permissions cannot be empty")
        return v

    @field_validator("expires_in")
    @classmethod
    def _ttl_ok(cls, v: int) -> int:
        if v < 60 or v > 365 * 86_400:
            raise ValueError("expires_in must be 60s – 365 days")
        return v


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/delegate")
async def delegate(body: DelegateBody, request: Request):
    """
    Issue a delegation token for an AI agent.
    The token carries the caller's trust_score/label so third-party sites can
    trust the agent without storing any PII about the human.
    """
    did = await require_proven_did(request)
    db  = request.app.state.db

    cred = await db.get_credential(did)
    if not cred:
        raise HTTPException(status_code=403, detail={"error": "verified_human_required"})

    now            = int(time.time())
    delegation_id  = str(uuid.uuid4())
    issued_at      = now
    expires_at     = now + body.expires_in

    # human_did is stored in the DB (not in the JWT) — keeping it out of the
    # token payload means anyone who decodes the JWT sees only trust metadata,
    # not the identifier. DB lookup via delegation_id resolves the human record.
    payload = {
        "type":               "AgentDelegation",
        "version":            "1",
        "delegation_id":      delegation_id,
        "human_trust_score":  float(cred.get("trust_score", 0.1)),
        "human_trust_label":  cred.get("trust_label", "newcomer"),
        "agent_id":           body.agent_id,
        "permissions":        body.permissions,
        "issued_at":          issued_at,
        "expires_at":         expires_at,
        "iat":                issued_at,
        "exp":                expires_at,
    }
    token      = _sign(payload)
    token_hash = _hash_token(token)

    await db.create_agent_delegation(
        delegation_id=delegation_id,
        human_did=did,
        agent_id=body.agent_id,
        agent_name=body.agent_name,
        permissions=body.permissions,
        token_hash=token_hash,
        issued_at=issued_at,
        expires_at=expires_at,
    )

    return {
        "delegation_id": delegation_id,
        "token":         token,
        "expires_at":    expires_at,
        "agent_id":      body.agent_id,
        "permissions":   body.permissions,
    }


@router.get("/list")
async def list_delegations(request: Request):
    """Return all delegations issued by the calling human (including revoked)."""
    did  = await require_proven_did(request)
    db   = request.app.state.db
    rows = await db.list_delegations(did)
    return {"delegations": rows, "count": len(rows)}


@router.delete("/{delegation_id}")
async def revoke_delegation(delegation_id: str, request: Request):
    """Revoke a delegation by id. Only the issuing human can revoke."""
    did = await require_proven_did(request)
    db  = request.app.state.db
    ok  = await db.revoke_delegation(delegation_id, did)
    if not ok:
        raise HTTPException(status_code=404, detail={
            "error":   "not_found",
            "message": "Delegation not found, already revoked, or not yours.",
        })
    return {"status": "revoked", "delegation_id": delegation_id}


@router.get("/verify")
async def verify_agent(request: Request, token: str = Query(..., description="Delegation JWT")):
    """
    Verify an agent delegation token.
    Public endpoint — no authentication required.
    Returns trust info WITHOUT exposing human_did (privacy layer).
    """
    db = request.app.state.db

    # Decode and verify JWT signature + expiry
    payload = _verify_token(token)
    if not payload:
        raise HTTPException(status_code=403, detail={"valid": False, "reason": "invalid_signature"})

    if payload.get("type") != "AgentDelegation":
        raise HTTPException(status_code=403, detail={"valid": False, "reason": "wrong_token_type"})

    now = int(time.time())
    if payload.get("expires_at", 0) < now:
        raise HTTPException(status_code=403, detail={"valid": False, "reason": "expired"})

    # DB lookup — checks revocation and gets authoritative expiry
    token_hash = _hash_token(token)
    delegation = await db.get_delegation_by_token_hash(token_hash)
    if not delegation:
        raise HTTPException(status_code=403, detail={"valid": False, "reason": "not_found"})

    if delegation.get("revoked"):
        raise HTTPException(status_code=403, detail={"valid": False, "reason": "revoked"})

    if delegation.get("expires_at", 0) < now:
        raise HTTPException(status_code=403, detail={"valid": False, "reason": "expired"})

    # Record the use asynchronously (best-effort)
    await db.record_delegation_use(delegation["id"])

    expires_iso = datetime.fromtimestamp(delegation["expires_at"], tz=timezone.utc).isoformat()

    return {
        "valid":               True,
        "human_trust_score":   payload.get("human_trust_score"),
        "human_trust_label":   payload.get("human_trust_label"),
        "agent_id":            payload.get("agent_id"),
        "permissions":         payload.get("permissions"),
        "expires_at":          expires_iso,
    }
