"""
AntiBotFirewall — Real-time behavioral bot detection via SapiX.

Design principles:
  - Samples only 5% of requests (doesn't block on every request)
  - Results cached in Redis for 1 hour
  - NEVER blocks on infrastructure failure (fallback = allow)
  - Analyzes behavior patterns, not identity

Bot signals we detect:
  - Machine-perfect request intervals (identical timestamps)
  - Zero action diversity (same action repeated)
  - 24/7 activity with no sleep gaps
  - Statistically impossible response times
  - Coordinated behavior patterns across sessions
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import time
from dataclasses import dataclass, field
from typing import Optional

from .client import SapiXClient
from .models import SapiXModel


# ── Data Types ────────────────────────────────────────────────────────────────

@dataclass
class RequestRecord:
    """Single request event for behavioral analysis."""
    timestamp_ms: int
    action_type: str       # "view", "post", "search", "bond", etc.
    response_time_ms: int  # How fast user responded


@dataclass
class BehaviorProfile:
    """Aggregated behavioral summary for a DID session."""
    did_hash: str                    # First 12 chars only — not full hash
    request_intervals_ms: list[int]  # Time between requests
    action_sequence: list[str]       # Last 20 actions
    active_hour_buckets: list[int]   # Which hours of day are active (0-23)
    total_requests: int
    session_age_hours: float


@dataclass
class BotCheckResult:
    bot_probability: float           # 0.0 = definitely human, 1.0 = definitely bot
    signals: list[str]               # Detected bot signals
    confidence: float
    action_required: str             # "allow", "monitor", "reverify", "block"
    cached: bool = False
    via_fallback: bool = False

    @property
    def should_block(self) -> bool:
        return self.action_required == "block"

    @property
    def should_reverify(self) -> bool:
        return self.action_required in ("reverify", "block")


# ── Behavioral Sampler ────────────────────────────────────────────────────────

class RequestSampler:
    """
    Extracts anonymous behavioral statistics from request history.
    Only statistics leave this class — no timestamps, no content.
    """

    def analyze(self, records: list[RequestRecord]) -> dict:
        if len(records) < 5:
            return {"insufficient_data": True}

        intervals = [
            records[i].timestamp_ms - records[i-1].timestamp_ms
            for i in range(1, len(records))
        ]

        actions = [r.action_type for r in records]
        unique_actions = len(set(actions))
        total_actions = len(actions)

        hours = [
            (r.timestamp_ms // 3_600_000) % 24
            for r in records
        ]

        return {
            # Interval analysis
            "interval_mean_ms": self._mean(intervals),
            "interval_std_ms": self._std(intervals),
            "interval_cv": self._cv(intervals),           # coefficient of variation

            # Action diversity
            "action_diversity": unique_actions / max(1, total_actions),
            "dominant_action_ratio": max(
                actions.count(a) for a in set(actions)
            ) / max(1, total_actions),

            # Temporal patterns
            "active_hours_count": len(set(hours)),
            "has_sleep_gap": self._has_sleep_gap(hours),  # humans sleep

            # Response time analysis
            "response_time_mean_ms": self._mean(
                [r.response_time_ms for r in records]
            ),
            "response_time_std_ms": self._std(
                [r.response_time_ms for r in records]
            ),

            "total_requests": len(records),
        }

    def _has_sleep_gap(self, hours: list[int]) -> bool:
        """Check if there's a 4+ hour gap (humans sleep, bots don't)."""
        unique_hours = sorted(set(hours))
        if len(unique_hours) < 4:
            return True  # insufficient data — assume human
        for i in range(1, len(unique_hours)):
            if unique_hours[i] - unique_hours[i-1] >= 4:
                return True
        # Check wrap-around (23→0)
        if (24 - unique_hours[-1]) + unique_hours[0] >= 4:
            return True
        return False

    def _mean(self, vals: list) -> float:
        return sum(vals) / len(vals) if vals else 0.0

    def _std(self, vals: list) -> float:
        if len(vals) < 2:
            return 0.0
        m = self._mean(vals)
        return math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))

    def _cv(self, vals: list) -> float:
        """Coefficient of variation = std/mean. LOW = bot (uniform intervals)."""
        m = self._mean(vals)
        if m == 0:
            return 0.0
        return self._std(vals) / m


# ── Firewall ──────────────────────────────────────────────────────────────────

class AntiBotFirewall:
    """
    Real-time bot detection middleware for HSI network.

    Architecture:
      - Most requests (95%) are passed through without AI check
      - 5% are sampled for behavioral analysis via Gonka
      - Results cached for 1 hour per did_hash
      - High bot_probability → flag for re-verification
      - Infrastructure failure → ALWAYS allow (never block humans on outage)

    Integration with FastAPI:
        firewall = AntiBotFirewall(gonka_client)

        @app.middleware("http")
        async def hsi_firewall(request: Request, call_next):
            did_hash = extract_did_hash(request)
            result = await firewall.check(did_hash, get_history(did_hash))
            if result.should_block:
                raise HTTPException(403, "Human re-verification required")
            return await call_next(request)
    """

    # Sampling rate — how often to do full AI analysis
    SAMPLE_RATE = 0.05              # 5% of requests

    # Thresholds for action
    BOT_MONITOR_THRESHOLD = 0.60    # Start monitoring
    BOT_REVERIFY_THRESHOLD = 0.75   # Require re-verification
    BOT_BLOCK_THRESHOLD = 0.90      # Hard block (very conservative)

    SYSTEM_PROMPT = """You are analyzing behavioral patterns for the HSI
