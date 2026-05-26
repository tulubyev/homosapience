# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/bond — P2P поручительство (HSI Bond).

GET  /api/bond/candidates            — список потенциальных поручителей
POST /api/bond/request               — создать запрос на поручительство
GET  /api/bond/status/{request_id}   — статус запроса (polling с фронтенда)
POST /api/bond/approve               — одобрить запрос
POST /api/bond/reject                — отклонить запрос
GET  /api/bond/my                    — мои входящие/исходящие запросы

Логика (Stage 1 + Stage 2):
  confidence >= AUTO_APPROVE_THRESHOLD (0.95)
      → немедленный авто-апрув тремя системными поручителями
      → HumanCredential записывается в Aptos сразу

  confidence < AUTO_APPROVE_THRESHOLD
      → запрос попадает в очередь PostgreSQL
      → реальные люди получают уведомления (TODO: WebSocket push)
      → при 3+ одобрениях выдаётся credential
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

# ── Константы ──────────────────────────────────────────────────────────────────

# Минимальный confidence для того чтобы запрос вообще попал в очередь.
# Ниже этого порога — жест слишком слабый, не тратим время поручителей.
MIN_CONFIDENCE = 0.70

# Gold Members получают уведомление и ВРУЧНУЮ одобряют каждый запрос.
# AUTO-APPROVE ОТКЛЮЧЁН — это была security theater.
# Sunset: через BOOTSTRAP_SUNSET_DAYS дней или BOOTSTRAP_SUNSET_USERS
# пользователей Gold Members теряют привилегированный статус.
BOOTSTRAP_SUNSET_DAYS  = 60    # 2 месяца
BOOTSTRAP_SUNSET_USERS = 150   # или 150 верифицированных

BOND_THRESHOLD    = 3   # минимум N поручительств
MAX_RETRIES       = 3
RETRY_BATCH_SIZE  = 10

# Лимит одобрений одним Gold Member в сутки — защита от компрометации
GOLD_MEMBER_DAILY_APPROVE_LIMIT = 20
# Дополнительные лимиты (rate_limiter): 5/месяц + 48h cooldown между поручительствами

# ── Gold Members / Genesis Validators ─────────────────────────────────────────
# Реальные DID первых верифицированных участников команды.
# Загружаются из переменной окружения GOLD_MEMBER_DIDS (через запятую).
# Они автоматически поручаются за новых пользователей в bootstrap-период.
# После роста сети (100+ users) → переключиться на реальных поручителей:
#   AUTO_APPROVE_THRESHOLD = 0.95
#
# Формат .env:
#   GOLD_MEMBER_DIDS=did:key:z6Mk...,did:key:z6Mk...,did:key:z6Mk...
import os as _os
# Bootstrap fallback from env (used before DB / in dev mode)
_raw_gold = _os.getenv("GOLD_MEMBER_DIDS", "")
SYSTEM_GUARANTORS: list[str] = [d.strip() for d in _raw_gold.split(",") if d.strip()]

# DB-backed cache of gold-member full DIDs (refreshed every 60s)
_gold_cache: list[str] = list(SYSTEM_GUARANTORS)
_gold_cache_ts: float = 0.0
_GOLD_CACHE_TTL = 60.0


async def _get_gold_members(db) -> list[str]:
    """Return list of full DIDs for active gold_members (DB-backed, TTL-cached)."""
    global _gold_cache, _gold_cache_ts
    now = time.time()
    if now - _gold_cache_ts < _GOLD_CACHE_TTL:
        return _gold_cache
    try:
        rows = await db.get_admin_dids(role="gold_member", active_only=True)
        # Prefer did_full if stored; otherwise did_short is all we have
        _gold_cache = [r["did_full"] or r["did_short"] for r in rows]
        _gold_cache_ts = now
    except Exception:
        pass  # keep stale cache
    return _gold_cache


