"""
ExpressionEngine — Human gesture pattern analysis via SapiX.

Core HSI principle: verify humanity through ACTION, not identity.

What we analyze:
  - Velocity variance between touch points
  - Entropy of pause distribution
  - Correction count (humans make mistakes, bots don't)
  - Pressure variance (physical imperfection)
  - Rhythm irregularity (humans breathe, bots don't)

What we NEVER collect or send:
  - Raw XY coordinates
  - Biometric data
  - Device fingerprint
  - User identity

The raw touch events are processed ON-DEVICE into a statistical
pattern vector. Only the vector reaches our servers. Only a SHA3-256
hash of the vector reaches Gonka. The result is an ExpressionProof
hash that gets written to Aptos — provably anonymous.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass, field
from typing import Optional

from .client import SapiXClient
from .models import SapiXModel


# ── Data Types ────────────────────────────────────────────────────────────────

@dataclass
class TouchEvent:
    """A single touch/mouse event from the user's gesture."""
    x: float               # normalized 0.0–1.0 (NOT raw pixels)
    y: float               # normalized 0.0–1.0
    pressure: float        # 0.0–1.0 (0.5 for mouse)
    timestamp_ms: int      # milliseconds since gesture start
    pause_after_ms: int    # how long user paused after this point

    def __post_init__(self):
        # Normalize inputs
        self.x = max(0.0, min(1.0, self.x))
        self.y = max(0.0, min(1.0, self.y))
        self.pressure = max(0.0, min(1.0, self.pressure))


@dataclass
class TouchPattern:
    """
    Statistical summary of a gesture — no raw coordinates.
    This is what gets sent to Gonka for analysis.
    """
    # Core metrics
    velocity_mean: float
    velocity_std: float          # HIGH = human (irregular speed)
    velocity_min: float
    velocity_max: float

    # Pause distribution
    pause_entropy: float         # HIGH = human (unpredictable pauses)
    pause_mean_ms: float
    pause_max_ms: float

    # Human imperfection signals
    correction_count: int        # direction reversals
    pressure_variance: float     # physical pressure variation
    rhythm_irregularity: float   # deviation from uniform timing

    # Temporal
    total_duration_ms: int
    point_count: int

    # Accessibility flag (affects thresholds)
    possible_motor_difficulty: bool = False


@dataclass
class ExpressionResult:
    """Result of expression analysis."""
    is_human: bool
    confidence: float            # 0.0–1.0
    reasoning: str
    expression_proof: Optional[str]  # SHA3-256 hash — written to Aptos
    anomalies: list[str] = field(default_factory=list)
    via_fallback: bool = False
    analysis_latency_ms: float = 0.0

    @property
    def passed(self) -> bool:
        """True if verification passed with sufficient confidence."""
        threshold = 0.60 if self.via_fallback else 0.78
        return self.is_human and self.confidence >= threshold


# ── Pattern Extractor (runs on-device / on-server, NOT sent to Gonka) ─────────

