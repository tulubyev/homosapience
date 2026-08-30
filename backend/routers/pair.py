"""
/api/pair — Device pairing (QR-based).

Позволяет связать новое устройство с уже верифицированной личностью.
Новое устройство всё равно проходит liveness-верификацию самостоятельно —
приватный ключ никогда не передаётся.

POST /api/pair/create          — создать код спаривания (нужен верифицированный DID)
POST /api/pair/claim           — принять код после верификации на новом устройстве
GET  /api/pair/status/{code}   — статус кода (опрос с device A)
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from routers._auth_helpers import require_proven_did
from services.feature_flags import feature_enabled

MAX_DEVICES_PER_PERSON = int(os.getenv("MAX_DEVICES_PER_PERSON", "10"))

router = APIRouter()

# 6 символов без визуально схожих: 0/O, 1/I
_SAFE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_LINK_TTL   = 600   # 10 минут


class ClaimBody(BaseModel):
    link_code: str
    new_did:   str


@router.post("/create")
async def create_pairing(request: Request):
    """
    Создать одноразовый код спаривания.

    Auth: STRICT — Bearer JWT обязателен (require_proven_did). Никаких
    X-APTOGON-DID fallback: знание DID жертвы НЕ должно позволять создать
    pairing-код в её имя (см. SECURITY-pairing-auth.md).

    Возвращает 6-символьный код + verify URL для рендера QR client-side.
    """
    did = await require_proven_did(request)

    db  = request.app.state.db
    now = int(time.time())

    link_code  = ''.join(secrets.choice(_SAFE_CHARS) for _ in range(6))
    expires_at = now + _LINK_TTL

    await db.create_pairing(
        link_code  = link_code,
        did_primary = did,
        expires_at  = expires_at,
    )

    # verify_url передаётся фронту — QR-картинка рендерится client-side, чтобы pairing-токен
    # не уходил на сторонние сервисы (раньше использовался api.qrserver.com).
    verify_url = f"https://homosapience.org/en/verify?link={link_code}"

    return {
        "link_code":   link_code,
        "verify_url":  verify_url,
        "expires_at":  expires_at,
        "ttl_seconds": _LINK_TTL,
    }


@router.post("/claim")
async def claim_pairing(body: ClaimBody, request: Request):
    """
    Link a freshly-verified device (device B) to a pairing code.

    Security model:
    - The claiming device must itself hold a valid on-chain HumanCredential
      (is_human). A bare pairing code is NOT sufficient — this stops an
      attacker who merely intercepts the code from claiming.
    - Privileged roles (admin / gold_member) are NOT transferred automatically.
      A pairing code is a 10-minute bearer token; auto-granting privilege on
      claim would let a leaked code escalate. Roles are granted explicitly via
      the admin panel ("add this device as admin").
    - Claims are rate-limited per IP to prevent brute-forcing the 6-char code.
    """
    db    = request.app.state.db
    aptos = request.app.state.aptos
    rl    = getattr(request.app.state, "rate_limiter", None)

    ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "unknown")
    )

    if rl:
        allowed, reason = await rl.check_pair_claim(ip)
        if not allowed:
            raise HTTPException(status_code=429, detail=reason)

    # The claiming device must be a verified human in its own right.
    if not await aptos.is_human(body.new_did):
        raise HTTPException(status_code=403, detail={
            "error":   "not_verified",
            "message": "This device must complete human verification before pairing.",
        })

    result = await db.claim_pairing(link_code=body.link_code, new_did=body.new_did)
    if result is None:
        raise HTTPException(status_code=404, detail={
            "error":   "invalid_link_code",
            "message": "Link code not found, already used, or expired",
        })

    # Вариант B: attach the new device to the primary's person (account aggregate).
    # No secret is copied — device B kept its own key and passed its own gesture.
    if feature_enabled("DEVICE_ACCOUNTS"):
        person_id = await db.ensure_person_for_did(result["did_primary"], is_primary=True)
        if await db.count_active_devices(person_id) >= MAX_DEVICES_PER_PERSON:
            raise HTTPException(status_code=403, detail={"error": "device_limit_reached",
                                                         "limit": MAX_DEVICES_PER_PERSON})
        await db.link_device(person_id, body.new_did)

    # NOTE: admin/gold roles are intentionally NOT auto-transferred. Linking a
    # device must not, by itself, grant privilege. Grant roles separately.
    return {
        "status":      "linked",
        "did_primary": result["did_primary"],
        "did_linked":  body.new_did,
        "is_admin":    False,
        "role":        None,
    }


@router.get("/status/{link_code}")
async def pairing_status(link_code: str, request: Request):
    """
    Опрос статуса кода (device A ждёт пока device B завершит верификацию).
    Возвращает: pending / claimed / expired
    """
    db      = request.app.state.db
    pairing = await db.get_pairing(link_code)

    if not pairing:
        raise HTTPException(status_code=404, detail="Link code not found")

    now = int(time.time())

    if pairing.get("claimed_at"):
        return {
            "status":     "claimed",
            "did_linked": pairing.get("did_linked"),
            "claimed_at": pairing.get("claimed_at"),
        }

    if pairing.get("expires_at", 0) < now:
        return {"status": "expired"}

    return {
        "status":          "pending",
        "expires_at":      pairing.get("expires_at"),
        "seconds_left":    max(0, pairing["expires_at"] - now),
    }


# ── Device accounts (Вариант B) — за флагом FEATURE_DEVICE_ACCOUNTS ────────────

class UnlinkBody(BaseModel):
    did: str


def _require_device_accounts() -> None:
    if not feature_enabled("DEVICE_ACCOUNTS"):
        raise HTTPException(status_code=404, detail="device accounts disabled")


@router.get("/devices")
async def list_account_devices(request: Request):
    """
    Devices linked to the calling person (account aggregate).
    Auth: caller must be a verified DID (its credential valid).
    """
    _require_device_accounts()
    did = await require_proven_did(request)
    db  = request.app.state.db
    person_id = await db.get_person_for_did(did)
    if not person_id:
        # Lazily register this device as its own person so the view is non-empty.
        person_id = await db.ensure_person_for_did(did, is_primary=True)
    summary = await db.account_summary(person_id)
    summary["this_did"] = did
    return summary


@router.get("/account")
async def account_badge(request: Request):
    """Compact account aggregate (device_count + best trust) for the verify badge."""
    _require_device_accounts()
    did = await require_proven_did(request)
    db  = request.app.state.db
    person_id = await db.get_person_for_did(did)
    if not person_id:
        return {"device_count": 1, "max_trust_label": None, "max_trust_score": 0.0}
    s = await db.account_summary(person_id)
    return {
        "device_count":    s["device_count"],
        "max_trust_label": s["max_trust_label"],
        "max_trust_score": s["max_trust_score"],
    }


@router.post("/unlink")
async def unlink_device(body: UnlinkBody, request: Request):
    """
    Revoke (unlink) a device from the caller's person. Only devices in the
    SAME person as the caller can be unlinked — closes the 'compromise → revoke'
    loop without copying any secret.
    """
    _require_device_accounts()
    did = await require_proven_did(request)
    db  = request.app.state.db

    caller_person = await db.get_person_for_did(did)
    target_person = await db.get_person_for_did(body.did)
    if not caller_person or caller_person != target_person:
        raise HTTPException(status_code=403, detail={
            "error":   "not_your_device",
            "message": "You can only unlink devices linked to your own account.",
        })

    ok = await db.revoke_device(body.did)
    return {"status": "unlinked" if ok else "already_unlinked", "did": body.did}
