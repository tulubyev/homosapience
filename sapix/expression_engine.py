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

    # Biomechanical invariant (2/3 power law, default=0.0 when not computable)
    # Human: negative (fast = straight, slow = curved).  Synthetic: near 0.
    velocity_curvature_r: float = 0.0

    # Accessibility flag (affects thresholds)
    possible_motor_difficulty: bool = False

    # Pen lifts — OBSERVATION ONLY, deliberately not fed to the classifier yet.
    # The client samples a held-still finger every ~120ms, so any pause far above
    # that cadence means the pen actually left the pad. Derived here rather than
    # reported by the client: a self-declared "I lifted 5 times" would be trivial
    # to forge, a pause in the timestamps is not.
    lift_count: int = 0
    total_lift_ms: int = 0


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
    provider: str = ""   # AI provider that served this analysis (joingonka/together/…); "" if no AI ran

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

    # A pen-down pause is sampled every ~120ms by the client, so a gap this far
    # above that cadence can only mean the pen left the pad.
    LIFT_PAUSE_THRESHOLD_MS = 400

    def extract(self, events: list[TouchEvent]) -> TouchPattern:
        if len(events) < 3:
            raise ValueError("Need at least 3 touch events to extract pattern")

        velocities = self._calc_velocities(events)
        pauses = [e.pause_after_ms for e in events]
        corrections = self._count_corrections(events)
        lifts = [p for p in pauses if p >= self.LIFT_PAUSE_THRESHOLD_MS]

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
            pause_entropy=self._pause_entropy(pauses),
            pause_mean_ms=self._mean(pauses),
            pause_max_ms=max(pauses) if pauses else 0,
            correction_count=corrections,
            pressure_variance=self._variance([e.pressure for e in events]),
            rhythm_irregularity=self._rhythm_irregularity(events),
            velocity_curvature_r=self._velocity_curvature_r(events),
            total_duration_ms=total_ms,
            point_count=len(events),
            possible_motor_difficulty=possible_motor,
            lift_count=len(lifts),
            total_lift_ms=int(sum(lifts)),
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
            if (prev_dx * next_dx < -0.0002 or prev_dy * next_dy < -0.0002):
                corrections += 1
        return corrections

    def _pause_entropy(self, pauses: list) -> float:
        """Entropy of the pause distribution — how varied the gaps between points are.

        Two corrections over a plain histogram of the raw values, both of which
        were making humans look like bots:

        1. **Lift-scale gaps are excluded.** A pen lift is now measured in its own
           right (lift_count / total_lift_ms). Leaving a 2000ms gap in this
           histogram double-counts it and, worse, stretches the min–max range so
           far that the 400 real ~45ms samples all collapse into one bucket —
           entropy near zero. A human who paused scored *lower* than a machine
           drawing a perfectly even line.
        2. **Bucketing happens in log space.** Pause lengths span orders of
           magnitude (a 45ms sampling gap vs a 250ms hesitation), so a linear
           histogram spends nine of its ten buckets on empty space. In log space
           the difference between 45 and 50 and between 200 and 250 both register.

        Measured on the same fixtures: a gesture with ordinary pen-down pauses
        went from 0.11 (read as a bot signal) to 0.77, while a perfectly uniform
        synthetic stream still scores 0.0.
        """
        vals = [p for p in pauses if p < self.LIFT_PAUSE_THRESHOLD_MS]
        if len(vals) < 2:
            vals = list(pauses)          # nothing left to compare — use what we have
        return self._entropy([math.log1p(max(0.0, float(v))) for v in vals])

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

    def _velocity_curvature_r(self, events: list[TouchEvent]) -> float:
        """
        Pearson correlation between speed and curvature (Menger).

        The 2/3 power law of human motor control predicts a *negative*
        correlation: humans slow down at curves, accelerate on straights.
        Synthetic Brownian motion generates independent speed and curvature
        → correlation ≈ 0.

        Returns value in [-1, 1].  Human baseline: typically < −0.15.
        """
        if len(events) < 5:
            return 0.0

        speeds: list[float] = []
        kappas: list[float] = []

        for i in range(1, len(events) - 1):
            x1, y1 = events[i-1].x, events[i-1].y
            x2, y2 = events[i].x, events[i].y
            x3, y3 = events[i+1].x, events[i+1].y

            dx1, dy1 = x2 - x1, y2 - y1
            dx2, dy2 = x3 - x2, y3 - y2
            cross = abs(dx1 * dy2 - dy1 * dx2)
            d1 = math.sqrt(dx1*dx1 + dy1*dy1)
            d2 = math.sqrt(dx2*dx2 + dy2*dy2)
            d3 = math.sqrt((x3-x1)**2 + (y3-y1)**2)
            denom = d1 * d2 * d3
            if denom < 1e-12:
                continue

            kappas.append(2.0 * cross / denom)
            dt = max(1, events[i].timestamp_ms - events[i-1].timestamp_ms)
            speeds.append(d1 / dt * 1000.0)

        return self._pearson(speeds, kappas)

    def _pearson(self, x: list[float], y: list[float]) -> float:
        n = len(x)
        if n < 3 or n != len(y):
            return 0.0
        mx, my = self._mean(x), self._mean(y)
        sx = math.sqrt(sum((xi - mx)**2 for xi in x) / n)
        sy = math.sqrt(sum((yi - my)**2 for yi in y) / n)
        if sx < 1e-12 or sy < 1e-12:
            return 0.0
        return sum((x[i] - mx) * (y[i] - my) for i in range(n)) / (n * sx * sy)

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
1. Humans have velocity variance — velocity_std > 0.01 = positive; < 0.003 = strong bot signal
2. Humans make CORRECTIONS — direction reversals are a positive signal; zero corrections is suspicious
3. Humans have irregular timing — rhythm_irregularity > 0.15 is positive; < 0.05 = bot signal
4. Humans follow the 2/3 power law: velocity_curvature_r should be NEGATIVE (fast on straights,
   slow at curves). Near-zero or positive r is a synthetic motion signal.
