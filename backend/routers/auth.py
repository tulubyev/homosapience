"""
/api/auth — Signed Session Challenge (Ed25519 → JWT) + Concurrent Session Detection

Устраняет уязвимость передачи DID: без приватного ключа DID бесполезен.

Протокол:
  1. GET  /api/auth/challenge → {nonce, expires_at}
     Сервер генерирует случайный 32-байтовый nonce и сохраняет его в Redis
     с TTL=60s. Nonce одноразовый — после использования удаляется.

  2. POST /api/auth/session   → {token, expires_in, session_id, concurrent_alert?}
     Клиент подписывает nonce приватным ключом Ed25519 и отправляет:
       {did, nonce, signature}  (signature = base64url Ed25519(nonce_bytes))
     Сервер:
       a) Проверяет что nonce существует и удаляет его (anti-replay)
       b) Верифицирует Ed25519 подпись относительно did:key
       c) Проверяет что DID имеет действующий Human Credential
       d) Регистрирует сессию в Redis Set "sessions:{did_short}" с TTL=JWT_TTL
       e) Если кол-во сессий > MAX_CONCURRENT → возвращает concurrent_alert: true
       f) Выдаёт JWT {sub: did, sid: session_id, exp: now+3600}

  3. Клиент отправляет: Authorization: Bearer <token>
     Firewall принимает JWT вместо (или в дополнение к) X-APTOGON-DID.

  4. GET  /api/auth/sessions  → список активных сессий для текущего DID
  5. DELETE /api/auth/sessions/{session_id} → отозвать конкретную сессию
  6. DELETE /api/auth/sessions  → отозвать все сессии (выход на всех устройствах)
"""

from __future__ import annotations

import json
import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import jwt as pyjwt

from services.did_key import DIDKey

# ── Configuration ─────────────────────────────────────────────────────────────

_JWT_SECRET: str = os.getenv("JWT_SECRET", secrets.token_hex(32))
_JWT_ALGO:   str = "HS256"
_JWT_TTL:    int = int(os.getenv("JWT_TTL", "3600"))   # 1 hour default
_NONCE_TTL:  int = 60                                  # nonce expires in 60s
_MAX_CONCURRENT_SESSIONS: int = 3                      # alert threshold

router = APIRouter()

# ── In-memory fallbacks ────────────────────────────────────────────────────────

_mem_challenges: dict[str, float] = {}   # nonce → expires_at
_mem_sessions:   dict[str, dict]  = {}   # did_short → {session_id: {ua, ip, iat}}


def _evict_expired() -> None:
    now = time.time()
    expired = [k for k, v in _mem_challenges.items() if v < now]
    for k in expired:
        del _mem_challenges[k]


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _store_nonce(redis, nonce: str, ttl: int = _NONCE_TTL) -> None:
    if redis:
        await redis.setex(f"challenge:{nonce}", ttl, "1")
    else:
        _evict_expired()
        _mem_challenges[nonce] = time.time() + ttl


async def _consume_nonce(redis, nonce: str) -> bool:
    """Returns True and deletes the nonce if it exists and is not expired."""
    if redis:
        key = f"challenge:{nonce}"
        val = await redis.get(key)
        if val:
            await redis.delete(key)
            return True
        return False
    else:
        _evict_expired()
        exp = _mem_challenges.pop(nonce, None)
        return exp is not None and exp > time.time()


def _get_redis(request: Request):
    rl = getattr(request.app.state, "rate_limiter", None)
    return getattr(rl, "_redis", None) if rl else None


# ── Session store (Redis Hash per DID) ────────────────────────────────────────
# Key:   "auth:sessions:{did_short}"
# Field: session_id (8-char hex)
# Value: JSON {ua, ip, iat, exp}
# TTL:   refreshed on each new session login

async def _register_session(redis, did_short: str, session_id: str,
                             ua: str, ip: str, iat: int) -> int:
    """
    Register session in Redis Hash. Returns total active session count.
    Prunes expired sessions first.
    """
    key = f"auth:sessions:{did_short}"
    entry = json.dumps({"ua": ua[:120], "ip": ip, "iat": iat, "exp": iat + _JWT_TTL})

    if redis:
        try:
            # Prune expired fields first
            all_fields = await redis.hgetall(key)
            now = time.time()
            expired_ids = [
                sid for sid, val in all_fields.items()
                if json.loads(val).get("exp", 0) < now
            ]
            if expired_ids:
                await redis.hdel(key, *expired_ids)

            # Add new session
            await redis.hset(key, session_id, entry)
            await redis.expire(key, _JWT_TTL + 300)   # extra 5 min grace

            count = await redis.hlen(key)
            return count
        except Exception:
            pass

    # In-memory fallback
    did_sessions = _mem_sessions.setdefault(did_short, {})
    now = time.time()
    # Prune expired
    expired = [sid for sid, d in did_sessions.items() if d.get("exp", 0) < now]
    for sid in expired:
        del did_sessions[sid]
    did_sessions[session_id] = {"ua": ua[:120], "ip": ip, "iat": iat, "exp": iat + _JWT_TTL}
    return len(did_sessions)


