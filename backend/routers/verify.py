"""
/api/verify — верификация + did:key выдача.

POST /api/verify/expression   → анализ жеста, выдача did:key + credential
GET  /api/verify/status       → статус по DID
POST /api/verify/did          → создать did:key (без верификации, для тестов)
GET  /api/verify/debug        → последние попытки верификации (для отладки)
"""

import asyncio
import hashlib
import json
import os
import random
import secrets
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
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
from services.device_fingerprint import categorize_device_hint

router = APIRouter()

_CHALLENGE_TOKEN_TTL = 120  # seconds — challenge dot expires after 2 min


def _get_redis(request: Request):
    rl = getattr(request.app.state, "rate_limiter", None)
    return getattr(rl, "_redis", None) if rl else None


class TouchEventDTO(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    pressure: float = Field(0.5, ge=0.0, le=1.0)
    timestamp_ms: int
    pause_after_ms: int = 0


class ChallengeDTO(BaseModel):
    # [Security E] Server-issued token path (secure): server stores dot coords,
    # client sends token back — prevents bot from fabricating challenge coordinates.
    challenge_token: Optional[str] = None
    # Legacy client-provided coords (backward compat when no token is used).
    dot_x:       Optional[float] = Field(None, ge=0.0, le=1.0)
    dot_y:       Optional[float] = Field(None, ge=0.0, le=1.0)
    shown_at_ms: int
    reaction_ms: Optional[int] = None   # null = missed
    tap_x:       Optional[float] = None
    tap_y:       Optional[float] = None
    color:       Optional[str]  = None  # dot color label


class BrowserFingerprintDTO(BaseModel):
    """Raw browser fingerprint signals collected before gesture capture.
    Used for logging + hard webdriver block. Never stored with PII."""
    webgl_vendor:         Optional[str]   = None
    webgl_renderer:       Optional[str]   = None
    audio_hash:           Optional[str]   = None
    hardware_concurrency: Optional[int]   = None
    device_memory:        Optional[float] = None
    timezone_offset:      Optional[int]   = None
    touch_points:         Optional[int]   = None
    webdriver:            bool            = False
    color_depth:          Optional[int]   = None
    pixel_ratio:          Optional[float] = None


class ExpressionRequest(BaseModel):
    events: list[TouchEventDTO] = Field(..., min_length=10)  # min 10 points
    session_id: Optional[str] = None
    fp_hash: Optional[str] = Field(None, min_length=16, max_length=128,
                                   description="SHA-256 device fingerprint hash (64 hex chars)")
    challenge:  Optional[ChallengeDTO]       = None   # legacy single challenge
    challenges: Optional[list[ChallengeDTO]] = None   # multi-challenge (1-3 dots)
    # [Security F2] Client-side automation signals forwarded by the frontend.
    # When present, these are passed to risk_engine.assess() so webdriver/headless
    # signals actually influence the credential gate (not just the stats endpoint).
    client_signals: Optional[dict] = None
    # [Security G] Pre-gesture browser fingerprint — raw device signals.
    # webdriver=True triggers an immediate hard block before any AI inference.
    browser_fp: Optional[BrowserFingerprintDTO] = None
    # Shielded Human: "public" (default) keeps device-fingerprint binding + reputation;
    # "shielded" issues an anonymity-first credential — no fp→DID binding, no device
    # lock, starts (and in phase 1 stays) at newcomer trust. Any other value → public.
    mode: str = "public"
    # Renewal: refresh the credential on an EXISTING DID instead of minting a new
    # one. Credentials last 30 days; without this, expiry silently orphaned
    # everything keyed to the DID — console API keys, the verified email, declared
    # handles, trust score. Humanness is still re-proven by the gesture; only the
    # identity is carried over, and only to a caller who can sign a fresh nonce
    # with that DID's private key (the same proof /api/auth/session demands).
    renew_did:       Optional[str] = None
    renew_nonce:     Optional[str] = None
    renew_signature: Optional[str] = None


def _expose_debug(pattern_debug: dict) -> Optional[dict]:
    """Feature values reach the client only when an operator opts in.

    The response already hides exact confidence behind a band to resist model
    extraction; shipping the full feature vector *with its thresholds* handed
    that back and more — it reads as a checklist for making a bot look human.
    Off unless EXPOSE_VERIFY_DEBUG is set, so production tells an attacker
    nothing about how the decision was reached.
    """
    if os.getenv("EXPOSE_VERIFY_DEBUG", "").lower() in ("1", "true", "yes", "on"):
        return pattern_debug
    return None


def _confidence_band(c: float) -> str:
    """Obfuscate exact confidence — return band only (prevents model extraction)."""
    if c >= 0.90: return "high"
    if c >= 0.78: return "medium"
    return "low"


def _analyze_fp(fp: "BrowserFingerprintDTO") -> tuple[dict, list[str]]:
    """Analyze browser fingerprint — returns (signals_dict, soft_anomalies).
    Soft anomalies inform scoring but never block alone."""
    anomalies: list[str] = []
    if fp.webgl_vendor is None:
        anomalies.append("fp:no_webgl")
    if fp.audio_hash is None:
        anomalies.append("fp:no_audio")
    if fp.hardware_concurrency is not None and fp.hardware_concurrency <= 1:
        anomalies.append("fp:low_cpu")
    if fp.device_memory is not None and fp.device_memory < 0.5:
        anomalies.append("fp:low_memory")
    signals: dict = {
        "webdriver":            fp.webdriver,
        "webgl_vendor":         fp.webgl_vendor,
        "webgl_renderer":       fp.webgl_renderer,
        "audio_hash":           fp.audio_hash,
        "hardware_concurrency": fp.hardware_concurrency,
        "device_memory":        fp.device_memory,
        "touch_points":         fp.touch_points,
        "color_depth":          fp.color_depth,
        "pixel_ratio":          fp.pixel_ratio,
        "timezone_offset":      fp.timezone_offset,
        "anomalies":            anomalies,
    }
    return signals, anomalies


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
    # Browser fingerprint summary (signals received + soft anomalies)
    fp_signals: Optional[dict] = None


@router.post("/expression", response_model=VerifyResponse)
async def verify_expression(body: ExpressionRequest, request: Request):
    """
    Полный флоу верификации:
    1. SapiX анализирует жест
    2. При успехе — генерируется did:key (W3C стандарт, без Ceramic)
    3. Credential записывается в Aptos

    Ответ содержит did + private_key_b64 — фронтенд сохраняет в localStorage.
    """
    session_id = body.session_id or str(uuid.uuid4())
    # Shielded Human: anonymity-first credential — no device-fingerprint binding,
    # no device lock. Any unrecognised mode falls back to the safe "public" path.
    shielded = (body.mode == "shielded")

    # ── [Security] Get real client IP ─────────────────────────────────────────
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "unknown")
    )

    # ── [Security G] Hard webdriver block — no app state needed ──────────────
    # browser_fp.webdriver signals the client is running under automation.
    # Block immediately before any AI inference or credential issuance.
    if body.browser_fp and body.browser_fp.webdriver:
        import logging as _log
        _log.getLogger("aptogon.security").warning(
            "verify: automation_detected webdriver=True ip_hash=%s",
            hashlib.sha256(client_ip.encode()).hexdigest()[:16],
        )
        return VerifyResponse(
            is_human=False,
            confidence_band="low",
            passed=False,
            reasoning="automation_detected: webdriver flag is set.",
            anomalies=["webdriver"],
        )

    # ── [Security G+] Soft browser fingerprint analysis ──────────────────────
    fp_signals: dict = {}
    fp_soft_anomalies: list[str] = []
    if body.browser_fp:
        fp_signals, fp_soft_anomalies = _analyze_fp(body.browser_fp)

    # gonka / aptos accessed only after early security checks
    gonka = request.app.state.gonka
    aptos = request.app.state.aptos

    # ── [Security A] IP-based rate limiting (prevents model extraction) ───────
    rl = getattr(request.app.state, "rate_limiter", None)
    if rl:
        allowed, reason = await rl.check_verify_ip(client_ip)
        if not allowed:
            raise HTTPException(status_code=429, detail={
                "error": "rate_limit_exceeded",
                "message": reason,
            })

    # ── [Security A2] Sybil / fingerprint-rotation detection ──────────────────
    if rl and body.fp_hash:
        sybil_ok, sybil_reason = await rl.check_verify_sybil(client_ip, body.fp_hash)
        if not sybil_ok:
            raise HTTPException(status_code=429, detail={
                "error": "sybil_detected",
                "message": sybil_reason,
            })

    # ── Renewal: refresh an existing DID rather than mint a new one ─────────────
    # Requires signing a fresh single-use nonce with that DID's private key — the
    # same proof /api/auth/session demands, so this can only ever refresh an
    # identity the caller already holds and can never manufacture a new one.
    renew_did: Optional[str] = None
    if body.renew_did or body.renew_nonce or body.renew_signature:
        if not (body.renew_did and body.renew_nonce and body.renew_signature):
            raise HTTPException(status_code=400, detail={
                "error": "incomplete_renewal",
                "message": "renew_did, renew_nonce and renew_signature must be sent together.",
            })
        if not body.renew_did.startswith("did:key:z"):
            raise HTTPException(status_code=400, detail={"error": "invalid_did"})
        from routers.auth import _consume_nonce, _get_redis as _auth_redis
        if not await _consume_nonce(_auth_redis(request), body.renew_nonce):
            raise HTTPException(status_code=401, detail={
                "error": "invalid_nonce",
                "message": "Challenge nonce expired or already used.",
            })
        try:
            nonce_bytes = bytes.fromhex(body.renew_nonce)
        except ValueError:
            raise HTTPException(status_code=400, detail={"error": "invalid_nonce_format"})
        if not DIDKey.verify(body.renew_did, nonce_bytes, body.renew_signature):
            raise HTTPException(status_code=403, detail={
                "error": "invalid_signature",
                "message": "You must hold the private key for the DID you are renewing.",
            })
        renew_did = body.renew_did

    # ── [Security A3] FP-hash binding — one DID per device fingerprint ───────────
    # Shielded mode opts out of device binding (the lock is itself a deanon vector
    # and blocks legitimate DID rotation).
    # A proven renewal is exempt: it refreshes an identity the caller already owns,
    # so it cannot be a Sybil attempt — and blocking it is exactly what stranded
    # people once their 30-day credential lapsed.
    _db_early = getattr(request.app.state, "db", None)
    if body.fp_hash and _db_early and not shielded and not renew_did:
        if await _db_early.fp_has_credential(body.fp_hash):
            raise HTTPException(status_code=409, detail={
                "error": "device_already_verified",
                "message": (
                    "This device has already received a credential. "
                    "Each device fingerprint may only hold one DID."
                ),
            })

    # ── [Security B] Session ID replay protection ──────────────────────────────
    # [Fix 4] Always check when session_id is client-supplied (not server-generated).
    # Server-generated UUIDs are always fresh; client-supplied ones must be single-use.
    if rl and body.session_id:
        fresh = await rl.check_session_id(body.session_id)
        if not fresh:
            raise HTTPException(status_code=400, detail={
                "error": "session_replayed",
                "message": "session_id already used. Generate a new UUID for each verification.",
            })
    elif not body.session_id:
        import logging as _logging
        _logging.getLogger("aptogon.security").debug(
            "verify: no client session_id provided — server-generated UUID used (no replay guard)"
        )

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
                # [Fix 2] Pass client_signals from request body so webdriver/headless
                # overrides actually fire instead of always seeing empty {}.
                _risk_result = risk_engine.assess(
                    client_signals=body.client_signals or {},
                    server_ctx=_server_ctx,
                )
        except Exception:
            _risk_result = None   # fail open

    if _risk_result is not None and _feat("RISK_GATE"):
        if _risk_result.blocked:
            try:
                _db_blk = getattr(request.app.state, "db", None)
                if _db_blk and client_ip:
                    _ip_h = hashlib.sha256(client_ip.encode()).hexdigest()[:32]
                    _blk_asn = "unknown"
                    if _feat("ASN_CLASSIFICATION") and client_ip not in ("unknown", "localhost", "127.0.0.1", "::1"):
                        try:
                            from services.asn_classifier import classify_ip as _clf
                            _blk_asn = await _clf(client_ip)
                        except Exception:
                            pass
                    await _db_blk.log_ip_audit(
                        ip_addr=client_ip,
                        ip_hash=_ip_h,
                        classification=_risk_result.classification,
                        outcome="blocked",
                        asn_type=_blk_asn,
                    )
            except Exception:
                pass
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
    _redis = _get_redis(request)
    for idx, ch in enumerate(challenge_list):
        tag = f"[{idx}]" if len(challenge_list) > 1 else ""

        # [Security E] Resolve actual dot coordinates.
        # Secure path: challenge_token issued by /challenge-token, coords stored in Redis.
        # Legacy path: client-provided dot_x/dot_y (trusted only if no token).
        actual_dot_x, actual_dot_y = ch.dot_x, ch.dot_y
        if ch.challenge_token:
            resolved = False
            if _redis:
                try:
                    stored = await _redis.get(f"chal:{ch.challenge_token}")
                    if stored:
                        await _redis.delete(f"chal:{ch.challenge_token}")  # one-shot
                        sx, sy = (stored.decode() if isinstance(stored, bytes) else stored).split(",")
                        actual_dot_x, actual_dot_y = float(sx), float(sy)
                        resolved = True
                except Exception:
                    pass
            if not resolved:
                challenge_anomalies.append(f"invalid_challenge_token{tag}")
                continue

        if ch.reaction_ms is None:
            challenge_anomalies.append(f"challenge_missed{tag}")
        elif ch.reaction_ms < 80:
            challenge_anomalies.append(f"challenge_too_fast{tag}")
            challenge_anomalies.append(f"reaction_ms:{ch.reaction_ms}")
        elif ch.reaction_ms > 2000:
            challenge_anomalies.append(f"challenge_too_slow{tag}")
        else:
            if (ch.tap_x is not None and ch.tap_y is not None
                    and actual_dot_x is not None and actual_dot_y is not None):
                dist = ((ch.tap_x - actual_dot_x) ** 2 + (ch.tap_y - actual_dot_y) ** 2) ** 0.5
                if dist > 0.15:
                    challenge_anomalies.append(f"challenge_tap_too_far{tag}")

    # ── [Sybil Protection C] Device fingerprint rate-limit ────────────────────
    # Shielded mode does not persist the device fingerprint at all (no fp record);
    # its Sybil defence is the trust-ramp (starts newcomer) + ephemeral IP limits.
    if body.fp_hash and not shielded:
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
            "velocity_curvature_r": round(pattern.velocity_curvature_r, 4),
            "total_duration_ms": pattern.total_duration_ms,
            "point_count": pattern.point_count,
            "possible_motor_difficulty": pattern.possible_motor_difficulty,
            "lift_count": pattern.lift_count,
            "total_lift_ms": pattern.total_lift_ms,
        }
        # Gray-zone: in active mode the local GBM decides CONFIDENT cases and skips
        # the LLM entirely (no provider latency / 503). Uncertain → fall through to
        # the LLM below. verify_local never raises and returns None when unsure.
        result = None
        if os.getenv("ML_CLASSIFIER_MODE", "off").lower() == "active":
            _clf = getattr(request.app.state, "ml_classifier", None)
            if _clf is not None and getattr(_clf, "available", False):
                result = gonka.expression.verify_local(
                    events, session_id, _clf,
                    float(os.getenv("ML_CONFIDENT_HIGH", "0.85")),
                    float(os.getenv("ML_CONFIDENT_LOW", "0.15")),
                )
        if result is None:
            result = await gonka.expression.verify(events, session_id=session_id)
    except Exception as exc:
        # [Fix 1] Fail CLOSED: never issue a credential when the AI classifier
        # is unavailable. An open fallback (passed=True) allows complete bypass
        # by sending any malformed payload that crashes Gonka.
        import logging as _log
        _log.getLogger("aptogon.security").error(
            "Gonka classifier unavailable — verification rejected: %s", exc
        )
        raise HTTPException(status_code=503, detail={
            "error": "classifier_unavailable",
            "message": "Human verification service is temporarily unavailable. Please try again.",
        })

    # Merge challenge anomalies + soft fingerprint anomalies into result
    all_anomalies = list(getattr(result, "anomalies", [])) + challenge_anomalies + fp_soft_anomalies
    # If challenge was present and critically failed → force fail
    critical_challenge_fail = bool(challenge_list) and any(
        any(a.startswith(bad) for bad in (
            "challenge_too_fast", "challenge_missed", "invalid_challenge_token"
        ))
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

    # Local GBM shadow prediction — runs alongside the LLM but does NOT affect the
    # decision (shadow/active mode only). Logged next to `passed` to measure
    # agreement before the classifier is ever promoted to decide anything.
    _ml_pred = _ml_conf = _ml_ver = None
    if os.getenv("ML_CLASSIFIER_MODE", "off").lower() in ("shadow", "active"):
        _clf = getattr(request.app.state, "ml_classifier", None)
        if _clf is not None:
            try:
                _mlres = _clf.classify(pattern)
                if _mlres is not None:
                    _ml_pred = bool(_mlres.is_human)
                    _ml_conf = round(float(_mlres.confidence), 4)
                    _ml_ver = _mlres.model_version
            except Exception:
                pass

    # Log anonymized gesture pattern for Gesture Research calibration
    _db_gm = getattr(request.app.state, "db", None)
    if _db_gm and pattern_debug:
        try:
            await _db_gm.log_gesture_metrics(
                passed=bool(result.passed and not critical_challenge_fail),
                via_fallback=result.via_fallback,
                rhythm_irregularity=pattern_debug.get("rhythm_irregularity"),
                correction_count=pattern_debug.get("correction_count"),
                velocity_std=pattern_debug.get("velocity_std"),
                velocity_mean=pattern_debug.get("velocity_mean"),
                velocity_curvature_r=pattern_debug.get("velocity_curvature_r"),
                pause_entropy=pattern_debug.get("pause_entropy"),
                point_count=pattern_debug.get("point_count"),
                duration_ms=pattern_debug.get("total_duration_ms"),
                device_hint=categorize_device_hint(request.headers.get("User-Agent")) if request else None,
                ml_pred=_ml_pred,
                ml_confidence=_ml_conf,
                ml_model_version=_ml_ver,
                possible_motor_difficulty=pattern_debug.get("possible_motor_difficulty"),
                lift_count=pattern_debug.get("lift_count"),
                total_lift_ms=pattern_debug.get("total_lift_ms"),
            )
        except Exception:
            pass

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
            debug=_expose_debug(pattern_debug),
            fp_signals=fp_signals or None,
        )

    # Генерируем did:key (заменяет Ceramic — никаких нод)
    # A renewal keeps the caller's existing identity (ownership already proven by
    # signature above); only a fresh verification mints a keypair. The server
    # never holds the private key of a renewed DID — the client keeps it.
    _db_prior = getattr(request.app.state, "db", None)
    prior_cred = await _db_prior.get_credential(renew_did) if (renew_did and _db_prior) else None
    if renew_did:
        did_key = None
        subject_did = renew_did
    else:
        did_key = DIDKey.generate()
        subject_did = did_key.did

    # Renewal must not demote the holder: save_credential's upsert overwrites
    # these columns, so carry the earned values forward instead of resetting to
    # newcomer and wiping bonds / gold status.
    carry_bonds = int(prior_cred.get("bond_count", 0) or 0) if prior_cred else 0
    carry_score = float(prior_cred.get("trust_score", 0.1) or 0.1) if prior_cred else 0.1
    carry_label = (prior_cred.get("trust_label") or "newcomer") if prior_cred else "newcomer"
    carry_gold  = bool(prior_cred.get("gold_member", False)) if prior_cred else False
    # Shielded is a deliberate choice; renewing must not silently flip it.
    carry_mode  = (prior_cred.get("mode") or "public") if prior_cred else ("shielded" if shielded else "public")

    # Обновляем did_hash_short в fingerprint-записи (была "pending")
    if body.fp_hash and not shielded:
        fp_store = getattr(request.app.state, "fp_store", None)
        if fp_store:
            from services.did_key import did_hash as _did_hash
            fp_store.update_did_hash(body.fp_hash, _did_hash(subject_did)[:12])

    # Создаём credential
    credential = create_human_credential(
        subject_did=subject_did,
        expression_proof=result.expression_proof or "",
        bond_count=carry_bonds,
        issuer_did="did:key:aptogon-network",
    )

    # Подписываем DID-ключом. On a renewal the server has no private key for this
    # DID, so the credential goes back unsigned rather than carrying a fabricated
    # proof — nothing reads `proof` today (validity comes from human_credentials
    # and the on-chain record), and inventing one would be a lie in the data.
    signed_credential = did_key.sign_credential(credential) if did_key else credential

    # Записываем в Aptos
    tx_result = await aptos.issue_credential(
        address=subject_did,
        did_hash=did_hash(subject_did),
        expression_proof=result.expression_proof or "",
        bond_count=0,
    )

    # ── Сохраняем в PostgreSQL (персистентно, не только в памяти) ────────────
    db = getattr(request.app.state, "db", None)
    if db:
        await db.save_credential(
            did=subject_did,
            did_hash=did_hash(subject_did),
            expression_proof=result.expression_proof or "",
            bond_count=carry_bonds,
            trust_score=carry_score,
            trust_label=carry_label,
            tx_hash=tx_result.get("tx_hash"),
            gold_member=carry_gold,
            mode=carry_mode,
        )

        # [Fix 3] fp_hash → admin auto-promotion REMOVED.
        # Previously a client-supplied fp_hash matching an admin row would silently
        # transfer admin privileges to the newly verified DID — privilege escalation
        # via fingerprint guessing. Admin DID changes must go through the explicit
        # POST /api/admin/dids endpoint (requires active admin JWT).

        # [Security A3] Bind this device fingerprint to the issued DID.
        # Future verification attempts with the same fp_hash will be rejected (409).
        # Shielded mode skips this binding entirely — no fp→DID record is stored.
        if body.fp_hash and not shielded:
            try:
                from services.did_key import did_hash as _did_hash
                await db.fp_mark_verified(body.fp_hash, _did_hash(subject_did)[:12])
            except Exception:
                pass

    if db:
        try: await db.log_verification(True)
        except Exception: pass

        # [B] Ensure every verified device belongs to a person (account aggregate).
        # If this device is later QR-linked to another, claim_pairing reassigns it.
        # Shielded mode stays out of cross-device person aggregation (unlinkability).
        if _feat("DEVICE_ACCOUNTS") and not shielded:
            try: await db.ensure_person_for_did(subject_did, is_primary=True)
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
                    client_signals=body.client_signals or {},
                    server_ctx=_server_ctx_post,
                )
                _sess_hash = _hl.sha256(session_id.encode()).hexdigest()[:32]
                _ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()[:32] if client_ip else None
                # [ASN] Classify IP origin type when flag is enabled (fail-open)
                _asn_type: str = "unknown"
                if _feat("ASN_CLASSIFICATION") and client_ip and client_ip != "unknown":
                    try:
                        from services.asn_classifier import classify_ip as _classify_ip
                        _asn_type = await _classify_ip(client_ip)
                    except Exception:
                        pass
                _db = getattr(request.app.state, "db", None)
                if _db:
                    await _db.record_risk_event(
                        session_hash=_sess_hash,
                        risk_score=_post_result.score,
                        classification=_post_result.classification,
                        signals=_post_result.signals,
                        outcome="passed",
                        ip_hash=_ip_hash,
                        asn_type=_asn_type,
                    )
                    await _db.log_ip_audit(
                        ip_addr=client_ip or "",
                        ip_hash=_ip_hash or "",
                        classification=_post_result.classification,
                        outcome="passed",
                        session_hash=_sess_hash,
                        asn_type=_asn_type,
                        ai_provider=getattr(result, "provider", "") or "",
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
        did=subject_did,
        # Only a freshly minted DID ships a private key. On a renewal the client
        # already holds it — and it must never travel the wire a second time.
        private_key_b64=did_key.export_private() if did_key else None,
        expression_proof=result.expression_proof,
        tx_hash=tx_result.get("tx_hash"),
        credential=signed_credential,
        trust_score=carry_score,
        trust_label=carry_label,
        debug=_expose_debug(pattern_debug),
        fp_signals=fp_signals or None,
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


@router.post("/challenge-token")
async def issue_challenge_token(request: Request):
    """
    [Security E] Issue a server-generated challenge dot.

    Returns a one-shot token (TTL 120s) and the dot coordinates to display.
    The client must pass challenge_token in ChallengeDTO when submitting /expression.
    This prevents bots from fabricating challenge coordinates client-side.
    """
    token = secrets.token_urlsafe(32)
    dot_x = round(random.uniform(0.1, 0.9), 4)
    dot_y = round(random.uniform(0.1, 0.9), 4)
    redis = _get_redis(request)
    if redis:
        try:
            await redis.set(f"chal:{token}", f"{dot_x},{dot_y}", ex=_CHALLENGE_TOKEN_TTL)
        except Exception:
            pass
    return {"challenge_token": token, "dot_x": dot_x, "dot_y": dot_y}


@router.get("/challenge-stream")
async def challenge_stream(request: Request):
    """
    [Security Phase 3] SSE endpoint — server pushes challenge dot mid-gesture.

    Extension connects when user starts gesture. After a random delay (2.5–4.5s)
    the server sends a one-shot challenge token + dot coordinates over SSE.
    The extension displays the dot and includes challenge_token in ChallengeDTO
    when submitting /expression.

    Flow:
      1. Extension opens SSE connection at gesture start
      2. Server waits 1.5–3.0s (random, unpredictable)
      3. Server generates token + dot coords → stores in Redis (TTL 120s)
      4. Server sends SSE event: {"challenge_token": ..., "dot_x": ..., "dot_y": ...}
      5. Extension shows dot, user taps, gesture ends
      6. Extension submits /expression with challenge_token in challenges[]
    """
    delay = random.uniform(1.5, 3.0)
    token = secrets.token_urlsafe(32)
    dot_x = round(random.uniform(0.1, 0.9), 4)
    dot_y = round(random.uniform(0.1, 0.9), 4)

    async def _event_stream():
        # Send keepalive immediately so client knows connection is live
        yield "event: connected\ndata: {}\n\n"
        await asyncio.sleep(delay)
        # Store coords in Redis (one-shot — deleted when /expression resolves it)
        redis = _get_redis(request)
        if redis:
            try:
                await redis.set(f"chal:{token}", f"{dot_x},{dot_y}", ex=_CHALLENGE_TOKEN_TTL)
            except Exception:
                pass
        payload = json.dumps({"challenge_token": token, "dot_x": dot_x, "dot_y": dot_y})
        yield f"event: challenge\ndata: {payload}\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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
