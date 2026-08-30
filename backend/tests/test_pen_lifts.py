"""gesture_metrics hygiene: pen-lift derivation, and device_hint categorisation.

Lifting the finger mid-gesture is human behaviour, so the client no longer
fabricates points while the pen is up — a lift now reaches the server as a
single large `pause_after_ms` on the resume point. These tests pin that the
extractor reads lifts back out of the timestamps, and that ordinary pen-down
pauses (sampled ~120ms apart) are NOT mistaken for lifts.

Derived server-side on purpose: a client-declared "I lifted 3 times" would be
trivial to forge, a gap in the timestamps is not.
"""
import pytest

from sapix.expression_engine import PatternExtractor, TouchEvent
from services.device_fingerprint import categorize_device_hint


def _events(pauses: list[int]) -> list[TouchEvent]:
    """Build a gesture whose i-th point carries pauses[i] as pause_after_ms.

    Coordinates drift so the pattern is a real stroke rather than a dead point.
    """
    evs, t = [], 1_000_000
    for i, p in enumerate(pauses):
        t += p
        evs.append(TouchEvent(
            x=0.1 + i * 0.01, y=0.2 + (i % 3) * 0.01,
            pressure=0.5, timestamp_ms=t, pause_after_ms=p,
        ))
    return evs


def test_pen_down_sampling_is_not_a_lift():
    """A held-still finger is sampled every ~120ms — that is a pause, not a lift."""
    pattern = PatternExtractor().extract(_events([45, 120, 120, 130, 45, 120, 60]))
    assert pattern.lift_count == 0
    assert pattern.total_lift_ms == 0


def test_single_lift_is_counted():
    """One gap far above the sampling cadence = the pen left the pad once."""
    pattern = PatternExtractor().extract(_events([45, 120, 2_400, 45, 120, 60]))
    assert pattern.lift_count == 1
    assert pattern.total_lift_ms == 2_400


def test_multiple_lifts_accumulate():
    pattern = PatternExtractor().extract(_events([45, 1_500, 120, 45, 3_000, 60, 900]))
    assert pattern.lift_count == 3
    assert pattern.total_lift_ms == 1_500 + 3_000 + 900


def test_threshold_boundary():
    """Exactly at the threshold counts; just under it does not."""
    thr = PatternExtractor.LIFT_PAUSE_THRESHOLD_MS
    assert PatternExtractor().extract(_events([45, thr, 45, 60])).lift_count == 1
    assert PatternExtractor().extract(_events([45, thr - 1, 45, 60])).lift_count == 0


def test_lifts_do_not_leak_into_classifier_features():
    """Lift stats ride alongside the 8 trained features, they do not replace or
    perturb them — the production GBM never sees a lift as an input."""
    trained = [
        "rhythm_irregularity", "correction_count", "velocity_std", "velocity_mean",
        "velocity_curvature_r", "pause_entropy", "point_count", "total_duration_ms",
    ]
    quiet  = PatternExtractor().extract(_events([45, 120, 120, 45, 120, 60]))
    lifted = PatternExtractor().extract(_events([45, 120, 2_000, 45, 120, 60]))
    assert lifted.lift_count == 1 and quiet.lift_count == 0
    # Every trained feature still exists and is numeric on both patterns.
    for f in trained:
        assert isinstance(getattr(quiet, f), (int, float))
        assert isinstance(getattr(lifted, f), (int, float))


# ── device_hint categorisation ───────────────────────────────────────────────
# gesture_metrics declares itself zero-PII and documents device_hint as a form
# factor, but both writers used to store the raw User-Agent (80 chars) — a weak
# fingerprint in a table that promises not to hold one.


@pytest.mark.parametrize("ua,expected", [
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "phone"),
    ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36", "phone"),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "desktop"),
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "desktop"),
    ("Mozilla/5.0 (X11; Linux x86_64)", "desktop"),
    ("curl/8.4.0", "unknown"),
    ("", "unknown"),
    (None, "unknown"),
])
def test_device_hint_is_a_category_not_a_fingerprint(ua, expected):
    assert categorize_device_hint(ua) == expected


def test_device_hint_never_returns_the_raw_ua():
    ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0"
    out = categorize_device_hint(ua)
    assert out in {"phone", "desktop", "unknown"}
    assert ua[:20] not in out


# ── pause_entropy must not punish a human for pausing ────────────────────────
# A histogram over raw pause values collapses when one gap is far larger than
# the rest: 400 samples at ~45ms plus a single 2s lift all land in one bucket,
# so entropy craters. The perverse result was that a machine drawing a perfectly
# even line scored HIGHER than a person who paused.

def _pauses(n=400, seed=3):
    import random
    rnd = random.Random(seed)
    return [rnd.choice([43, 45, 47, 50, 52, 46, 48]) for _ in range(n)]


def test_a_human_who_pauses_is_not_read_as_a_bot():
    """The reported failure: pen-down pauses plus one lift scored 0.048."""
    e = PatternExtractor()._pause_entropy(_pauses() + [120, 125, 118, 240, 130, 2000])
    assert e > 0.5, f"a pausing human still reads as a bot: {e}"


def test_a_single_lift_does_not_flatten_the_histogram():
    quiet = PatternExtractor()._pause_entropy(_pauses())
    lifted = PatternExtractor()._pause_entropy(_pauses() + [2000])
    assert lifted > 0.5
    # The lift is counted as a lift elsewhere; it must not also dominate here.
    assert abs(lifted - quiet) < 0.01


def test_a_perfectly_uniform_stream_still_scores_zero():
    """The signal must keep working: no variation at all is a bot signal."""
    assert PatternExtractor()._pause_entropy([50] * 400) == 0.0


def test_entropy_survives_a_degenerate_input():
    e = PatternExtractor()
    assert e._pause_entropy([]) == 0.0
    assert e._pause_entropy([5000]) == 0.0        # only a lift, nothing to compare
    assert e._pause_entropy([0, 0, 0]) == 0.0