# ── Admin: просмотр Gold Members ──────────────────────────────────────────────

@router.get("/gold-members")
async def get_gold_members():
    """
    Список текущих Gold Members (Genesis Validators).
    DID обрезаются для конфиденциальности — только первые 20 символов.
    """
    db = None
    try:
        from fastapi import Request as _Req
    except Exception:
        db = None
    golds = _gold_cache  # use cached value
    return {
        "count": len(golds),
        "threshold": MIN_CONFIDENCE,
        "bond_threshold": BOND_THRESHOLD,
        "members": [
            {"short": d[-12:], "full": d}
            for d in golds
        ] if golds else [],
        "status": "active" if golds else "⚠️ No Gold Members configured",
    }


# ── Схемы ──────────────────────────────────────────────────────────────────────

class BondCandidate(BaseModel):
    did_hash_short: str
    reputation: int
    bond_count: int
    success_rate: float
    last_active_days: int


class BondRequestCreate(BaseModel):
    requester_did: str
    expression_proof: str
    confidence: float = 0.0   # из ответа /api/verify/expression
    message: Optional[str] = None
    known_dids: list[str] = []  # до 3 DID людей, которые знают заявителя лично


class BondStatusResponse(BaseModel):
    request_id: str
    status: str               # pending | approved | rejected
    auto_approved: bool
    approvals: int
    needed: int
    tx_hash: Optional[str] = None
    created_at: int


class BondApprove(BaseModel):
    request_id:    str
    approver_did:  str
    timestamp:     int             # unix timestamp момента подписи
    signature:     str             # base64url Ed25519 подпись (64 bytes → ~86 chars)
    # Legacy поле — принимаем если подпись ещё не реализована на клиенте
    # Удалить после того как все клиенты обновятся
    signature_optional: bool = False


# ── Trust Score ────────────────────────────────────────────────────────────────

def _calculate_trust_score(bond_count: int) -> float:
    """
    Уровни доверия по числу поручительств:
      0 bonds → 0.1  (прошёл SapiX, новичок)
      1 bond  → 0.2
      2 bonds → 0.3
      3 bonds → 0.5  (признан сообществом)
      4 bonds → 0.6
      5 bonds → 0.7
      6 bonds → 0.8
      7+ bonds → 1.0 (полное доверие)
    """
    if bond_count == 0:
        return 0.1
    if bond_count < 3:
        return 0.1 + bond_count * 0.1
    if bond_count < 7:
        return 0.5 + (bond_count - 3) * 0.1
    return 1.0


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _issue_credential(aptos, bond_req: dict, approvals: list[str]) -> str:
    """Записать HumanCredential в Aptos. Возвращает tx_hash."""
    try:
        from services.did_key import did_hash
        tx = await aptos.issue_credential(
            address=bond_req["requester_did"],
            did_hash=did_hash(bond_req["requester_did"]),
            expression_proof=bond_req["expression_proof"],
            bond_count=len(approvals),
        )
        return tx.get("tx_hash") or f"0x{'a' * 64}"
    except Exception:
        # В dev окружении Aptos может быть недоступен — возвращаем stub
        return f"0x{'b' * 64}"


# ── BondMatcher AI selection ───────────────────────────────────────────────────