5. Bots have NEAR-ZERO variance, zero corrections, regular timing, and no velocity-curvature coupling
6. People with motor difficulties (tremor, limited mobility) show HIGH corrections
   and LOW velocity but HIGH entropy — they are HUMAN, never block them
7. If possible_motor_difficulty=true, be MORE lenient on all thresholds
8. A slow careful human drawing a single smooth line may have low pause_entropy
   but will have velocity variance and timing irregularity — DO NOT penalize this
9. When in doubt, lean toward is_human=true — false negatives hurt real people
10. Confidence 0.75-0.85 is normal for a genuine human; only clear bot patterns get < 0.7

Return ONLY valid JSON with no markdown fences."""

    def __init__(self, client: SapiXClient):
        self.client = client
        self.extractor = PatternExtractor()

    # ── Pre-flight gate thresholds ─────────────────────────────────────────────
    # These catch synthetic generators BEFORE wasting an AI inference.
    # Humans virtually never fall below these values; bots reliably do.
    # Motor-difficulty users always bypass (possible_motor_difficulty=True).
    PREFLIGHT_RHYTHM_MIN = 0.05    # below this = metronome / synthetic timing

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

        # Step 1b: Pre-flight gate — reject obvious synthetic patterns cheaply
        rejection = self._pre_flight_gate(pattern)
        if rejection is not None:
            rejection.analysis_latency_ms = (time.monotonic() - start) * 1000
            return rejection

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
            provider=response.provider,
        )

    def verify_local(self, events, session_id, classifier,
                     high: float = 0.85, low: float = 0.15) -> "ExpressionResult | None":
        """Gray-zone fast path — decide with the LOCAL classifier, no AI provider.

        Returns an ExpressionResult only when the model is CONFIDENT (p ≥ high →
        human, p ≤ low → bot); returns None for the uncertain middle band, for
        accessibility (motor-difficulty) cases, and when the classifier is
        unavailable — the caller then falls back to the LLM. Never raises.

        `classifier` is duck-typed (services.gesture_classifier.GestureClassifier)
        so this module keeps no backend dependency.
        """
        try:
            pattern = self.extractor.extract(events)
        except Exception:
            return None
        # Obvious synthetic → local reject (same cheap gate as the AI path).
        rej = self._pre_flight_gate(pattern)
        if rej is not None:
            rej.provider = "local_gbm"   # label it as a local decision (no LLM ran)
            return rej
        # Never let the model hard-decide accessibility cases — defer to the LLM.
        if getattr(pattern, "possible_motor_difficulty", False):
            return None
        res = classifier.classify(pattern) if classifier is not None else None
        if res is None:
            return None
        p = float(res.confidence)   # P(human)
        if p >= high:
            proof = self._generate_proof(pattern, session_id, p)   # p ≥ high ≥ 0.78 → always issue
            return ExpressionResult(
                is_human=True, confidence=p,
                reasoning=f"local GBM {res.model_version}: confident human",
                expression_proof=proof, anomalies=[], via_fallback=False,
                provider="local_gbm",
            )
        if p <= low:
            return ExpressionResult(
                is_human=False, confidence=p,
                reasoning=f"local GBM {res.model_version}: confident bot",
                expression_proof=None, anomalies=[], via_fallback=False,
                provider="local_gbm",
            )
        return None   # gray zone → caller uses the LLM

    def _pre_flight_gate(self, pattern: TouchPattern) -> "ExpressionResult | None":
        """
        Cheap pre-AI gate that rejects clearly synthetic patterns.

        Runs after PatternExtractor but before any AI inference.
        Motor-difficulty users always bypass (possible_motor_difficulty=True).
        """
        if pattern.possible_motor_difficulty:
            return None

        anomalies: list[str] = []

        if pattern.rhythm_irregularity < self.PREFLIGHT_RHYTHM_MIN:
            anomalies.append(
                f"rhythm_too_regular:{pattern.rhythm_irregularity:.4f}"
                f"<{self.PREFLIGHT_RHYTHM_MIN}"
            )

        # NOTE: correction_count cannot be used as a hard gate — PatternExtractor
        # threshold -0.0002 detects Brownian noise fluctuations as corrections, so
        # nc=0 synthetic bots still register correction_count > 0. Passed to AI as
        # a weighted signal instead. Revisit after collecting real-user baseline data.
        # NOTE: velocity_curvature_r similarly passed to AI only (needs calibration).

        if not anomalies:
            return None

        return ExpressionResult(
            is_human=False,
            confidence=0.0,
            reasoning=f"Pre-flight gate: {'; '.join(anomalies)}",
            expression_proof=None,
            anomalies=anomalies,
        )

    def _build_prompt(self, pattern: TouchPattern) -> str:
        # Pressure is device-dependent: mice and most trackpads have NO pressure
        # sensor, so the browser reports a constant value → pressure_variance ≈ 0.
        # That is normal desktop input, NOT a bot signal. Present it as N/A when
        # constant so the model judges humanity from motion dynamics (which work
        # for mouse too) instead of penalizing the missing pressure channel.
        if pattern.pressure_variance < 0.001:
            pressure_line = (
                "- pressure_variance: N/A  "
                "[constant pressure — typical of mouse/trackpad (no pressure sensor); "
                "NOT a bot signal; judge from motion dynamics]"
            )
        else:
            pressure_line = (
                f"- pressure_variance: {pattern.pressure_variance:.5f}  "
                "[touch input: some variation expected from a real finger]"
            )
        return f"""Analyze this movement pattern and classify as human or bot.

Pattern metrics:
- velocity_mean: {pattern.velocity_mean:.4f} units/sec
- velocity_std: {pattern.velocity_std:.4f}  [HIGH=human, ~0=bot]
- velocity_min: {pattern.velocity_min:.4f}
- velocity_max: {pattern.velocity_max:.4f}
- pause_entropy: {pattern.pause_entropy:.4f}  [HIGH=human, 0=bot]
- pause_mean_ms: {pattern.pause_mean_ms:.1f}ms
- pause_max_ms: {pattern.pause_max_ms:.1f}ms
- correction_count: {pattern.correction_count}  [>0=human signal, 0=suspicious]
{pressure_line}
- rhythm_irregularity: {pattern.rhythm_irregularity:.4f}  [>0.15=human, <0.05=bot]
- velocity_curvature_r: {pattern.velocity_curvature_r:.4f}  [<-0.3=strong human, -0.3..-0.1=ambiguous, >-0.1=suspicious synthetic]
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
