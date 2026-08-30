"""Unit tests for services/gesture_classifier.py (local GBM).

Self-contained — builds lightweight pattern stubs (SimpleNamespace with the 8
feature attributes) instead of importing the sapix experiment harness, so the
public test suite stays clean. Tests the loaded artifact + graceful degradation.
"""
from types import SimpleNamespace

import pytest

from services.gesture_classifier import GestureClassifier, ClsResult


def _pattern(**over):
    """A TouchPattern-shaped stub carrying the features the model reads."""
    base = dict(
        rhythm_irregularity=0.5, correction_count=8, velocity_std=0.02,
        velocity_mean=0.015, velocity_curvature_r=-0.3, pause_entropy=1.5,
        point_count=110, total_duration_ms=2500,
    )
    base.update(over)
    return SimpleNamespace(**base)


HUMAN_LIKE = _pattern()                              # high variance/entropy/rhythm, corrections
BOT_LIKE = _pattern(rhythm_irregularity=0.01, correction_count=0, velocity_std=0.0005,
                    pause_entropy=0.1, velocity_curvature_r=0.0)


# The trained artifact is deliberately absent from the open-source mirror
# (training know-how, see scripts/sync-to-public.sh). These two tests assert the
# model's behaviour, so they skip rather than fail where it was never shipped —
# a self-hoster running the suite should see green, not a phantom regression.
# test_missing_model_is_graceful below covers the absent-artifact path itself.
_needs_model = pytest.mark.skipif(
    not GestureClassifier().available,
    reason="trained GBM artifact not present (excluded from the public mirror)",
)


@_needs_model
def test_model_loads():
    gc = GestureClassifier()
    assert gc.available is True
    assert gc._version and gc._version != "unknown"


@_needs_model
def test_human_scores_higher_than_bot():
    gc = GestureClassifier()
    rh, rb = gc.classify(HUMAN_LIKE), gc.classify(BOT_LIKE)
    assert isinstance(rh, ClsResult) and isinstance(rb, ClsResult)
    # Relative check (robust to model version): the human-like pattern must read
    # as more human than the bot-like one.
    assert rh.confidence > rb.confidence
    assert rh.is_human is True
    assert rb.is_human is False


def test_missing_model_is_graceful():
    gc = GestureClassifier(model_dir="/nonexistent/path/gesture_gbm")
    assert gc.available is False
    assert gc.classify(HUMAN_LIKE) is None          # returns None, never raises


def test_pattern_missing_feature_returns_none():
    gc = GestureClassifier()
    incomplete = SimpleNamespace(rhythm_irregularity=0.5)   # missing the rest
    assert gc.classify(incomplete) is None          # no raise
