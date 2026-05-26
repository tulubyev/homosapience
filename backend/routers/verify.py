"""
/api/verify — верификация + did:key выдача.

POST /api/verify/expression   → анализ жеста, выдача did:key + credential
GET  /api/verify/status       → статус по DID
POST /api/verify/did          → создать did:key (без верификации, для тестов)
GET  /api/verify/debug        → последние попытки верификации (для отладки)
"""

import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

def _check_admin(request: Request):
    """Simple token auth for admin endpoints. Pass via ?token= or X-Admin-Token header."""
    if not ADMIN_TOKEN:
        return  # если не задан — эндпоинт открыт (для разработки)
    token = request.query_params.get("token") or request.headers.get("X-Admin-Token", "")
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Admin token required")

_DEBUG_LOG = Path("/tmp/aptogon_attempts.jsonl")


def _save_attempt(record: dict):
    with open(_DEBUG_LOG, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

from services.did_key import DIDKey, create_human_credential, did_hash

router = APIRouter()


class TouchEventDTO(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    pressure: float = Field(0.5, ge=0.0, le=1.0)
    timestamp_ms: int
    pause_after_ms: int = 0


class ChallengeDTO(BaseModel):
    dot_x:       float = Field(..., ge=0.0, le=1.0)
    dot_y:       float = Field(..., ge=0.0, le=1.0)
    shown_at_ms: int
    reaction_ms: Optional[int] = None   # null = missed
    tap_x:       Optional[float] = None
    tap_y:       Optional[float] = None
    color:       Optional[str]  = None  # dot color label


class ExpressionRequest(BaseModel):
    events: list[TouchEventDTO] = Field(..., min_length=10)  # min 10 points
    session_id: Optional[str] = None
    fp_hash: Optional[str] = Field(None, min_length=16, max_length=128,
                                   description="SHA-256 device fingerprint hash (64 hex chars)")
    challenge:  Optional[ChallengeDTO]       = None   # legacy single challenge
    challenges: Optional[list[ChallengeDTO]] = None   # multi-challenge (1-3 dots)


def _confidence_band(c: float) -> str:
    """Obfuscate exact confidence — return band only (prevents model extraction)."""
    if c >= 0.90: return "high"
    if c >= 0.78: return "medium"
    return "low"


class VerifyResponse(BaseModel):
    # SapiX result
    is_human: bool
    confidence_band: str = "low"   # "low" | "medium" | "high" — exact value not exposed
    passed: bool
    reasoning: str
    via_fallback: bool = False
    anomalies: list[str] = []
    # did:key (новое — заменяет Ceramic)
    did: Optional[str] = None
    private_key_b64: Optional[str] = None
    # Aptos
    expression_proof: Optional[str] = None
    tx_hash: Optional[str] = None
    credential: Optional[dict] = None
    # Sybil Protection B: Trust Score
    trust_score: float = 0.1
    trust_label: str = "newcomer"   # newcomer | community_verified | trusted
    # Debug: pattern metrics
    debug: Optional[dict] = None


@router.post("/expression", response_model=VerifyResponse)
async def verify_expression(body: ExpressionRequest, request: Request):
    """
    Полный флоу верификации:
    1. SapiX анализирует жест
    2. При успехе — генерируется did:key (W3C стандарт, без Ceramic)
    3. Credential записывается в Aptos

    Ответ содержит did + private_key_b64 — фронтенд сохраняет в localStorage.
    """
    gonka = request.app.state.gonka
    aptos = request.app.state.aptos
    session_id = body.session_id or str(uuid.uuid4())

    # ── [Security] Get real client IP ─────────────────────────────────────────
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "unknown")
    )

    # ── [Security A] IP-based rate limiting (prevents model extraction) ───────
    rl = getattr(request.app.state, "rate_limiter", None)
    if rl:
        allowed, reason = await rl.check_verify_ip(client_ip)
        if not allowed:
            raise HTTPException(status_code=429, detail={
                "error": "rate_limit_exceeded",
                "message": reason,
            })

    # ── [Security B] Session ID replay protection ──────────────────────────────
    if rl and body.session_id:
        fresh = await rl.check_session_id(body.session_id)
        if not fresh:
            raise HTTPException(status_code=400, detail={
                "error": "session_replayed",
                "message": "session_id already used. Generate a new UUID for each verification.",
            })

    # ── [Security C] Timestamp validation ─────────────────────────────────────
    gesture_duration_ms: int | None = None
    if len(body.events) >= 2:
        ts_list = [e.timestamp_ms for e in body.events]
        # Monotonicity check (non-strict: equal timestamps allowed, e.g. same ms)
        if any(ts_list[i] > ts_list[i+1] for i in range(len(ts_list)-1)):
            raise HTTPException(status_code=400, detail={
                "error": "invalid_timestamps",
                "message": "Event timestamps must be non-decreasing.",
            })
        gesture_duration_ms = ts_list[-1] - ts_list[0]
        # Default minimum: 8 seconds. RISK_GATE may raise to 10s for high-risk.
        _min_gesture_ms = 8000
        # Maximum 60 seconds (stale or pre-recorded)
        if gesture_duration_ms > 60_000:
            raise HTTPException(status_code=400, detail={
                "error": "gesture_too_long",
                "message": "Gesture duration exceeds 60 seconds.",
            })
        # Recency check: last event must be within 90 seconds of now
        now_ms = int(time.time() * 1000)
        age_ms = now_ms - ts_list[-1]
        if age_ms > 90_000 or age_ms < -5_000:
            raise HTTPException(status_code=400, detail={
                "error": "gesture_stale",
                "message": "Gesture timestamps are not recent. Replay detected.",
            })

    # ── [R2] RISK_GATE — adaptive gesture length + pre-gesture bot block ──────
    # Runs BEFORE gesture evaluation so bots are caught before hitting SapiX.
    # Behind FEATURE_RISK_GATE env flag; if OFF → standard 8s check applies.
    _risk_result = None
    from services.feature_flags import feature_enabled as _feat
    if _feat("RISK_GATE") or _feat("STATS_COLLECT"):
        try:
            risk_engine = getattr(request.app.state, "risk_engine", None)
            if risk_engine:
                from services.risk_engine import RiskEngine
                # Build server context from what we know at this stage
                _server_ctx = {
                    "client_ip": client_ip,
                    "challenge_anomalies": [],   # not evaluated yet
                    "ip_rate_limit": False,
                    "fp_rate_limit": False,
                    "gesture_duration_ms": gesture_duration_ms,
                }
                _risk_result = risk_engine.assess(
                    client_signals={},  # no client signals at this stage (pre-gesture)
                    server_ctx=_server_ctx,
                )
        except Exception:
            _risk_result = None   # fail open

    if _risk_result is not None and _feat("RISK_GATE"):
        if _risk_result.blocked:
            raise HTTPException(status_code=403, detail={
                "error": "risk_blocked",
                "classification": _risk_result.classification,
                "message": "Access denied: automated activity detected.",
            })
        # Adaptive minimum gesture duration
        _min_gesture_ms = _risk_result.gesture_min_s * 1000

    # Apply gesture duration minimum (after risk gate adjustment)
    if gesture_duration_ms is not None and gesture_duration_ms < _min_gesture_ms:
        raise HTTPException(status_code=400, detail={
            "error": "gesture_too_short",
            "message": f"Gesture must last at least {_min_gesture_ms // 1000} seconds.",
        })

    # ── [Security D] Challenge-response validation ────────────────────────────
    # Normalise: new multi-challenge array takes priority, legacy single falls back
    challenge_list = body.challenges or ([body.challenge] if body.challenge else [])
    challenge_anomalies: list[str] = []
    for idx, ch in enumerate(challenge_list):
        tag = f"[{idx}]" if len(challenge_list) > 1 else ""
        if ch.reaction_ms is None:
            challenge_anomalies.append(f"challenge_missed{tag}")
        elif ch.reaction_ms < 80:
            challenge_anomalies.append(f"challenge_too_fast{tag}")
            challenge_anomalies.append(f"reaction_ms:{ch.reaction_ms}")
        elif ch.reaction_ms > 2000:
            challenge_anomalies.append(f"challenge_too_slow{tag}")
        else:
            if ch.tap_x is not None and ch.tap_y is not None:
                dist = ((ch.tap_x - ch.dot_x) ** 2 + (ch.tap_y - ch.dot_y) ** 2) ** 0.5
                if dist > 0.15:
                    challenge_anomalies.append(f"challenge_tap_too_far{tag}")

    # ── [Sybil Protection C] Device fingerprint rate-limit ────────────────────
    if body.fp_hash:
        fp_store = getattr(request.app.state, "fp_store", None)
        if fp_store:
            fp_result = fp_store.check_and_record(
                fp_hash=body.fp_hash,
                did_hash_short="pending",
            )
            if not fp_result.allowed:
                import datetime
                next_dt = datetime.datetime.utcfromtimestamp(
                    fp_result.next_allowed_at
                ).strftime("%Y-%m-%d") if fp_result.next_allowed_at else "N/A"
                raise HTTPException(
                    status_code=429,
                    detail={
                        "error": "verification_rate_limit",
                        "message": (
                            f"Too many verifications from this device "
                            f"({fp_result.count}/{fp_result.limit} "
                            f"in {fp_result.window_days} days). "
                            f"Next allowed: {next_dt}"
                        ),
                        "next_allowed_at": fp_result.next_allowed_at,
                        "count": fp_result.count,
                        "limit": fp_result.limit,
                    },
                )

    # Конвертируем DTO
    pattern_debug = {}
    try:
        from sapix.expression_engine import TouchEvent, PatternExtractor
        events = [
            TouchEvent(x=e.x, y=e.y, pressure=e.pressure,
                      timestamp_ms=e.timestamp_ms, pause_after_ms=e.pause_after_ms)
            for e in body.events
        ]
        # Extract pattern for debug BEFORE sending to AI
        extractor = PatternExtractor()
        pattern = extractor.extract(events)
        pattern_debug = {
            "velocity_std": round(pattern.velocity_std, 4),
            "velocity_mean": round(pattern.velocity_mean, 4),
            "pause_entropy": round(pattern.pause_entropy, 4),
            "correction_count": pattern.correction_count,
            "rhythm_irregularity": round(pattern.rhythm_irregularity, 4),
            "total_duration_ms": pattern.total_duration_ms,
            "point_count": pattern.point_count,
            "possible_motor_difficulty": pattern.possible_motor_difficulty,
        }
        result = await gonka.expression.verify(events, session_id=session_id)
    except Exception as exc:
        class _R:
            is_human = True
            confidence = 0.5
            passed = True
            reasoning = f"Gonka unavailable: {exc}"
            expression_proof = f"stub_{session_id[:8]}"
            via_fallback = True
            anomalies = []
            analysis_latency_ms = 0
        result = _R()

    # Merge challenge anomalies into result
    all_anomalies = list(getattr(result, "anomalies", [])) + challenge_anomalies
    # If challenge was present and critically failed → force fail
    critical_challenge_fail = bool(challenge_list) and any(
        any(a.startswith(bad) for bad in ("challenge_too_fast", "challenge_missed"))
        for a in challenge_anomalies
    )

    # Save debug record
    _save_attempt({
        "ts": time.time(),
        "session_id": session_id,
        "passed": result.passed,
        "is_human": result.is_human,
        "confidence": round(result.confidence, 3),
        "via_fallback": result.via_fallback,
        "reasoning": result.reasoning,
        "anomalies": all_anomalies,
        "challenge": {
            "present":     bool(challenge_list),
            "count":       len(challenge_list),
            "reaction_ms": challenge_list[0].reaction_ms if challenge_list else None,
            "anomalies":   challenge_anomalies,
        },
        "latency_ms": round(getattr(result, "analysis_latency_ms", 0)),
        "pattern": pattern_debug,
        "event_count": len(body.events),
        "ip": client_ip,
    })

    if not result.passed or critical_challenge_fail:
        # Record failure for cooldown tracking
        if rl:
            await rl.record_verify_failure(client_ip)
        _dbf = getattr(request.app.state, "db", None)
        if _dbf:
            try: await _dbf.log_verification(False)
            except Exception: pass
        reason = result.reasoning
        if critical_challenge_fail:
            reason = "Challenge-response failed: " + ", ".join(challenge_anomalies)
        return VerifyResponse(
            is_human=False if critical_challenge_fail else result.is_human,
            confidence_band="low",
            passed=False,
            reasoning=reason,
            via_fallback=result.via_fallback,
            anomalies=all_anomalies,
            debug=pattern_debug,
        )

    # Генерируем did:key (заменяет Ceramic — никаких нод)
    did_key = DIDKey.generate()

    # Обновляем did_hash_short в fingerprint-записи (была "pending")
    if body.fp_hash:
        fp_store = getattr(request.app.state, "fp_store", None)
        if fp_store:
            from services.did_key import did_hash as _did_hash
            fp_store.update_did_hash(body.fp_hash, _did_hash(did_key.did)[:12])

    # Создаём credential
    credential = create_human_credential(
        subject_did=did_key.did,
        expression_proof=result.expression_proof or "",
        bond_count=0,
        issuer_did="did:key:aptogon-network",
    )

    # Подписываем DID-ключом
    signed_credential = did_key.sign_credential(credential)

    # Записываем в Aptos
    tx_result = await aptos.issue_credential(
        address=did_key.did,
        did_hash=did_hash(did_key.did),
        expression_proof=result.expression_proof or "",
        bond_count=0,
    )

    # ── Сохраняем в PostgreSQL (персистентно, не только в памяти) ────────────
    db = getattr(request.app.state, "db", None)
    if db:
        await db.save_credential(
            did=did_key.did,
            did_hash=did_hash(did_key.did),
            expression_proof=result.expression_proof or "",
            bond_count=0,
            trust_score=0.1,
            trust_label="newcomer",
            tx_hash=tx_result.get("tx_hash"),
        )

        # ── Auto-replace admin DID if same device re-verified ─────────────────
        # If this device's fp_hash matches an existing admin row → swap DID silently
        if body.fp_hash:
            old_short = await db.replace_admin_did_by_fp_hash(
                fp_hash=body.fp_hash,
                new_did_short=did_key.did[-8:],
                new_did_full=did_key.did,
            )
            if old_short:
                import logging
                logging.getLogger("aptogon").info(
                    "Admin DID auto-replaced: %s → %s (fp_hash match)",
                    old_short, did_key.did[-8:],
                )

    if db:
        try: await db.log_verification(True)
        except Exception: pass

    # Reset failure counter on success
    if rl:
        await rl.reset_verify_failures(client_ip)

    # ── [R2] Record risk event (post-gesture, with challenge anomalies) ────────
    if _feat("STATS_COLLECT"):
        try:
            import hashlib as _hl
            risk_engine = getattr(request.app.state, "risk_engine", None)
            if risk_engine:
                _server_ctx_post = {
                    "client_ip": client_ip,
                    "challenge_anomalies": all_anomalies,
                    "ip_rate_limit": False,
                    "fp_rate_limit": False,
                    "gesture_duration_ms": gesture_duration_ms,
                }
                _post_result = risk_engine.assess(
                    client_signals={},
                    server_ctx=_server_ctx_post,
                )
                _sess_hash = _hl.sha256(session_id.encode()).hexdigest()[:32]
                _db = getattr(request.app.state, "db", None)
                if _db:
                    await _db.record_risk_event(
                        session_hash=_sess_hash,
                        risk_score=_post_result.score,
                        classification=_post_result.classification,
                        signals=_post_result.signals,
                        outcome="passed",
                    )
        except Exception:
            pass   # stats collection never blocks verification

    return VerifyResponse(
        is_human=True,
        confidence_band=_confidence_band(result.confidence),
        passed=True,
        reasoning=result.reasoning,
        via_fallback=result.via_fallback,
        anomalies=all_anomalies,
        did=did_key.did,
        private_key_b64=did_key.export_private(),
        expression_proof=result.expression_proof,
        tx_hash=tx_result.get("tx_hash"),
        credential=signed_credential,
        trust_score=0.1,
        trust_label="newcomer",
        debug=pattern_debug,
    )


