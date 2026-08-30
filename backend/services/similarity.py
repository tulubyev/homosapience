"""Gesture-similarity maths for the consented lab study.

Pure functions, no I/O — mirrors sapix/experiments/gesture_similarity.py so the
admin panel and the offline script answer the same question the same way.

The question: does one person draw consistently enough that their own gestures
sit closer together than gestures from different people? Only answerable on
labelled, consented data — production `gesture_metrics` deliberately carries no
person key (see the schema comment and docs/strategy/anti-deanonymization.md),
which is why this operates on `research_gestures` instead.
"""
from __future__ import annotations

import math
import statistics

# Order matters only for internal consistency; any fixed order works.
FEATURES = [
    "rhythm_irregularity", "correction_count", "velocity_std", "velocity_mean",
    "velocity_curvature_r", "pause_entropy", "point_count", "duration_ms",
]


def zscore(rows: list[list[float]]) -> list[list[float]]:
    """Standardise per feature so milliseconds don't drown out a 0..1 ratio.

    A feature with no spread is divided by 1.0, contributing 0 to every
    distance rather than blowing up.
    """
    if not rows:
        return []
    n_feat = len(rows[0])
    means, sds = [], []
    for j in range(n_feat):
        col = [r[j] for r in rows]
        means.append(statistics.fmean(col))
        sd = statistics.pstdev(col)
        sds.append(sd if sd > 1e-12 else 1.0)
    return [[(r[j] - means[j]) / sds[j] for j in range(n_feat)] for r in rows]


def _dist(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _summarise(xs: list[float]) -> dict | None:
    if not xs:
        return None
    xs = sorted(xs)
    def q(p: float) -> float:
        return xs[min(len(xs) - 1, int(p * len(xs)))]
    return {
        "n": len(xs),
        "mean": round(statistics.fmean(xs), 4),
        "p10": round(q(0.10), 4),
        "median": round(q(0.50), 4),
        "p90": round(q(0.90), 4),
    }


def similarity_report(rows: list[list[float]], labels: list[str]) -> dict:
    """Within- vs between-subject pairwise distances in standardised space.

    `separation` = mean(between) / mean(within). Above ~1.3 a person resembles
    themselves more than they resemble others; near 1.0 these features carry no
    identity signal at all. Returns counts even when a split is empty so the UI
    can say "not enough data yet" rather than imply a result.
    """
    n = len(rows)
    subjects = sorted(set(labels))
    out = {
        "gestures": n,
        "subjects": len(subjects),
        "per_subject": {s: labels.count(s) for s in subjects},
        "within": None, "between": None, "separation": None, "verdict": None,
    }
    if n < 2:
        return out

    vecs = zscore(rows)
    within: list[float] = []
    between: list[float] = []
    for i in range(n):
        for j in range(i + 1, n):
            d = _dist(vecs[i], vecs[j])
            (within if labels[i] == labels[j] else between).append(d)

    out["within"] = _summarise(within)
    out["between"] = _summarise(between)
    if within and between:
        mw = statistics.fmean(within)
        if mw > 1e-12:
            sep = statistics.fmean(between) / mw
            out["separation"] = round(sep, 3)
            out["verdict"] = (
                "strong" if sep >= 2.0 else
                "moderate" if sep >= 1.3 else
                "weak" if sep >= 1.05 else
                "none"
            )
    return out
