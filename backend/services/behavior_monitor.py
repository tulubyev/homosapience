"""
APTOGON Behavior Monitor — post-verification anomaly detection.

Tracks DID activity patterns and flags suspicious behaviour:
  - Too many messages per minute (automated spamming through verified DID)
  - Identical content repetition (bot-like templated messages)
  - Same DID from multiple IPs simultaneously (credential sharing)
  - Burst bond requests (sybil chain bootstrapping)

Suspect levels:
  ok        → normal, no action
  warning   → logged, no user impact
  throttled → artificial slowdown, 2x rate limit applied
  suspect   → action blocked, re-verification required
  blocked   → all actions rejected, manual review needed
"""

import time
import hashlib
import logging
from typing import Optional

log = logging.getLogger("aptogon.behavior")

# ── Thresholds ────────────────────────────────────────────────────────────────
MSG_PER_MIN_WARN      = 8    # > 8 msg/min → warning
MSG_PER_MIN_SUSPECT   = 15   # > 15 msg/min → suspect
MSG_PER_HOUR_WARN     = 120  # > 120 msg/hour → warning
MSG_PER_HOUR_SUSPECT  = 300  # > 300 msg/hour → suspect
REPEAT_CONTENT_LIMIT  = 4    # same content > 4 times in 10 min → spam
IP_SWITCH_WINDOW      = 300  # 5 min window for multi-IP detection
IP_SWITCH_LIMIT       = 3    # > 3 different IPs in 5 min → suspicious
BOND_BURST_LIMIT      = 5    # > 5 bond requests/hour → suspicious
CONTENT_HASH_TTL      = 600  # 10 min TTL for content dedup

SUSPECT_TTL           = 3600        # 1 hour suspect period
BLOCKED_TTL           = 86400 * 3   # 3 days block


class BehaviorFlag:
    OK         = "ok"
    WARNING    = "warning"
    THROTTLED  = "throttled"
    SUSPECT    = "suspect"
    BLOCKED    = "blocked"


class BehaviorResult:
    def __init__(self, level: str, reason: str = "", score: float = 0.0):
        self.level  = level
        self.reason = reason
        self.score  = score   # 0.0 suspicious score

    @property
    def is_blocked(self) -> bool:
        return self.level in (BehaviorFlag.SUSPECT, BehaviorFlag.BLOCKED)

    @property
    def needs_reverify(self) -> bool:
        return self.level == BehaviorFlag.SUSPECT

    def __repr__(self):
        return f"BehaviorResult({self.level}, {self.reason!r}, score={self.score:.2f})"