@router.get("/status")
async def verify_status(request: Request, did: str = ""):
    """
    Проверить статус верификации для DID.
    DID берётся из Bearer JWT (предпочтительно) или из query param ?did=...
    Возвращает trust_score и trust_label из БД — клиенту нельзя доверять.
    """
    # Prefer JWT-authenticated DID (set by firewall middleware)
    auth_did = getattr(request.state, "did", None)
    if not auth_did:
        from routers.auth import decode_jwt
        auth_hdr = request.headers.get("Authorization", "")
        if auth_hdr.startswith("Bearer "):
            try:
                payload = decode_jwt(auth_hdr[7:])
                auth_did = payload.get("did") or payload.get("sub") if payload else None
            except Exception:
                pass
    resolved_did = auth_did or did
    if not resolved_did:
        return {"did": None, "is_human": False}

    aptos  = request.app.state.aptos
    db     = request.app.state.db
    is_human   = await aptos.is_human(resolved_did)
    credential = await aptos.get_credential(resolved_did)
    db_cred    = await db.get_credential(resolved_did) if db else None

    return {
        "did":         resolved_did,
        "is_human":    is_human,
        "valid_until": credential.valid_until if credential else None,
        "bond_count":  credential.bond_count  if credential else 0,
        "trust_score": float(db_cred["trust_score"]) if db_cred else 0.1,
        "trust_label": str(db_cred["trust_label"])   if db_cred else "newcomer",
    }


