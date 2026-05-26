# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
APTOGON Firewall — двухрежимная аутентификация.

Режим 1 (приоритет): Authorization: Bearer <JWT>
  JWT выдаётся через /api/auth/session после Ed25519 подписи nonce.
  Это гарантирует, что вызывающий имеет приватный ключ DID.

Режим 2 (legacy): X-APTOGON-DID: did:key:z6Mk...
  Обратная совместимость. Не доказывает владение ключом —
  планируется к удалению после полного перехода всех клиентов.

Открытые пути (без проверки):
  /api/verify/*
  /api/health
  /api/auth/*       ← challenge и session endpoints
  /api/admin/me
  /api/admin/dids/public
  /api/admin/claim
  /api/pair/claim
  /api/pair/status
  /api/bond/gold-members
  /api/bond/candidates
  /api/chat/push
  /docs
"""

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from services.did_key import DIDKey

PUBLIC_PATHS = {"/", "/api/health", "/api/features", "/docs", "/openapi.json", "/redoc"}
PUBLIC_PREFIXES = (
    "/api/verify",
    "/api/auth",           # ← challenge + session (no auth required)
    "/api/chat",
    "/api/translate",
    "/api/admin/me",
    "/api/admin/dids/public",
    "/api/admin/claim",
    "/api/pair/claim",
    "/api/pair/status",
    "/api/bond/gold-members",
    "/api/bond/candidates",
    "/api/chat/push",
    "/api/risk/assess",    # ← R2: client submits signals pre-gesture (public)
    "/api/risk/stats",     # ← R2: public attack statistics page
    "/api/research/summary",  # ← R6.1: public benchmark summary (data-request stays auth'd)
    "/api/embed",          # ← R1: challenge/assert/jwks public; verify auth'd by sk
    "/uploads",
    "/ws",
)


def _decode_bearer(request: Request) -> str | None:
    """
    Attempt to decode Authorization: Bearer <JWT>.
    Returns the DID from the token payload, or None on any failure.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        # Import here to avoid circular at module load
        from routers.auth import decode_jwt
        payload = decode_jwt(token)
        if payload:
            return payload.get("did") or payload.get("sub")
    except Exception:
        pass
    return None


class AptogonFirewall(BaseHTTPMiddleware):

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Static files and public paths — no auth required
        if path in PUBLIC_PATHS or any(path.startswith(p) for p in PUBLIC_PREFIXES):
            return await call_next(request)

        # Only gate /api/ routes
        if not path.startswith("/api/"):
            return await call_next(request)

        # ── Mode 1: JWT Bearer token (preferred) ─────────────────────────────
        did_from_jwt = _decode_bearer(request)
        if did_from_jwt:
            request.state.did = did_from_jwt
            request.state.did_short = did_from_jwt[-12:]
            request.state.auth_mode = "jwt"
            return await call_next(request)

        # ── Mode 2: Legacy X-APTOGON-DID header ──────────────────────────────
        did_token = request.headers.get("X-APTOGON-DID", "").strip()

        if not did_token:
            return JSONResponse(status_code=403, content={
                "error":   "auth_required",
                "message": "Provide Authorization: Bearer <session_token> or X-APTOGON-DID header",
                "hint":    "Get a session token via POST /api/auth/session (Ed25519 signed challenge)",
                "verify_at": "/api/verify/expression",
            })

        # Format check
        if not did_token.startswith("did:key:z"):
            return JSONResponse(status_code=403, content={
                "error":   "invalid_did_format",
                "message": "DID must be did:key:z... format",
            })

        # Aptos credential check
        try:
            aptos = request.app.state.aptos
            is_human = await aptos.is_human(did_token)
            if not is_human:
                return JSONResponse(status_code=403, content={
                    "error":    "credential_invalid",
                    "message":  "Human credential not found or expired",
                    "verify_at": "/api/verify/expression",
                })
        except Exception:
            pass  # Aptos unavailable — allow through

        request.state.did = did_token
        request.state.did_short = did_token[-12:]
        request.state.auth_mode = "legacy_did"
        return await call_next(request)
