# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
embed_service.py — R1 embed protocol helpers.

- Nonce lifecycle: Redis (TTL) with in-memory fallback (same pattern as auth.py).
  Single-worker deployment makes the fallback correct; multi-worker needs Redis.
- Redeemed-token guard: prevents the same assertion JWT being verified twice.
- trust_band: maps a numeric trust_score to a coarse band (no raw score leaks).
- assert_message: canonical bytes the user signs to prove DID ownership.
"""

from __future__ import annotations

import json
import time
from typing import Optional

# ── trust band ────────────────────────────────────────────────────────────────

def trust_band(trust_score: float) -> str:
    if trust_score >= 1.0:
        return "trusted"
    if trust_score >= 0.5:
        return "community"
    return "newcomer"


# ── canonical assert message ────────────────────────────────────────────────────

ASSERT_MSG_VERSION = "aptogon-embed-assert:v1"


def assert_message(nonce: str, origin: str, did: str) -> bytes:
    """Bytes the user signs with their DID key. Binds nonce + origin + did."""
    return f"{ASSERT_MSG_VERSION}:{nonce}:{origin}:{did}".encode()


# ── nonce store (Redis + in-memory fallback) ─────────────────────────────────────

_mem_nonces: dict[str, tuple[str, float]] = {}    # nonce → (json_value, expires_at)
_mem_redeemed: dict[str, float] = {}              # token_id → expires_at


def _evict() -> None:
    now = time.time()
    for k in [k for k, (_, exp) in _mem_nonces.items() if exp < now]:
        _mem_nonces.pop(k, None)
    for k in [k for k, exp in _mem_redeemed.items() if exp < now]:
        _mem_redeemed.pop(k, None)


async def store_nonce(redis, nonce: str, pk: str, origin: str, ttl: int = 300) -> None:
    value = json.dumps({"pk": pk, "origin": origin})
    if redis:
        await redis.setex(f"embed:nonce:{nonce}", ttl, value)
    else:
        _evict()
        _mem_nonces[nonce] = (value, time.time() + ttl)


async def consume_nonce(redis, nonce: str) -> Optional[dict]:
    """Return {pk, origin} and delete the nonce (single-use). None if absent."""
    if redis:
        key = f"embed:nonce:{nonce}"
        val = await redis.get(key)
        if not val:
            return None
        await redis.delete(key)
        return json.loads(val)
    _evict()
    item = _mem_nonces.pop(nonce, None)
    if not item:
        return None
    value, exp = item
    if exp < time.time():
        return None
    return json.loads(value)


async def mark_redeemed(redis, token_id: str, ttl: int = 300) -> bool:
    """Return True if this token_id was not seen before (and record it),
    False if it was already redeemed within the TTL window."""
    if redis:
        # SET NX returns True only if the key did not exist
        ok = await redis.set(f"embed:redeemed:{token_id}", "1", nx=True, ex=ttl)
        return bool(ok)
    _evict()
    if token_id in _mem_redeemed and _mem_redeemed[token_id] > time.time():
        return False
    _mem_redeemed[token_id] = time.time() + ttl
    return True