(Homo Sapience Internet) network to detect automated bots.

Key bot signals:
- interval_cv close to 0: machine-perfect timing (bots never vary)
- action_diversity close to 0: only one action type (scraping bot)
- has_sleep_gap=false: active 24/7 (humans sleep)
- response_time_std close to 0: robotic response times

Key human signals:
- high interval_cv (>0.5): irregular natural timing
- action_diversity > 0.3: varied behavior
- has_sleep_gap=true: natural rest periods
- varied response times

IMPORTANT: False positives harm real users.
Only flag high bot_probability when multiple strong signals agree.
Return ONLY valid JSON."""

    def __init__(self, client: SapiXClient, cache=None):
        """
        Args:
            client: SapiXClient instance
            cache: Optional cache client (redis.asyncio.Redis)
                   If None, uses in-memory cache (not suitable for production)
        """
        self.client = client
        self._cache = cache
        self._memory_cache: dict[str, tuple[float, float]] = {}  # did_hash → (score, expiry)
        self.sampler = RequestSampler()

    async def check(
        self,
        did_hash: str,
        request_history: list[RequestRecord],
        force: bool = False,
    ) -> BotCheckResult:
        """
        Check if this DID session shows bot-like behavior.

        Args:
            did_hash: First 12 chars of DID hash (anonymous)
            request_history: Recent request records (last 50-100)
            force: Force AI analysis (skip sampling)

        Returns:
            BotCheckResult — check .should_block and .should_reverify
        """

        # 1. Check cache first (fast path, no AI call)
        cached = await self._get_cached(did_hash)
        if cached is not None:
            return self._make_result(cached, cached_=True)

        # 2. Sampling — most requests skip AI analysis
        if not force and random.random() > self.SAMPLE_RATE:
            return BotCheckResult(
                bot_probability=0.0,
                signals=[],
                confidence=0.0,
                action_required="allow",
            )

        # 3. Extract behavioral statistics
        behavior_stats = self.sampler.analyze(request_history)
        if behavior_stats.get("insufficient_data"):
            return BotCheckResult(
                bot_probability=0.0,
                signals=["insufficient_history"],
                confidence=0.0,
                action_required="allow",
            )

        # 4. SapiX analysis
        try:
            response = await self.client.chat(
                model=SapiXModel.ANTIBOT_REALTIME,
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": self._build_prompt(behavior_stats)},
                ],
                max_tokens=256,
                temperature=0.02,
                task_type="antibot_detection",
                timeout_override=1.5,  # Hard 1.5s limit for real-time use
            )

            data = response.as_json()
            bot_probability = float(data.get("bot_probability", 0.0))
            signals = list(data.get("signals", []))
            via_fallback = response.via_fallback

        except Exception:
            # Infrastructure failure → ALLOW (never block on outage)
            result = BotCheckResult(
                bot_probability=0.0,
                signals=["analysis_unavailable"],
                confidence=0.0,
                action_required="allow",
                via_fallback=True,
            )
            return result

        # 5. Also apply rule-based check as second opinion
        rule_score = self._rule_based_score(behavior_stats)

        # Combine: take max of AI and rule-based (conservative)
        final_score = max(bot_probability, rule_score)

        # 6. Cache result
        await self._set_cached(did_hash, final_score)

        return self._make_result(final_score, signals=signals, via_fallback=via_fallback)

    def _build_prompt(self, stats: dict) -> str:
        return f"""Analyze these behavioral statistics for bot detection.