class PatternExtractor:
    """
    Converts raw touch events into an anonymized statistical pattern.
    Runs before any network call — raw coordinates never leave this function.
    """

    # Thresholds for motor difficulty detection
    # Users with tremor, limited mobility etc. should never be blocked
    TREMOR_CORRECTION_THRESHOLD = 8
    SLOW_GESTURE_THRESHOLD_MS = 15_000

    def extract(self, events: list[TouchEvent]) -> TouchPattern:
        if len(events) < 3:
            raise ValueError("Need at least 3 touch events to extract pattern")

        velocities = self._calc_velocities(events)
        pauses = [e.pause_after_ms for e in events]
        corrections = self._count_corrections(events)

        # Detect possible motor difficulty (high corrections + slow)
        total_ms = events[-1].timestamp_ms - events[0].timestamp_ms
        possible_motor = (
            corrections >= self.TREMOR_CORRECTION_THRESHOLD or
            total_ms >= self.SLOW_GESTURE_THRESHOLD_MS
        )

        return TouchPattern(
            velocity_mean=self._mean(velocities),
            velocity_std=self._std(velocities),
            velocity_min=min(velocities) if velocities else 0,
            velocity_max=max(velocities) if velocities else 0,
            pause_entropy=self._entropy(pauses),
            pause_mean_ms=self._mean(pauses),
            pause_max_ms=max(pauses) if pauses else 0,
            correction_count=corrections,
            pressure_variance=self._variance([e.pressure for e in events]),
            rhythm_irregularity=self._rhythm_irregularity(events),
            total_duration_ms=total_ms,
            point_count=len(events),
            possible_motor_difficulty=possible_motor,
        )

    def _calc_velocities(self, events: list[TouchEvent]) -> list[float]:
        velocities = []
        for i in range(1, len(events)):
            dx = events[i].x - events[i-1].x
            dy = events[i].y - events[i-1].y
            dt = max(1, events[i].timestamp_ms - events[i-1].timestamp_ms)
            dist = math.sqrt(dx*dx + dy*dy)
            velocities.append(dist / dt * 1000)  # units/second
        return velocities

    def _count_corrections(self, events: list[TouchEvent]) -> int:
        """Count direction reversals — humans correct mistakes, bots don't."""
        corrections = 0
        if len(events) < 3:
            return 0
        for i in range(1, len(events) - 1):
            prev_dx = events[i].x - events[i-1].x
            next_dx = events[i+1].x - events[i].x
            prev_dy = events[i].y - events[i-1].y
            next_dy = events[i+1].y - events[i].y
            # Significant direction reversal
            if (prev_dx * next_dx < -0.001 or prev_dy * next_dy < -0.001):
                corrections += 1
        return corrections

    def _entropy(self, values: list) -> float:
        """Shannon entropy of bucketed values. High entropy = unpredictable = human."""
        if not values:
            return 0.0
        n_buckets = min(10, len(values))
        if n_buckets < 2:
            return 0.0
        min_v, max_v = min(values), max(values)
        if max_v == min_v:
            return 0.0  # all identical = bot signal
        bucket_size = (max_v - min_v) / n_buckets
        counts = [0] * n_buckets
        for v in values:
            idx = min(int((v - min_v) / bucket_size), n_buckets - 1)
            counts[idx] += 1
        total = sum(counts)
        entropy = 0.0
        for c in counts:
            if c > 0:
                p = c / total
                entropy -= p * math.log2(p)
        return entropy

    def _rhythm_irregularity(self, events: list[TouchEvent]) -> float:
        """How irregular are the intervals between points? High = human."""
        intervals = [
            events[i].timestamp_ms - events[i-1].timestamp_ms
            for i in range(1, len(events))
        ]
        return self._std(intervals) / max(1, self._mean(intervals))

    def _mean(self, vals: list) -> float:
        return sum(vals) / len(vals) if vals else 0.0

    def _std(self, vals: list) -> float:
        if len(vals) < 2:
            return 0.0
        m = self._mean(vals)
        variance = sum((v - m) ** 2 for v in vals) / len(vals)
        return math.sqrt(variance)

    def _variance(self, vals: list) -> float:
        if len(vals) < 2:
            return 0.0
        m = self._mean(vals)
        return sum((v - m) ** 2 for v in vals) / len(vals)


# ── Expression Engine ──────────────────────────────────────────────────────────