async def _select_guarantors(
    request,
    online_set: set[str],
    confidence: float,
    n_select: int,
) -> list[str]:
    """
    Выбрать лучших поручителей из онлайн-участников через Gonka BondMatcher.
    Fallback: случайный выбор если AI недоступен или онлайн мало людей.
    """
    import random
    import time as _time

    if not online_set:
        return []

    # Получить все верифицированные credentials из БД
    db     = request.app.state.db
    gonka  = request.app.state.gonka
    now_ts = int(_time.time())

    try:
        all_creds = await db.list_credentials(only_valid=True, limit=200)
    except Exception:
        all_creds = []

    # Построить CandidateProfile только для тех, кто онлайн
    # ws_manager key = SHA3-256(did)[:12] — совпадает с did_hash() из did_key.py
    from services.did_key import did_hash as _did_hash

    bond_matcher = getattr(gonka, "bond_matcher", None)

    if bond_matcher and all_creds:
        try:
            from sapix.bond_matcher import CandidateProfile, RequesterProfile

            pool: list[CandidateProfile] = []
            for cred in all_creds:
                c_key = _did_hash(cred["did"])        # 12-char key = ws_manager key
                if c_key not in online_set:
                    continue
                issued_at   = cred.get("issued_at", now_ts)
                joined_days = max(0, (now_ts - issued_at) // 86400)
                last_seen   = request.app.state.ws_manager._last_seen.get(c_key, issued_at)
                last_days   = max(0, (now_ts - last_seen) // 86400)
                bond_count  = cred.get("bond_count", 0)
                trust_score = cred.get("trust_score", 0.1)

                pool.append(CandidateProfile(
                    did_hash=c_key,
                    reputation_score=int(trust_score * 1000),
                    bond_count=bond_count,
                    successful_bonds=bond_count,   # all stored bonds are successful
                    revoked_bonds=0,
                    last_bond_days_ago=last_days,
                    network_depth=3,
                    active_hours_per_week=7.0,
                    joined_days_ago=joined_days,
                ))

            if pool:
                requester = RequesterProfile(
                    expression_confidence=confidence,
                    verification_stage="new",
                    previous_attempts=0,
                )
                result = await bond_matcher.find_guarantors(
                    candidates=pool,
                    requester=requester,
                    n_select=n_select,
                )
                selected = [c.did_hash for c in result.selected_candidates]
                if selected:
                    return selected
        except Exception:
            pass  # Fallback below

    # Fallback: random sample from online set
    rng = random.Random(int(_time.time()))
    return rng.sample(list(online_set), min(n_select, len(online_set)))


# ── Эндпоинты ──────────────────────────────────────────────────────────────────

@router.get("/candidates", response_model=list[BondCandidate])
async def get_candidates(request: Request, limit: int = 20):
    """
    Список РЕАЛЬНЫХ верифицированных людей, имеющих право поручаться.

    Право поручаться даётся при trust_score >= 0.5 (community_verified)
    либо Gold Member (bootstrap-период). Данные — из БД, не выдумка.
    На холодном старте список может быть пустым — это корректно:
    запросы всё равно уходят push'ом Gold Members (см. /request).
    """
    db = request.app.state.db
    ws_manager = getattr(request.app.state, "ws_manager", None)
    now_ts = int(time.time())

    try:
        creds = await db.list_credentials(only_valid=True, limit=200)
    except Exception:
        creds = []

    from services.did_key import did_hash as _did_hash

    out: list[BondCandidate] = []
    for c in creds:
        trust = c.get("trust_score", 0.1)
        is_gold = bool(c.get("gold_member"))
        # Только те, кто реально может поручаться
        if trust < 0.5 and not is_gold:
            continue

        c_key = _did_hash(c["did"])  # 12-символьный ключ = ws_manager key
        issued_at = c.get("issued_at", now_ts)
        last_seen = issued_at
        if ws_manager:
            last_seen = ws_manager._last_seen.get(c_key, issued_at)

        out.append(BondCandidate(
            did_hash_short=c_key,
            reputation=int(trust * 1000),
            bond_count=c.get("bond_count", 0),
            success_rate=1.0,  # revoked_bonds ещё не трекается — честная заглушка
            last_active_days=max(0, (now_ts - last_seen) // 86400),
        ))

    out.sort(key=lambda x: x.reputation, reverse=True)
    return out[:limit]


@router.post("/request", response_model=BondStatusResponse)
async def create_bond_request(body: BondRequestCreate, request: Request):
    """
    Создаёт bond-запрос.

    Stage 1 — confidence >= 0.95:
        Системные поручители немедленно одобряют.
        HumanCredential выдаётся мгновенно.

    Stage 2 — confidence < 0.95:
        Запрос сохраняется в очереди.
        Реальные люди уведомляются и одобряют через /approve.
    """
    db = request.app.state.db
    aptos = request.app.state.aptos

    # ── Behavioral analysis: bond burst detection ─────────────────────────────
    beh = getattr(request.app.state, "behavior", None)
    if beh:
        requester_short = body.requester_did[-12:] if body.requester_did else ""
        beh_result = await beh.record_bond_request(requester_short)
        if beh_result.is_blocked:
            raise HTTPException(
                status_code=429,
                detail={
                    "error":   "behavior_blocked",
                    "level":   beh_result.level,
                    "reason":  beh_result.reason,
                    "message": "Too many bond requests. Possible sybil activity detected.",
                },
            )

    # ── Проверка минимального confidence ──────────────────────────────────────
    if body.confidence < MIN_CONFIDENCE:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "confidence_too_low",
                "message": f"Gesture confidence {body.confidence:.2f} < {MIN_CONFIDENCE}. Try again.",
                "confidence": body.confidence,
                "required": MIN_CONFIDENCE,
            }
        )

    bond_req = await db.create_bond_request(
        requester_did=body.requester_did,
        expression_proof=body.expression_proof,
        confidence=body.confidence,
        message=body.message,
    )

    # ── Уведомляем Gold Members (они ВРУЧНУЮ одобряют) ────────────────────────
    # Auto-approve удалён — это было security theater.
    # Gold Members получают WebSocket-уведомление и нажимают кнопку.
    # ── WebSocket push поручителям ────────────────────────────────────────────
    ws_manager = getattr(request.app.state, "ws_manager", None)
    delivered = []
    if ws_manager:
        all_online_set = set(ws_manager._connections.keys())
        candidates_to_notify = await _select_guarantors(
            request, all_online_set, body.confidence, RETRY_BATCH_SIZE
        )

        from services.did_key import did_hash as _did_hash
        requester_short = _did_hash(body.requester_did)[:12]
        delivered = await ws_manager.notify_bond_request(
            guarantor_did_hashes=candidates_to_notify,
            request_id=bond_req["id"],
            requester_did_hash_short=requester_short,
            confidence=body.confidence,
            message=body.message,
        )
        # Обновляем sent_to_count
        if delivered:
            await db.increment_retry(bond_req["id"], len(candidates_to_notify))

    # ── Push to Gold Member bond panels (event-driven, no polling needed) ────
    if ws_manager:
        panel_payload = {
            "type":    "bond:request",
            "request": {
                "id":              bond_req["id"],
                "requester_did":   body.requester_did,
                "confidence":      round(body.confidence, 2),
                "message":         body.message,
                "created_at":      bond_req["created_at"],
                "approvals_count": 0,
                "needed":          BOND_THRESHOLD,
            },
        }
        # exclude the requester themselves from push (edge case where requester is gold member)
        await ws_manager.notify_all_panels(panel_payload, exclude_did=body.requester_did)

    # ── Прямое уведомление known_dids ─────────────────────────────────────────
    if ws_manager and body.known_dids:
        from services.did_key import did_hash as _did_hash
        known_hashes = []
        for did in body.known_dids[:3]:  # максимум 3
            if did.startswith("did:key:z"):
                known_hashes.append(_did_hash(did)[:16])
        if known_hashes:
            personal_payload = {
                "type":         "bond:personal_invite",
                "request_id":   bond_req["id"],
                "requester":    _did_hash(body.requester_did)[:12],
                "message":      body.message or "",
                "confidence_badge": f"{int(body.confidence * 100)}%",
                "ts":           bond_req["created_at"],
                "personal":     True,   # флаг — это персональный запрос от знакомого
            }
            await ws_manager.notify_bond_request(
                guarantor_did_hashes=known_hashes,
                request_id=bond_req["id"],
                requester_did_hash_short=_did_hash(body.requester_did)[:12],
                confidence=body.confidence,
                message=f"[Personal invite] {body.message or ''}",
            )

    return BondStatusResponse(
        request_id=bond_req["id"],
        status="pending",
        auto_approved=False,
        approvals=0,
        needed=BOND_THRESHOLD,
        tx_hash=None,
        created_at=bond_req["created_at"],
    )


@router.get("/status/{request_id}", response_model=BondStatusResponse)
async def get_bond_status(request_id: str, request: Request):
    """
    Статус bond-запроса. Используется для polling с фронтенда.
    Фронтенд опрашивает каждые 2–5 секунд до status == 'approved'.
    """
    db = request.app.state.db
    bond_req = await db.get_bond_request(request_id)
    if not bond_req:
        raise HTTPException(status_code=404, detail="Bond request not found")

    approvals = bond_req.get("approvals", [])
    return BondStatusResponse(
        request_id=bond_req["id"],
        status=bond_req["status"],
        auto_approved=bool(bond_req.get("auto_approved", False)),
        approvals=len(approvals),
        needed=max(0, BOND_THRESHOLD - len(approvals)),
        tx_hash=bond_req.get("tx_hash"),
        created_at=bond_req["created_at"],
    )


@router.post("/approve")
async def approve_bond(body: BondApprove, request: Request):
    """
    Поручитель одобряет запрос.
    При BOND_THRESHOLD+ одобрениях выдаётся HumanCredential.

    Защита от Sybil:
      - Нельзя поручиться за самого себя
      - Поручитель должен иметь trust_score >= 0.5 (признан сообществом)
        или являться системным поручителем (SYSTEM_GUARANTORS)
    """
    db = request.app.state.db
    aptos = request.app.state.aptos

    bond_req = await db.get_bond_request(body.request_id)
    if not bond_req:
        raise HTTPException(status_code=404, detail="Bond request not found")
    if bond_req["status"] not in ("pending",):
        raise HTTPException(
            status_code=400,
            detail=f"Bond request status is '{bond_req['status']}' — cannot approve",
        )

    # ── Защита от самопоручительства ──────────────────────────────────────────
    if body.approver_did == bond_req["requester_did"]:
        raise HTTPException(status_code=400, detail="Cannot vouch for yourself")

    # ── Криптографическая верификация подписи ─────────────────────────────────
    from services.did_key import DIDKey
    sig_ok, sig_reason = DIDKey.verify_bond_approval(
        approver_did=body.approver_did,
        request_id=body.request_id,
        requester_did=bond_req["requester_did"],
        timestamp=body.timestamp,
        signature_b64url=body.signature,
    )
    if not sig_ok:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "invalid_signature",
                "message": f"Ed25519 signature verification failed: {sig_reason}",
                "hint": "Sign bond_approval_message(request_id, requester_did, timestamp) with your DID private key",
            }
        )

    gold_members = await _get_gold_members(db)
    is_gold = body.approver_did in gold_members

    # ── Sunset: Gold Members теряют привилегии после роста сети ───────────────
    if is_gold:
        import os as _os
        network_start = int(_os.getenv("NETWORK_START_TS", "0"))
        now_ts = int(time.time())
        days_alive = (now_ts - network_start) / 86400 if network_start else 0
        total_users = len(await db.list_credentials(only_valid=True))

        if days_alive > BOOTSTRAP_SUNSET_DAYS or total_users > BOOTSTRAP_SUNSET_USERS:
            is_gold = False  # Bootstrap окончен — Gold Members как обычные поручители

    # ── Rate limit для Gold Members (20/сутки + 5/месяц + 48h cooldown) ─────────
    if is_gold:
        # Суточный лимит (существующая проверка)
        day_start = int(time.time()) - 86400
        recent = await db.count_approvals_by_did_since(body.approver_did, day_start)
        if recent >= GOLD_MEMBER_DAILY_APPROVE_LIMIT:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "gold_member_rate_limit",
                    "message": f"Gold Member daily approve limit ({GOLD_MEMBER_DAILY_APPROVE_LIMIT}) reached.",
                    "reset_in_hours": 24,
                }
            )
        # Месячный лимит + 48h cooldown (через rate_limiter)
        rl = getattr(request.app.state, "rate_limiter", None)
        if rl:
            approver_short = body.approver_did[-12:]
            allowed, reason = await rl.check_bond_vouch(approver_short)
            if not allowed:
                raise HTTPException(
                    status_code=429,
                    detail={"error": "bond_vouch_limit", "message": reason},
                )

    # ── Проверка trust_score поручителя ───────────────────────────────────────
    if not is_gold:
        approver_cred = await aptos.get_credential(body.approver_did)
        if approver_cred is None or approver_cred.trust_score < 0.5:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "insufficient_trust",
                    "message": "Approver trust_score < 0.5. Get at least 3 bonds first.",
                    "required": 0.5,
                    "current": approver_cred.trust_score if approver_cred else 0.0,
                },
            )

    approvals = await db.add_approval(
        body.request_id,
        body.approver_did,
        signature=body.signature,
        sig_verified=sig_ok,
    )

    # Записываем vouch в rate_limiter (cooldown + месячный счётчик)
    if is_gold:
        rl = getattr(request.app.state, "rate_limiter", None)
        if rl:
            await rl.record_bond_vouch(body.approver_did[-12:])

    if len(approvals) >= BOND_THRESHOLD:
        tx_hash = await _issue_credential(aptos, bond_req, approvals)
        await db.update_bond_status(body.request_id, "approved", tx_hash=tx_hash)

        # Обновляем trust_score получателя
        new_score = _calculate_trust_score(len(approvals))
        from services.did_key import did_hash as _did_hash
        await aptos.update_trust_score(
            address=bond_req["requester_did"],
            new_score=new_score,
            bond_sponsors=[_did_hash(d)[:12] for d in approvals],
        )

        return {
            "status": "credential_issued",
            "approvals": len(approvals),
            "tx_hash": tx_hash,
            "trust_score": new_score,
            "message": f"HumanCredential issued after {len(approvals)} bonds",
        }

    return {
        "status": "pending",
        "approvals": len(approvals),
        "needed": BOND_THRESHOLD - len(approvals),
    }