Statistics:
- interval_cv (timing regularity): {stats.get('interval_cv', 0):.4f}
  [0=machine-perfect timing, >0.5=human irregular]
- action_diversity: {stats.get('action_diversity', 0):.3f}
  [0=one action only, 1=fully diverse]
- dominant_action_ratio: {stats.get('dominant_action_ratio', 1):.3f}
  [1=only one action type, 0.3=varied]
- has_sleep_gap: {stats.get('has_sleep_gap', True)}
  [true=human has rest periods, false=active 24/7]
- active_hours_count: {stats.get('active_hours_count', 0)}/24
- response_time_std_ms: {stats.get('response_time_std_ms', 0):.1f}ms
  [0=robotic, >200=human variation]
- total_requests: {stats.get('total_requests', 0)}

Respond with JSON:
{{
  "bot_probability": 0.0-1.0,
  "signals": ["list of detected signals"],
  "reasoning": "brief explanation"
}}"""

    def _rule_based_score(self, stats: dict) -> float:
        """Secondary rule-based check to catch obvious bots."""
        score = 0.0

        # Machine-perfect timing
        cv = stats.get("interval_cv", 1.0)
        if cv < 0.02:
            score += 0.5
        elif cv < 0.1:
            score += 0.2

        # No action diversity
        diversity = stats.get("action_diversity", 1.0)
        if diversity < 0.05:
            score += 0.3

        # No sleep gap
        if not stats.get("has_sleep_gap", True):
            score += 0.2

        # Robotic response times
        rt_std = stats.get("response_time_std_ms", 500)
        if rt_std < 5:
            score += 0.3

        return min(1.0, score)

    def _make_result(
        self,
        bot_probability: float,
        signals: list[str] = None,
        cached_: bool = False,
        via_fallback: bool = False,
    ) -> BotCheckResult:
        if bot_probability >= self.BOT_BLOCK_THRESHOLD:
            action = "block"
        elif bot_probability >= self.BOT_REVERIFY_THRESHOLD:
            action = "reverify"
        elif bot_probability >= self.BOT_MONITOR_THRESHOLD:
            action = "monitor"
        else:
            action = "allow"

        return BotCheckResult(
            bot_probability=bot_probability,
            signals=signals or [],
            confidence=0.8,
            action_required=action,
            cached=cached_,
            via_fallback=via_fallback,
        )

    # ── Cache ───────────────────────────────────────────────────────────────

    async def _get_cached(self, did_hash: str) -> Optional[float]:
        cache_key = f"hsi:bot:{did_hash[:12]}"

        if self._cache:
            try:
                val = await self._cache.get(cache_key)
                return float(val) if val else None
            except Exception:
                pass

        # Memory cache fallback
        if cache_key in self._memory_cache:
            score, expiry = self._memory_cache[cache_key]
            if time.time() < expiry:
                return score
            del self._memory_cache[cache_key]

        return None

    async def _set_cached(self, did_hash: str, score: float, ttl_seconds: int = 3600):
        cache_key = f"hsi:bot:{did_hash[:12]}"

        if self._cache:
            try:
                await self._cache.set(cache_key, str(score), ex=ttl_seconds)
                return
            except Exception:
                pass

        # Memory cache fallback
        self._memory_cache[cache_key] = (score, time.time() + ttl_seconds)
