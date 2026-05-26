# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
server_key.py — APTOGON server-side Ed25519 key for signing assertion JWTs.

Distinct from user DID keys. Loaded once from env APTOGON_JWT_PRIVATE_KEY
(base64url of 32 raw Ed25519 private-key bytes). If unset, the key is
unavailable and the EMBED_API feature must not come up (fail-safe — this is
a signing key, never silently fall back).

Tokens are JWT with alg=EdDSA. verify_jwt checks signature + exp only;
audience is checked by the caller against the API key's allowed_origins.
"""

from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

import jwt as pyjwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

_ALGO = "EdDSA"


def _b64url_nopad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


class ServerKey:
    def __init__(self, private_key_b64url: Optional[str]) -> None:
        self._priv: Optional[Ed25519PrivateKey] = None
        self._pub: Optional[Ed25519PublicKey] = None
        self._pub_raw: bytes = b""
        if private_key_b64url:
            try:
                raw = base64.urlsafe_b64decode(private_key_b64url + "==")
                self._priv = Ed25519PrivateKey.from_private_bytes(raw)
                self._pub = self._priv.public_key()
                self._pub_raw = self._pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
            except Exception:
                self._priv = None

    @property
    def available(self) -> bool:
        return self._priv is not None

    @property
    def kid(self) -> str:
        return hashlib.sha256(self._pub_raw).hexdigest()[:16]

    def sign_jwt(self, claims: dict) -> str:
        if not self._priv:
            raise RuntimeError("ServerKey unavailable — APTOGON_JWT_PRIVATE_KEY not set")
        headers = {"kid": self.kid}
        return pyjwt.encode(claims, self._priv, algorithm=_ALGO, headers=headers)

    def verify_jwt(self, token: str) -> Optional[dict]:
        """Verify signature + exp. Returns claims or None. Audience NOT checked here."""
        if not self._pub:
            return None
        try:
            return pyjwt.decode(
                token,
                self._pub,
                algorithms=[_ALGO],
                options={"verify_aud": False},
            )
        except Exception:
            return None

    def jwks(self) -> dict:
        return {
            "keys": [{
                "kty": "OKP",
                "crv": "Ed25519",
                "x": _b64url_nopad(self._pub_raw),
                "kid": self.kid,
                "use": "sig",
                "alg": _ALGO,
            }]
        }


_server_key: Optional[ServerKey] = None


def get_server_key() -> ServerKey:
    """Module-level singleton, reads APTOGON_JWT_PRIVATE_KEY from env once."""
    global _server_key
    if _server_key is None:
        _server_key = ServerKey(os.getenv("APTOGON_JWT_PRIVATE_KEY"))
    return _server_key
