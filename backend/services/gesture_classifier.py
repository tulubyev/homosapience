"""
gesture_classifier.py — local GBM gesture classifier (bot vs human).

Loads the trained artifact (backend/models/gesture_gbm/{model.joblib,meta.json})
once and classifies a TouchPattern from the SAME algorithmic features the prod
PatternExtractor already computes — in milliseconds, offline, no AI provider.

Degrades gracefully (mirror services/ip_intel.py): if scikit-learn/joblib are not
installed, or the artifact is missing/corrupt, `available` stays False and
`classify()` returns None — the caller falls back to the LLM. Never raises.

Trained by sapix/experiments/train_gesture_model.py. See docs/strategy/
finetuning-loop.md for the rollout (shadow → gray-zone) and label discipline.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

try:
    import joblib
    _HAS_JOBLIB = True
except ImportError:
    _HAS_JOBLIB = False

# backend/services/gesture_classifier.py → backend/models/gesture_gbm/
_DEFAULT_DIR = Path(__file__).resolve().parent.parent / "models" / "gesture_gbm"


@dataclass
class ClsResult:
    is_human: bool
    confidence: float        # P(human) ∈ [0,1] — higher = more human
    model_version: str


class GestureClassifier:
    """Lazy-loaded local GBM. Thread-safe for reads (model held in memory)."""

    def __init__(self, model_dir: Optional[str] = None) -> None:
        self._dir = Path(model_dir or os.getenv("GESTURE_MODEL_DIR", str(_DEFAULT_DIR)))
        self._model: Any = None
        self._features: list[str] = []
        self._version: str = "unknown"
        self.available = False
        self._load()

    def _load(self) -> None:
        if not _HAS_JOBLIB:
            print("⚠️  gesture_classifier: joblib/scikit-learn not installed — local GBM disabled")
            return
        model_path, meta_path = self._dir / "model.joblib", self._dir / "meta.json"
        if not model_path.exists() or not meta_path.exists():
            print(f"⚠️  gesture_classifier: artifact not found at {self._dir} — local GBM disabled")
            return
        try:
            meta = json.loads(meta_path.read_text())
            self._features = list(meta["features"])   # exact order the vector must follow
            self._version = meta.get("model_version", "unknown")
            # SAFETY: joblib.load un-pickles (arbitrary-code-execution risk for
            # UNTRUSTED files). This artifact is FIRST-PARTY only — produced by our
            # own sapix/experiments/train_gesture_model.py, committed to this repo,
            # and shipped inside the image at a fixed path. It is never user-uploaded
            # or fetched from an external source, so the pickle path is trusted.
            self._model = joblib.load(model_path)
            self.available = True
            print(f"✅ gesture_classifier: GBM loaded ({self._version}, {len(self._features)} features)")
        except Exception as exc:  # noqa: BLE001 — never let a bad artifact crash startup
            print(f"⚠️  gesture_classifier: failed to load {self._dir}: {exc}")

    def classify(self, pattern: Any) -> Optional[ClsResult]:
        """Return a ClsResult, or None if the model is unavailable / features are
        missing on the pattern. Never raises."""
        if not self.available or self._model is None:
            return None
        try:
            vec = [float(getattr(pattern, f)) for f in self._features]
        except (AttributeError, TypeError, ValueError):
            return None
        try:
            p_human = float(self._model.predict_proba([vec])[0][1])
        except Exception:  # noqa: BLE001
            return None
        return ClsResult(is_human=p_human >= 0.5, confidence=p_human,
                         model_version=self._version)