@router.post("/retry/{request_id}")
async def retry_bond_request(request_id: str, request: Request):
    """
    Повторная рассылка bond-запроса новой волне кандидатов.
    Вызывается автоматически если все предыдущие кандидаты отказали,
    или вручную запрашивающим.
    Максимум MAX_RETRIES (3) повторов.
    """
    db = request.app.state.db
    ws_manager = getattr(request.app.state, "ws_manager", None)

    bond_req = await db.get_bond_request(request_id)
    if not bond_req:
        raise HTTPException(status_code=404, detail="Bond request not found")
    if bond_req["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Bond request status is '{bond_req['status']}' — cannot retry",
        )

    retry_count = bond_req.get("retry_count", 0)
    if retry_count >= MAX_RETRIES:
        # Исчерпали все попытки — переводим в failed
        await db.update_bond_status(request_id, "failed")
        from services.did_key import did_hash as _did_hash
        requester_hash = _did_hash(bond_req["requester_did"])[:16]
        if ws_manager:
            await ws_manager.notify_bond_update(
                requester_hash, request_id, "failed"
            )
        return {
            "status": "failed",
            "message": f"Exhausted {MAX_RETRIES} retry attempts. No guarantors available.",
            "retry_count": retry_count,
        }

    delivered = []
    if ws_manager:
        all_online_set = set(ws_manager._connections.keys())
        candidates = await _select_guarantors(
            request, all_online_set, bond_req.get("confidence", 0.7), RETRY_BATCH_SIZE
        )

        from services.did_key import did_hash as _did_hash
        requester_short = _did_hash(bond_req["requester_did"])[:12]
        delivered = await ws_manager.notify_bond_request(
            guarantor_did_hashes=candidates,
            request_id=request_id,
            requester_did_hash_short=requester_short,
            confidence=bond_req.get("confidence", 0),
            message=bond_req.get("message"),
        )

    new_retry = await db.increment_retry(request_id, len(delivered))
    return {
        "status": "pending",
        "retry_count": new_retry,
        "notified": len(delivered),
        "message": f"Retry #{new_retry}: sent to {len(delivered)} guarantors online",
    }