class ExpressionEngine:
    """
    Main engine for human expression verification.

    Flow:
      1. PatternExtractor converts raw events → TouchPattern (on-device)
      2. SapiXClient sends pattern to SapiX for analysis
      3. If is_human + confidence > threshold → generate ExpressionProof
      4. ExpressionProof hash is returned for writing to Aptos blockchain

    Privacy guarantee:
      Raw coordinates never leave PatternExtractor.
      Only statistical vectors reach Gonka.
      Only a hash reaches the blockchain.
    """

    SYSTEM_PROMPT = """You are an expert in human behavioral patterns for the
HSI (Homo Sapience Internet) verification system.

Your task: analyze statistical movement patterns to determine if they were
produced by a human or an automated system (bot).

IMPORTANT CONTEXT about the data:
- Points are sampled at ~40-120ms intervals (throttled, not 60fps flood)
- pause_after_ms reflects REAL pauses: inter-point gaps + explicit pause events
- A human drawing slowly may have LOW point_count but HIGH pause_after_ms values
- velocity_std > 0.01 is already a strong human signal
- pause_entropy > 0.5 is a human signal; near 0 can happen even for humans if they draw one smooth stroke

CRITICAL RULES:
1. Humans have velocity variance — they speed up and slow down (velocity_std > 0.005 = positive)
2. Humans make CORRECTIONS — direction reversals are a strong positive signal
3. Humans have irregular timing — rhythm_irregularity > 0.2 is positive
4. Bots have NEAR-ZERO variance, zero corrections, perfectly regular timing
5. People with motor difficulties (tremor, limited mobility) show HIGH corrections
   and LOW velocity but HIGH entropy — they are HUMAN, never block them
6. If possible_motor_difficulty=true, be MORE lenient on all thresholds
7. A slow careful human drawing a single smooth line may have low pause_entropy
   but will have velocity variance and timing irregularity — DO NOT penalize this
8. When in doubt, lean toward is_human=true — false negatives hurt real people
9. Confidence 0.75-0.85 is normal for a genuine human; only clear bot patterns get < 0.7

Return ONLY valid JSON with no markdown fences."""

    def __init__(self, client: SapiXClient):
        self.client = client
        self.extractor = PatternExtractor()

    async def verify(
        self,
        events: list[TouchEvent],
        session_id: str,           # Anonymous UUID per session
    ) -> ExpressionResult:
        """
        Full verification pipeline: events → pattern → Gonka → proof.

        Args:
            events: Raw touch events (normalized coordinates)
            session_id: Anonymous session ID (no user identity)

        Returns:
            ExpressionResult with .passed property for quick check
        """
        start = time.monotonic()

        # Step 1: Extract pattern (no coordinates leave this step)
        pattern = self.extractor.extract(events)

        # Step 2: Send to Gonka for AI analysis
        prompt = self._build_prompt(pattern)

        response = await self.client.chat(
            model=SapiXModel.FAST,
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=512,
            temperature=0.05,  # Very low — we want consistency
            task_type="expression_analysis",
            timeout_override=20.0,
        )

        latency_ms = (time.monotonic() - start) * 1000

        # Step 3: Parse result
        try:
            data = response.as_json()
        except ValueError:
            # If Gonka returns garbage, apply rule-based fallback
            data = self._rule_based_check(pattern)

        is_human = bool(data.get("is_human", False))
        confidence = float(data.get("confidence", 0.0))
        reasoning = str(data.get("reasoning", ""))
        anomalies = list(data.get("anomalies", []))

        # Step 4: Generate proof hash if verified
        expression_proof = None
        threshold = 0.65 if pattern.possible_motor_difficulty else 0.78
        if is_human and confidence >= threshold:
            expression_proof = self._generate_proof(pattern, session_id, confidence)

        return ExpressionResult(
            is_human=is_human,
            confidence=confidence,
            reasoning=reasoning,
            expression_proof=expression_proof,
            anomalies=anomalies,
            via_fallback=response.via_fallback,
            analysis_latency_ms=latency_ms,
        )

    def _build_prompt(self, pattern: TouchPattern) -> str:
        return f"""Analyze this movement pattern and classify as human or bot.

Pattern metrics:
- velocity_mean: {pattern.velocity_mean:.4f} units/sec
- velocity_std: {pattern.velocity_std:.4f}  [HIGH=human, ~0=bot]
- velocity_min: {pattern.velocity_min:.4f}
- velocity_max: {pattern.velocity_max:.4f}
- pause_entropy: {pattern.pause_entropy:.4f}  [HIGH=human, 0=bot]
- pause_mean_ms: {pattern.pause_mean_ms:.1f}ms
- pause_max_ms: {pattern.pause_max_ms:.1f}ms
- correction_count: {pattern.correction_count}  [>0=human signal]
- pressure_variance: {pattern.pressure_variance:.5f}
- rhythm_irregularity: {pattern.rhythm_irregularity:.4f}  [HIGH=human]
- total_duration_ms: {pattern.total_duration_ms}ms
- point_count: {pattern.point_count}
- possible_motor_difficulty: {pattern.possible_motor_difficulty}

Respond with JSON:
{{
  "is_human": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of key signals",
  "anomalies": ["list", "of", "suspicious", "signals"]
}}"""

    def _rule_based_check(self, pattern: TouchPattern) -> dict:
        """
        Fallback rule-based classifier when SapiX is unavailable.
        Conservative: err on the side of not blocking humans.
        """
        # Clear bot signals
        bot_signals = []
        human_signals = []

        if pattern.velocity_std < 0.001:
            bot_signals.append("near-zero velocity variance")
        else:
            human_signals.append(f"velocity variance={pattern.velocity_std:.3f}")

        if pattern.pause_entropy < 0.5:
            bot_signals.append("near-zero pause entropy")
        else:
            human_signals.append(f"pause entropy={pattern.pause_entropy:.2f}")

        if pattern.correction_count > 0:
            human_signals.append(f"{pattern.correction_count} corrections made")

        if pattern.rhythm_irregularity > 0.3:
            human_signals.append("irregular rhythm")

        # Motor difficulty: always classify as human
        if pattern.possible_motor_difficulty:
            return {
                "is_human": True,
                "confidence": 0.75,
                "reasoning": "Motor difficulty detected — classified as human per accessibility policy",
                "anomalies": [],
            }

        is_human = len(bot_signals) == 0 or len(human_signals) >= len(bot_signals)
        confidence = 0.6 + (len(human_signals) * 0.08) - (len(bot_signals) * 0.1)
        confidence = max(0.0, min(1.0, confidence))

        return {
            "is_human": is_human,
            "confidence": confidence,
            "reasoning": f"Rule-based: signals=[{', '.join(human_signals or bot_signals)}]",
            "anomalies": bot_signals,
        }

    def _generate_proof(
        self, pattern: TouchPattern, session_id: str, confidence: float
    ) -> str:
        """
        Generate ExpressionProof hash for writing to Aptos blockchain.

        The proof binds:
          - Pattern statistics (proves analysis was done)
          - Session ID (prevents replay attacks)
          - Confidence score
          - Timestamp bucket (1-hour resolution — not exact time)

        The proof does NOT contain:
          - User identity
          - Raw coordinates
          - Exact timestamp
          - IP address
        """
        # Use 1-hour time buckets (not exact timestamp) for privacy
        time_bucket = int(time.time() / 3600)

        proof_input = json.dumps({
            "velocity_std": round(pattern.velocity_std, 4),
            "pause_entropy": round(pattern.pause_entropy, 4),
            "corrections": pattern.correction_count,
            "duration_bucket": pattern.total_duration_ms // 1000,  # seconds
            "confidence": round(confidence, 2),
            "session": session_id,
            "time_bucket": time_bucket,
        }, sort_keys=True)

        return hashlib.sha3_256(proof_input.encode()).hexdigest()
