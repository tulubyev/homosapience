# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
api_keys.py — Stripe-style organization API keys.

publishable_key (pk_live_*) — public, embedded in client code, stored plaintext.
secret_key      (sk_live_*) — secret, used server-to-server, stored only as
                              SHA-256 hash, shown to the owner exactly once.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets


def generate_key_pair() -> tuple[str, str]:
    """Return (publishable_key, secret_key). Caller stores hash of secret only."""
    pk = "pk_live_" + secrets.token_urlsafe(24)
    sk = "sk_live_" + secrets.token_urlsafe(32)
    return pk, sk


def hash_secret(secret_key: str) -> str:
    """SHA-256 hex of the secret key (what we persist)."""
    return hashlib.sha256(secret_key.encode()).hexdigest()


def verify_secret(secret_key: str, secret_hash: str) -> bool:
    """Constant-time comparison of a presented secret against the stored hash."""
    return hmac.compare_digest(hash_secret(secret_key), secret_hash)