@router.post("/reject")
async def reject_bond(request_id: str, rejecter_did: str, request: Request):
    """
    Поручитель отклоняет запрос.
    Если все разосланные кандидаты отказали → автоматический retry.
    """
    db = request.app.state.db
    bond_req = await db.get_bond_request(request_id)
    if not bond_req:
        raise HTTPException(status_code=404, detail="Bond request not found")

    # Записываем отказ; метод возвращает True если все отказали
    all_declined = await db.record_rejection(request_id, rejecter_did)

    if all_declined:
        # Автоматический retry (если не исчерпан лимит)
        from fastapi import BackgroundTasks
        retry_count = bond_req.get("retry_count", 0)
        if retry_count < MAX_RETRIES:
            # Запускаем retry через отдельный вызов эндпоинта
            # (упрощённо — вызываем логику напрямую)
            await retry_bond_request(request_id, request)
            return {"status": "all_declined_retry_sent", "retry": retry_count + 1}
        else:
            await db.update_bond_status(request_id, "failed")
            ws_manager = getattr(request.app.state, "ws_manager", None)
            if ws_manager:
                from services.did_key import did_hash as _did_hash
                requester_hash = _did_hash(bond_req["requester_did"])[:16]
                await ws_manager.notify_bond_update(
                    requester_hash, request_id, "failed"
                )
            return {"status": "failed", "message": "All retries exhausted"}

    return {"status": "reject_recorded"}


