"""
APTOGON Rate Limiter — Redis-based protection against:
  - Model extraction (too many verify requests per IP)
  - Replay attacks (session_id reuse)
  - Brute force (consecutive failures trigger cooldown)
  - Bond vouching abuse (Gold Member vouch frequency)
"""

import time
import logging
from typing import Optional

log = logging.getLogger("aptogon.ratelimit")

# ── Constants ─────────────────────────────────────────────────────────────────
VERIFY_LIMIT_PER_HOUR   = 12    # max verify attempts per IP per hour
CHALLENGE_LIMIT_PER_HOUR = 30   # max embed /challenge requests per IP per hour (own bucket)
VERIFY_FAIL_LIMIT       = 4     # consecutive failures before cooldown
VERIFY_FAIL_COOLDOWN    = 1800  # 30 min cooldown after too many failures
SESSION_TTL             = 300   # 5 min — session_id is single-use
BOND_VOUCH_LIMIT        = 5     # Gold Member: max vouches per 30 days
BOND_VOUCH_COOLDOWN     = 172800  # 48h between vouches
PAIR_CLAIM_LIMIT        = 10    # max device-pair claim attempts per IP per hour


class RateLimiter:
    """
    Redis-backed rate limiter.
    Falls back to in-memory dict if Redis is unavailable (dev mode).
    """

    def __init__(self, redis=None):
        self._redis = redis
        self._mem: dict = {}  # fallback for dev

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _incr(self, key: str, ttl: int) -> int:
        """Increment counter, set TTL on first write. Returns new value."""
        if self._redis:
            try:
                val = await self._redis.incr(key)
                if val == 1:
                    await self._redis.expire(key, ttl)
                return val
            except Exception as e:
                log.warning("Redis error in _incr(%s): %s", key, e)
        # in-memory fallback
        now = time.time()
        entry = self._mem.get(key)
        if entry is None or now > entry["expires"]:
            self._mem[key] = {"val": 1, "expires": now + ttl}
            return 1
        self._mem[key]["val"] += 1
        return self._mem[key]["val"]

    async def _get(self, key: str) -> Optional[int]:
        if self._redis:
            try:
                v = await self._redis.get(key)
                return int(v) if v else None
            except Exception:
                pass
        entry = self._mem.get(key)
        if entry and time.time() <= entry["expires"]:
            return entry["val"]
        return None

    async def _set(self, key: str, value, ttl: int):
        if self._redis:
            try:
                await self._redis.set(key, value, ex=ttl)
                return
            except Exception as e:
                log.warning("Redis error in _set(%s): %s", key, e)
        self._mem[key] = {"val": value, "expires": time.time() + ttl}

    async def _exists(self, key: str) -> bool:
        if self._redis:
            try:
                return bool(await self._redis.exists(key))
            except Exception:
                pass
        entry = self._mem.get(key)
        return bool(entry and time.time() <= entry["expires"])

    # ── Public API ────────────────────────────────────────────────────────────

    async def check_verify_ip(self, ip: str) -> tuple[bool, str]:
        """
        Check if IP is allowed to attempt verification.
        Returns (allowed: bool, reason: str).
        """
        # 1. Cooldown check (too many failures)
        cooldown_key = f"verify:cooldown:{ip}"
        if await self._exists(cooldown_key):
            ttl_remaining = await self._get(f"verify:cooldown_ts:{ip}") or 0
            return False, f"Too many failed attempts. Try again in {int(ttl_remaining)} seconds."

        # 2. Hourly rate limit
        hour_key = f"verify:hourly:{ip}:{int(time.time() // 3600)}"
        count = await self._incr(hour_key, 3600)
        if count > VERIFY_LIMIT_PER_HOUR:
            log.warning("Rate limit hit: IP=%s count=%d", ip, count)
            return False, f"Too many verification attempts ({count}/{VERIFY_LIMIT_PER_HOUR} per hour). Try again later."

        return True, "ok"

    async def check_challenge_ip(self, ip: str) -> tuple[bool, str]:
        """
        Throttle embed /challenge requests per IP using a dedicated bucket
        (challenge:hourly:{ip}), separate from the verify:hourly:{ip} counter
        used by /verify and /risk. This prevents a single full verification
        flow (challenge → assert → verify) from double-counting against the
        verify budget and tripping spurious 429s.
        Returns (allowed: bool, reason: str).
        """
        hour_key = f"challenge:hourly:{ip}:{int(time.time() // 3600)}"
        count = await self._incr(hour_key, 3600)
        if count > CHALLENGE_LIMIT_PER_HOUR:
            log.warning("Challenge rate limit hit: IP=%s count=%d", ip, count)
            return False, f"Too many challenge requests ({count}/{CHALLENGE_LIMIT_PER_HOUR} per hour). Try again later."
        return True, "ok"

    async def record_verify_failure(self, ip: str):
        """Record a failed verification. After VERIFY_FAIL_LIMIT → cooldown."""
        fail_key = f"verify:fails:{ip}"
        count = await self._incr(fail_key, VERIFY_FAIL_COOLDOWN)
        if count >= VERIFY_FAIL_LIMIT:
            # Set cooldown
            await self._set(f"verify:cooldown:{ip}", 1, VERIFY_FAIL_COOLDOWN)
            remaining = VERIFY_FAIL_COOLDOWN
            await self._set(f"verify:cooldown_ts:{ip}", remaining, VERIFY_FAIL_COOLDOWN)
            log.warning("Cooldown activated: IP=%s failures=%d", ip, count)

    async def reset_verify_failures(self, ip: str):
        """Reset failure count after successful verification."""
        if self._redis:
            try:
                await self._redis.delete(f"verify:fails:{ip}")
            except Exception:
                pass
        self._mem.pop(f"verify:fails:{ip}", None)

    async def check_session_id(self, session_id: str) -> bool:
        """
        Check session_id is not reused (replay protection).
        Returns True if session is fresh (first use). False if replayed.
        """
        key = f"session:{session_id}"
        if await self._exists(key):
            log.warning("Replayed session_id: %s", session_id[:16])
            return False
        await self._set(key, 1, SESSION_TTL)
        return True

    async def check_bond_vouch(self, approver_did_short: str) -> tuple[bool, str]:
        """
        Check if Gold Member can vouch (cooldown + monthly limit).
        Returns (allowed: bool, reason: str).
        """
        # 48h cooldown
        cooldown_key = f"bond:cooldown:{approver_did_short}"
        if await self._exists(cooldown_key):
            return False, "You must wait 48 hours between vouching for different users."

        # Monthly limit (30-day rolling window)
        month_key = f"bond:monthly:{approver_did_short}:{int(time.time() // (86400 * 30))}"
        count = await self._get(month_key) or 0
        if count >= BOND_VOUCH_LIMIT:
            return False, f"Monthly vouching limit reached ({BOND_VOUCH_LIMIT} per 30 days)."

        return True, "ok"

    async def record_bond_vouch(self, approver_did_short: str):
        """Record a vouch — set cooldown and increment monthly counter."""
        # 48h cooldown
        await self._set(f"bond:cooldown:{approver_did_short}", 1, BOND_VOUCH_COOLDOWN)
        # Monthly counter
        month_key = f"bond:monthly:{approver_did_short}:{int(time.time() // (86400 * 30))}"
        await self._incr(month_key, 86400 * 31)  # slightly longer TTL than window

    async def check_pair_claim(self, ip: str) -> tuple[bool, str]:
        """
        Throttle device-pairing claims per IP. A pairing code is a 6-char
        bearer token; without a limit it could be brute-forced within its
        10-minute window. Returns (allowed: bool, reason: str).
        """
        hour_key = f"pair:claim:{ip}:{int(time.time() // 3600)}"
        count = await self._incr(hour_key, 3600)
        if count > PAIR_CLAIM_LIMIT:
            log.warning("Pair-claim rate limit hit: IP=%s count=%d", ip, count)
            return False, f"Too many pairing attempts ({count}/{PAIR_CLAIM_LIMIT} per hour). Try again later."
        return True, "ok"
