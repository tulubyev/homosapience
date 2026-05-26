# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
R1-D4 Alert service — write and maintain alert_events rows.

All public functions are no-ops when FEATURE_ALERTS is off.
record_alert deduplicates: skips identical active alert for the same
owner+event_type+api_key_pk within the last 5 minutes.
"""

from __future__ import annotations

import time
import logging
from typing import Optional

log = logging.getLogger("aptogon.alerts")

_DEDUP_WINDOW = 300  # 5 minutes


async def record_alert(
    db,
    owner_did: str,
    event_type: str,
    level: int,
    severity: str,
    detail: dict,
    api_key_pk: Optional[str] = None,
) -> None:
    """
    Write an alert row.  No-op when FEATURE_ALERTS is off.
    Deduplicates: skips if identical active alert exists for same
    owner+event_type+api_key_pk within the last 5 minutes.
    """
    from services.feature_flags import feature_enabled
    if not feature_enabled("ALERTS"):
        return
    try:
        cutoff = int(time.time()) - _DEDUP_WINDOW
        existing = await db.list_alerts(owner_did, status="active", limit=100)
        for row in existing:
            if (
                row["event_type"] == event_type
                and row.get("api_key_pk") == api_key_pk
                and row["ts"] >= cutoff
            ):
                return  # duplicate within window
        await db.create_alert(
            owner_did=owner_did,
            api_key_pk=api_key_pk,
            severity=severity,
            level=level,
            event_type=event_type,
            detail=detail,
        )
    except Exception as exc:
        log.warning("record_alert failed (owner=%s type=%s): %s", owner_did, event_type, exc)


async def auto_resolve_old(db) -> int:
    """
    Mark Level-1 'active' alerts older than 24 h as resolved by 'auto'.
    Called by daily cron.  Returns count resolved.
    """
    from services.feature_flags import feature_enabled
    if not feature_enabled("ALERTS"):
        return 0
    try:
        cutoff = int(time.time()) - 86400
        return await db.auto_resolve_alerts(cutoff)
    except Exception as exc:
        log.warning("auto_resolve_old failed: %s", exc)
        return 0


async def delete_expired(db) -> int:
    """
    Delete alerts older than 30 days.
    Called by daily cron.  Returns count deleted.
    """
    from services.feature_flags import feature_enabled
    if not feature_enabled("ALERTS"):
        return 0
    try:
        cutoff = int(time.time()) - (86400 * 30)
        return await db.delete_old_alerts(cutoff)
    except Exception as exc:
        log.warning("delete_expired failed: %s", exc)
        return 0