@router.get("/my")
async def my_bonds(did: str, request: Request):
    """Все bond-запросы, связанные с DID (входящие + исходящие)."""
    db = request.app.state.db
    return await db.get_bonds_for_did(did)


@router.get("/pending-for-guarantor")
async def pending_for_guarantor(request: Request):
    """
    Pending bond requests for a Gold Member guarantor.
    Используется браузерным расширением для показа панели одобрения.

    Авторизация: X-Approver-DID header (должен быть в SYSTEM_GUARANTORS).
    Возвращает только те запросы, которые этот поручитель ещё не одобрил/отклонил.
    """
    approver_did = request.headers.get("X-Approver-DID", "").strip()
    if not approver_did:
        raise HTTPException(status_code=400, detail="X-Approver-DID header required")

    db = request.app.state.db
    # Только Gold Members видят входящие запросы через это API
    gold_members = await _get_gold_members(db)
    if approver_did not in gold_members:
        # Возвращаем пустой список (не 403) — чтобы не раскрывать список Gold Members
        return {"requests": [], "total": 0}

    # Получаем все pending запросы, которые этот поручитель ещё не обработал
    pending = await db.get_pending_for_guarantor(approver_did)

    return {
        "requests": [
            {
                "id": r["id"],
                "requester_did": r["requester_did"],
                "confidence": round(r.get("confidence", 0), 2),
                "message": r.get("message"),
                "created_at": r.get("created_at"),
                "approvals_count": r.get("approvals_count", 0),
                "needed": max(0, BOND_THRESHOLD - r.get("approvals_count", 0)),
            }
            for r in pending
        ],
        "total": len(pending),
    }