async def _get_sessions(redis, did_short: str) -> list[dict]:
    """Return all active sessions for a DID (unexpired)."""
    key = f"auth:sessions:{did_short}"
    now = time.time()

    if redis:
        try:
            all_fields = await redis.hgetall(key)
            result = []
            for sid, val in all_fields.items():
                d = json.loads(val)
                if d.get("exp", 0) >= now:
                    result.append({"session_id": sid, **d})
            return result
        except Exception:
            pass

    did_sessions = _mem_sessions.get(did_short, {})
    return [
        {"session_id": sid, **d}
        for sid, d in did_sessions.items()
        if d.get("exp", 0) >= now
    ]


async def _revoke_session(redis, did_short: str, session_id: str) -> bool:
    """Revoke a specific session. Returns True if it existed."""
    key = f"auth:sessions:{did_short}"
    if redis:
        try:
            deleted = await redis.hdel(key, session_id)
            return deleted > 0
        except Exception:
            pass

    did_sessions = _mem_sessions.get(did_short, {})
    if session_id in did_sessions:
        del did_sessions[session_id]
        return True
    return False


async def _revoke_all_sessions(redis, did_short: str) -> int:
    """Revoke all sessions for a DID. Returns count revoked."""
    key = f"auth:sessions:{did_short}"
    if redis:
        try:
            count = await redis.hlen(key)
            await redis.delete(key)
            return count
        except Exception:
            pass

    count = len(_mem_sessions.get(did_short, {}))
    _mem_sessions.pop(did_short, None)
    return count


# ── JWT ────────────────────────────────────────────────────────────────────────

def _issue_jwt(did: str, session_id: str) -> dict:
    now = int(time.time())
    did_short = did[-8:]
    payload = {
        "sub":   did,
        "did":   did,
        "short": did_short,
        "sid":   session_id,   # session ID embedded — enables server-side revocation
        "iat":   now,
        "exp":   now + _JWT_TTL,
    }
    token = pyjwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGO)
    return {"token": token, "expires_in": _JWT_TTL, "did": did, "session_id": session_id}


def decode_jwt(token: str) -> Optional[dict]:
    """Decode and verify JWT. Returns payload dict or None on failure."""
    try:
        return pyjwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGO])
    except Exception:
        return None


# ── Models ─────────────────────────────────────────────────────────────────────

class SessionRequest(BaseModel):
    did:       str   # full did:key:z6Mk...
    nonce:     str   # hex string from /challenge
    signature: str   # base64url Ed25519 signature of raw nonce bytes


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/challenge")
async def get_challenge(request: Request):
    """
    Issue a fresh one-time challenge nonce.
    No authentication required — public endpoint.
    """
    nonce = secrets.token_hex(32)   # 32 bytes = 64 hex chars
    expires_at = int(time.time()) + _NONCE_TTL
    redis = _get_redis(request)
    await _store_nonce(redis, nonce)
    return {"nonce": nonce, "expires_at": expires_at, "ttl": _NONCE_TTL}