@router.get("/debug")
async def debug_attempts(last: int = 20):
    """Последние N попыток верификации — для отладки механизма."""
    if not _DEBUG_LOG.exists():
        return {"attempts": [], "total": 0}
    lines = _DEBUG_LOG.read_text().strip().splitlines()
    attempts = [json.loads(l) for l in lines[-last:]]
    attempts.reverse()
    return {
        "total": len(lines),
        "showing": len(attempts),
        "attempts": attempts,
    }


@router.get("/credentials")
async def list_credentials(
    request: Request,
    only_valid: bool = True,
    gold_only: bool = False,
    limit: int = 100,
):
    """
    Список всех верифицированных DID из PostgreSQL.
    Используется для выбора Gold Members. Требует ADMIN_TOKEN.
    """
    _check_admin(request)
    db = getattr(request.app.state, "db", None)
    if not db:
        raise HTTPException(status_code=503, detail="DB not available")
    creds = await db.list_credentials(only_valid=only_valid, gold_only=gold_only, limit=limit)
    return {
        "count": len(creds),
        "credentials": [
            {
                "did": c["did"],
                "trust_score": c["trust_score"],
                "trust_label": c["trust_label"],
                "bond_count": c["bond_count"],
                "gold_member": c.get("gold_member", False),
                "issued_at": c["issued_at"],
                "valid_until": c["valid_until"],
            }
            for c in creds
        ],
    }


@router.post("/credentials/{did}/gold")
async def set_gold_member(did: str, request: Request, gold: bool = True):
    """Повысить/понизить DID до/с Gold Member статуса. Требует ADMIN_TOKEN."""
    _check_admin(request)
    db = getattr(request.app.state, "db", None)
    if not db:
        raise HTTPException(status_code=503, detail="DB not available")
    ok = await db.set_gold_member(did, gold)
    if not ok:
        raise HTTPException(status_code=404, detail="DID not found in credentials table")
    return {"did": did, "gold_member": gold, "status": "updated"}


@router.post("/did")
async def create_did():
    """
    Создать did:key без верификации (для тестов и разработки).
    В production использовать /expression.
    """
    did_key = DIDKey.generate()
    return {
        "did": did_key.did,
        "private_key_b64": did_key.export_private(),
        "note": "Store private_key_b64 securely — it cannot be recovered",
    }
