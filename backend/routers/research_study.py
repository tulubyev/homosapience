# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/api/research/study — consented gesture-similarity lab study.

POST /gesture     → store one gesture under a volunteer's pseudonym (study code)
GET  /similarity  → within- vs between-subject distances (admin only)

Why a separate table and a separate endpoint: production `gesture_metrics`
deliberately carries no person key ("Zero PII" in its schema comment), and
docs/strategy/anti-deanonymization.md commits the architecture to resisting a
linked mode by default — Shielded Human depends on that. Grouping gestures by
person is exactly what the similarity question needs, so it happens here, on
data volunteers knowingly label, and never on live traffic.

Gated twice: the GESTURE_STUDY feature flag, and a study code the admin sets in
RESEARCH_STUDY_CODE. Unset code = endpoint closed (fail closed, not open).
"""
from __future__ import annotations

import hmac
import os
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from routers._auth_helpers import extract_did
from routers.verify import TouchEventDTO
from services.feature_flags import feature_enabled

router = APIRouter()

# A pseudonym, not an identity: short, opaque, chosen by the volunteer.
_LABEL_RE = re.compile(r"^[A-Za-z0-9_-]{2,32}$")


class StudyGestureReq(BaseModel):
    study_code:    str = Field(min_length=1, max_length=128)
    subject_label: str = Field(min_length=2, max_length=32)
    seq:           int = Field(default=0, ge=0, le=1000)
    events:        list[TouchEventDTO] = Field(min_length=10)


def _check_code(supplied: str) -> None:
    expected = os.getenv("RESEARCH_STUDY_CODE", "")
    if not expected:
        # No code configured → the study is not open. Never fall through to
        # "anyone may write rows".
        raise HTTPException(status_code=403, detail={
            "error": "study_closed",
            "message": "The gesture study is not currently accepting submissions.",
        })
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail={
            "error": "bad_study_code",
            "message": "That study code is not valid.",
        })


@router.post("/gesture")
async def submit_study_gesture(body: StudyGestureReq, request: Request):
    if not feature_enabled("GESTURE_STUDY"):
        raise HTTPException(status_code=404, detail="not_found")
    _check_code(body.study_code)

    label = body.subject_label.strip()
    if not _LABEL_RE.match(label):
        raise HTTPException(status_code=400, detail={
            "error": "invalid_label",
            "message": "Use 2–32 characters: letters, digits, - or _.",
        })

    from sapix.expression_engine import PatternExtractor, TouchEvent
    events = [
        TouchEvent(x=e.x, y=e.y, pressure=e.pressure,
                   timestamp_ms=e.timestamp_ms, pause_after_ms=e.pause_after_ms)
        for e in body.events
    ]
    try:
        pattern = PatternExtractor().extract(events)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={
            "error": "bad_gesture", "message": str(exc),
        })

    db = getattr(request.app.state, "db", None)
    if db:
        await db.log_research_gesture(
            subject_label=label,
            seq=body.seq,
            rhythm_irregularity=round(pattern.rhythm_irregularity, 4),
            correction_count=pattern.correction_count,
            velocity_std=round(pattern.velocity_std, 4),
            velocity_mean=round(pattern.velocity_mean, 4),
            velocity_curvature_r=round(pattern.velocity_curvature_r, 4),
            pause_entropy=round(pattern.pause_entropy, 4),
            point_count=pattern.point_count,
            duration_ms=pattern.total_duration_ms,
            lift_count=pattern.lift_count,
            total_lift_ms=pattern.total_lift_ms,
        )
    # Only the derived statistics are stored; raw coordinates stay in this
    # process exactly as they do on the production path.
    return {"ok": True, "seq": body.seq, "point_count": pattern.point_count}


@router.get("/similarity")
async def study_similarity(request: Request):
    """Admin only.

    The guard is spelled out here rather than imported from routers/admin.py:
    that module is stripped from the public open-source mirror, so importing it
    would leave a dangling reference in every self-hosted copy. Both pieces used
    below live in modules that are published.
    """
    did = extract_did(request)
    db = getattr(request.app.state, "db", None)
    if not did or not db or not await db.is_admin_did(did[-8:]):
        raise HTTPException(status_code=403, detail={
            "error": "admin_required",
            "message": "This endpoint requires admin privileges.",
        })
    report = await db.get_research_similarity()
    report["study_open"] = bool(
        feature_enabled("GESTURE_STUDY") and os.getenv("RESEARCH_STUDY_CODE", "")
    )
    return report