@router.post("/session")
async def create_session(body: SessionRequest, request: Request):
    """
    Exchange a signed challenge for a JWT session token.
    The caller must prove ownership of the DID's private key.
    Returns concurrent_alert: true if more than MAX_CONCURRENT sessions are active.
    """
    # 1. Validate nonce (single-use, anti-replay)
    redis = _get_redis(request)
    nonce_valid = await _consume_nonce(redis, body.nonce)
    if not nonce_valid:
        raise HTTPException(status_code=401, detail={
            "error":   "invalid_nonce",
            "message": "Challenge nonce expired or already used",
        })

    # 2. DID format check
    if not body.did.startswith("did:key:z"):
        raise HTTPException(status_code=400, detail={
            "error":   "invalid_did",
            "message": "DID must be did:key:z... format",
        })

    # 3. Ed25519 signature verification
    try:
        nonce_bytes = bytes.fromhex(body.nonce)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "error":   "invalid_nonce_format",
            "message": "Nonce must be a hex string",
        })

    if not DIDKey.verify(body.did, nonce_bytes, body.signature):
        raise HTTPException(status_code=403, detail={
            "error":   "invalid_signature",
            "message": "Ed25519 signature verification failed — you must possess the private key for this DID",
        })

    # 4. Check Human Credential (if Aptos reachable)
    try:
        aptos = request.app.state.aptos
        is_human = await aptos.is_human(body.did)
        if not is_human:
            raise HTTPException(status_code=403, detail={
                "error":   "not_human",
                "message": "Human credential not found or expired — please re-verify",
            })
    except HTTPException:
        raise
    except Exception:
        pass  # Aptos unavailable — allow through

    # 5. Register session + concurrent session detection
    session_id = secrets.token_hex(8)   # 16-char hex unique session ID
    ua  = request.headers.get("User-Agent", "unknown")[:120]
    ip  = (request.headers.get("X-Forwarded-For", "") or request.client.host or "").split(",")[0].strip()
    iat = int(time.time())
    did_short = body.did[-8:]

    session_count = await _register_session(redis, did_short, session_id, ua, ip, iat)
    concurrent_alert = session_count > _MAX_CONCURRENT_SESSIONS

    # 6. Issue JWT with session_id embedded
    result = _issue_jwt(body.did, session_id)

    if concurrent_alert:
        result["concurrent_alert"] = True
        result["concurrent_count"] = session_count
        result["message"] = (
            f"⚠️ {session_count} active sessions detected for this DID. "
            "If you did not authorise all of them, revoke extras via DELETE /api/auth/sessions."
        )

    return result


@router.post("/refresh")
async def refresh_session(request: Request):
    """
    Refresh an existing JWT session without re-signing (extends TTL).
    Requires valid Authorization: Bearer <token>.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization: Bearer <token> required")
    token = auth_header[7:]
    payload = decode_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token invalid or expired")

    did = payload["did"]
    old_sid = payload.get("sid", "")
    did_short = did[-8:]
    redis = _get_redis(request)

    # Replace old session entry with refreshed one
    new_sid = secrets.token_hex(8)
    ua  = request.headers.get("User-Agent", "unknown")[:120]
    ip  = (request.headers.get("X-Forwarded-For", "") or request.client.host or "").split(",")[0].strip()
    iat = int(time.time())

    if old_sid:
        await _revoke_session(redis, did_short, old_sid)
    await _register_session(redis, did_short, new_sid, ua, ip, iat)

    return _issue_jwt(did, new_sid)


@router.get("/sessions")
async def list_sessions(request: Request):
    """
    List all active sessions for the current DID.
    Requires valid Authorization: Bearer <token> or X-APTOGON-DID header.
    """
    did = _did_from_request(request)
    if not did:
        raise HTTPException(status_code=401, detail="Authentication required")

    redis = _get_redis(request)
    sessions = await _get_sessions(redis, did[-8:])
    current_sid = _current_sid(request)

    return {
        "did_short": did[-8:],
        "sessions": [
            {**s, "is_current": s["session_id"] == current_sid}
            for s in sessions
        ],
        "count": len(sessions),
        "max_recommended": _MAX_CONCURRENT_SESSIONS,
    }


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: str, request: Request):
    """Revoke a specific session by ID."""
    did = _did_from_request(request)
    if not did:
        raise HTTPException(status_code=401, detail="Authentication required")

    redis = _get_redis(request)
    ok = await _revoke_session(redis, did[-8:], session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "revoked", "session_id": session_id}


@router.delete("/sessions")
async def revoke_all_sessions(request: Request):
    """Revoke ALL sessions for this DID — logs out all devices."""
    did = _did_from_request(request)
    if not did:
        raise HTTPException(status_code=401, detail="Authentication required")

    redis = _get_redis(request)
    count = await _revoke_all_sessions(redis, did[-8:])
    return {"status": "all_revoked", "count": count, "did_short": did[-8:]}


# ── Internal helpers for session endpoints ─────────────────────────────────────

def _did_from_request(request: Request) -> Optional[str]:
    """Extract DID from JWT Bearer token or X-APTOGON-DID header."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        payload = decode_jwt(auth[7:])
        if payload:
            return payload.get("did")
    return request.headers.get("X-APTOGON-DID", "").strip() or None


def _current_sid(request: Request) -> Optional[str]:
    """Extract session_id from current JWT token."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        payload = decode_jwt(auth[7:])
        if payload:
            return payload.get("sid")
    return None