class BehaviorMonitor:
    """
    Redis-backed post-verification behaviour monitor.
    Falls back to in-memory counters if Redis is unavailable.
    """

    def __init__(self, redis=None):
        self._redis = redis
        self._mem: dict = {}

    # ── Internal Redis helpers ────────────────────────────────────────────────

    async def _incr(self, key: str, ttl: int) -> int:
        if self._redis:
            try:
                v = await self._redis.incr(key)
                if v == 1:
                    await self._redis.expire(key, ttl)
                return v
            except Exception as e:
                log.debug("Redis incr error: %s", e)
        now = time.time()
        entry = self._mem.get(key)
        if entry is None or now > entry["exp"]:
            self._mem[key] = {"val": 1, "exp": now + ttl}
            return 1
        self._mem[key]["val"] += 1
        return self._mem[key]["val"]

    async def _get(self, key: str) -> int:
        if self._redis:
            try:
                v = await self._redis.get(key)
                return int(v) if v else 0
            except Exception:
                pass
        entry = self._mem.get(key)
        if entry and time.time() <= entry["exp"]:
            return entry["val"]
        return 0

    async def _set(self, key: str, val, ttl: int):
        if self._redis:
            try:
                await self._redis.set(key, val, ex=ttl)
                return
            except Exception as e:
                log.debug("Redis set error: %s", e)
        self._mem[key] = {"val": val, "exp": time.time() + ttl}

    async def _sadd(self, key: str, member: str, ttl: int) -> int:
        """Add to a set, return new cardinality."""
        if self._redis:
            try:
                await self._redis.sadd(key, member)
                await self._redis.expire(key, ttl)
                return await self._redis.scard(key)
            except Exception as e:
                log.debug("Redis sadd error: %s", e)
        # In-memory set
        entry = self._mem.get(key)
        now = time.time()
        if entry is None or now > entry["exp"]:
            self._mem[key] = {"val": {member}, "exp": now + ttl}
            return 1
        self._mem[key]["val"].add(member)
        return len(self._mem[key]["val"])

    async def _exists(self, key: str) -> bool:
        if self._redis:
            try:
                return bool(await self._redis.exists(key))
            except Exception:
                pass
        entry = self._mem.get(key)
        return bool(entry and time.time() <= entry["exp"])

    # ── Public API ────────────────────────────────────────────────────────────

    async def record_message(
        self,
        did_short: str,
        content: str,
        ip: str = "",
        room: str = "",
    ) -> BehaviorResult:
        """
        Record a message action and check for anomalies.
        Call BEFORE saving the message — returns whether to allow it.
        """
        # Skip admins
        if not did_short:
            return BehaviorResult(BehaviorFlag.OK)

        # 1. Check if already blocked/suspect
        if await self._exists(f"beh:blocked:{did_short}"):
            reason = await self._get(f"beh:blocked_reason:{did_short}") or "blocked"
            return BehaviorResult(BehaviorFlag.BLOCKED, str(reason), 1.0)

        suspect_reason = await self._get(f"beh:suspect_reason:{did_short}")
        if await self._exists(f"beh:suspect:{did_short}"):
            return BehaviorResult(BehaviorFlag.SUSPECT, str(suspect_reason or "suspect"), 0.9)

        score = 0.0
        anomalies = []

        # 2. Per-minute message rate
        min_key = f"beh:msg_min:{did_short}:{int(time.time() // 60)}"
        msg_min = await self._incr(min_key, 120)
        if msg_min > MSG_PER_MIN_SUSPECT:
            await self._flag_suspect(did_short, f"msg_rate:{msg_min}/min")
            return BehaviorResult(BehaviorFlag.SUSPECT, f"{msg_min} messages/min", 0.95)
        elif msg_min > MSG_PER_MIN_WARN:
            score += 0.4
            anomalies.append(f"msg_rate:{msg_min}/min")

        # 3. Per-hour message count
        hour_key = f"beh:msg_hour:{did_short}:{int(time.time() // 3600)}"
        msg_hour = await self._incr(hour_key, 7200)
        if msg_hour > MSG_PER_HOUR_SUSPECT:
            await self._flag_suspect(did_short, f"msg_volume:{msg_hour}/hour")
            return BehaviorResult(BehaviorFlag.SUSPECT, f"{msg_hour} messages/hour", 0.95)
        elif msg_hour > MSG_PER_HOUR_WARN:
            score += 0.3
            anomalies.append(f"msg_volume:{msg_hour}/hour")

        # 4. Identical content repetition
        content_hash = hashlib.sha256(content.strip().lower().encode()).hexdigest()[:16]
        repeat_key   = f"beh:content:{did_short}:{content_hash}"
        repeat_count = await self._incr(repeat_key, CONTENT_HASH_TTL)
        if repeat_count > REPEAT_CONTENT_LIMIT:
            await self._flag_suspect(did_short, f"repeat_content:{repeat_count}x")
            return BehaviorResult(BehaviorFlag.SUSPECT, f"repeated content {repeat_count}x", 0.9)
        elif repeat_count >= REPEAT_CONTENT_LIMIT - 1:
            score += 0.35
            anomalies.append(f"repeat:{repeat_count}x")

        # 5. Multi-IP detection (credential sharing signal)
        if ip:
            ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:12]
            ip_set_key = f"beh:ips:{did_short}"
            ip_count = await self._sadd(ip_set_key, ip_hash, IP_SWITCH_WINDOW)
            if ip_count > IP_SWITCH_LIMIT:
                score += 0.5
                anomalies.append(f"multi_ip:{ip_count}_sources")
                log.warning("DID %s used from %d IPs in %ds — possible credential sharing",
                            did_short, ip_count, IP_SWITCH_WINDOW)

        # 6. Log warning if score elevated
        if anomalies:
            log.info("Behavior anomaly DID=%s score=%.2f anomalies=%s",
                     did_short, score, anomalies)
            await self._record_anomaly(did_short, anomalies, score)

        if score >= 0.7:
            return BehaviorResult(BehaviorFlag.THROTTLED, ", ".join(anomalies), score)
        if score >= 0.35:
            return BehaviorResult(BehaviorFlag.WARNING, ", ".join(anomalies), score)
        return BehaviorResult(BehaviorFlag.OK, "", score)

    async def record_bond_request(self, did_short: str) -> BehaviorResult:
        """Track bond request bursts."""
        key = f"beh:bond_req:{did_short}:{int(time.time() // 3600)}"
        count = await self._incr(key, 7200)
        if count > BOND_BURST_LIMIT:
            await self._flag_suspect(did_short, f"bond_burst:{count}/hour")
            return BehaviorResult(BehaviorFlag.SUSPECT, f"{count} bond requests/hour", 0.85)
        return BehaviorResult(BehaviorFlag.OK)

    async def get_status(self, did_short: str) -> dict:
        """Get current behavior status for a DID (for admin panel)."""
        blocked = await self._exists(f"beh:blocked:{did_short}")
        suspect = await self._exists(f"beh:suspect:{did_short}")
        min_key  = f"beh:msg_min:{did_short}:{int(time.time() // 60)}"
        hour_key = f"beh:msg_hour:{did_short}:{int(time.time() // 3600)}"
        msg_min  = await self._get(min_key)
        msg_hour = await self._get(hour_key)

        level = BehaviorFlag.OK
        if blocked: level = BehaviorFlag.BLOCKED
        elif suspect: level = BehaviorFlag.SUSPECT

        return {
            "did_short":  did_short,
            "level":      level,
            "msg_min":    msg_min,
            "msg_hour":   msg_hour,
            "blocked":    blocked,
            "suspect":    suspect,
        }

    async def clear_flag(self, did_short: str):
        """Manually clear suspect/blocked flag (admin action)."""
        for suffix in ("suspect", "blocked", "suspect_reason", "blocked_reason"):
            key = f"beh:{suffix}:{did_short}"
            if self._redis:
                try:
                    await self._redis.delete(key)
                except Exception:
                    pass
            self._mem.pop(key, None)
        log.info("Behavior flag cleared for DID=%s", did_short)

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _flag_suspect(self, did_short: str, reason: str):
        await self._set(f"beh:suspect:{did_short}", 1, SUSPECT_TTL)
        await self._set(f"beh:suspect_reason:{did_short}", reason, SUSPECT_TTL)
        log.warning("DID %s flagged as SUSPECT: %s", did_short, reason)

    async def _record_anomaly(self, did_short: str, anomalies: list, score: float):
        """Keep a rolling log of anomalies for admin review."""
        key = f"beh:anomaly_log:{did_short}"
        entry = f"{int(time.time())}|{score:.2f}|{','.join(anomalies)}"
        if self._redis:
            try:
                await self._redis.lpush(key, entry)
                await self._redis.ltrim(key, 0, 49)   # keep last 50
                await self._redis.expire(key, 86400 * 7)
            except Exception:
                pass

    async def record_key_suspect(
        self,
        did_short: str,
        api_key_pk: str,
        ip_hash: str,
        db,
    ) -> None:
        """
        Track suspect DIDs per {ip_hash, api_key_pk}.
        When 5+ unique suspect DIDs are seen from the same IP+key within 30 min,
        emit a behavior_cascade alert.
        """
        key = f"beh:cascade:{api_key_pk}:{ip_hash}"
        count = await self._sadd(key, did_short, ttl=1800)  # 30 min window
        log.info("Cascade tracker key=%s ip=%s did=%s count=%d",
                 api_key_pk[:12], ip_hash, did_short, count)
        if count >= 5:
            owner_did = await db.get_key_owner(api_key_pk)
            if owner_did:
                from services import alert_service as _as
                await _as.record_alert(
                    db=db,
                    owner_did=owner_did,
                    event_type="behavior_cascade",
                    level=3,
                    severity="critical",
                    detail={
                        "ip_hash": ip_hash,
                        "did_count": count,
                        "window_minutes": 30,
                    },
                    api_key_pk=api_key_pk,
                )

    async def check_usage_spike(
        self,
        api_key_pk: str,
        owner_did: str,
        db,
    ) -> None:
        """
        Track hourly request count for a key.
        Emit usage_spike alert when current hour > 3× rolling average of last 24 h.
        """
        import time as _time
        hour_slot = int(_time.time() // 3600)
        cur_key   = f"beh:rph:{api_key_pk}:{hour_slot}"
        current_rph = await self._incr(cur_key, ttl=7200)

        if current_rph < 10:          # not enough data yet
            return

        # Average over the previous 23 hours
        totals = []
        for offset in range(1, 24):
            k = f"beh:rph:{api_key_pk}:{hour_slot - offset}"
            totals.append(await self._get(k))
        past = [v for v in totals if v > 0]
        if not past:
            return
        avg_rph = sum(past) / len(past)
        ratio = current_rph / avg_rph if avg_rph > 0 else 0

        if ratio > 3.0:
            from services import alert_service as _as
            await _as.record_alert(
                db=db,
                owner_did=owner_did,
                event_type="usage_spike",
                level=2,
                severity="warning",
                detail={
                    "key_pk": api_key_pk,
                    "current_rph": current_rph,
                    "avg_rph": round(avg_rph, 1),
                    "ratio": round(ratio, 2),
                },
                api_key_pk=api_key_pk,
            )
