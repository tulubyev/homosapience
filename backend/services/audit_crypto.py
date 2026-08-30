# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
audit_crypto — sealed-box at-rest encryption for the Bond audit graph.

Shielded Human / anti-deanonymization: the Bond "who-vouched-for-whom" edges are
operationally useful to admins (Sybil/abuse investigation) but a deanonymization
risk if the DB is breached or subpoenaed. We resolve this with a public-key
**sealed box** (libsodium / PyNaCl `SealedBox`, X25519 + XSalsa20-Poly1305):

  - Production holds ONLY the public key (env `BOND_AUDIT_PUBKEY`). It can ENCRYPT
    new edges but CANNOT read them back.
  - The matching private key lives OFFLINE with the admin. Decryption (`unseal`)
    happens off the production host, e.g. in a CLI when an investigation needs it.

A DB dump therefore yields only ciphertext — the plaintext DID never leaves the
admin's offline key. We deliberately use a vetted libsodium binding rather than
hand-rolling crypto.

Admin setup:
    python3 -c "from services.audit_crypto import generate_keypair; \
                pub, priv = generate_keypair(); \
                print('BOND_AUDIT_PUBKEY=' + pub); print('PRIVATE (offline):', priv)"
Put `BOND_AUDIT_PUBKEY` in the prod .env; store the private key offline only.
"""
from __future__ import annotations

import base64
import os
from typing import Optional

from nacl.public import PrivateKey, PublicKey, SealedBox

_ENV_PUBKEY = "BOND_AUDIT_PUBKEY"


def generate_keypair() -> tuple[str, str]:
    """Return (public_key_b64, private_key_b64). Run offline; publish only the
    public key to prod, keep the private key off the server."""
    sk = PrivateKey.generate()
    pub = base64.b64encode(bytes(sk.public_key)).decode()
    priv = base64.b64encode(bytes(sk)).decode()
    return pub, priv


def _load_pubkey(pubkey_b64: Optional[str]) -> Optional[PublicKey]:
    raw = pubkey_b64 if pubkey_b64 is not None else os.getenv(_ENV_PUBKEY)
    if not raw:
        return None
    return PublicKey(base64.b64decode(raw))


def is_enabled() -> bool:
    """True when a public key is configured (encryption can run)."""
    return bool(os.getenv(_ENV_PUBKEY))


def seal(plaintext: Optional[str], pubkey_b64: Optional[str] = None) -> Optional[bytes]:
    """Encrypt a DID (or any string) to the audit public key. Returns ciphertext
    bytes, or None when there is nothing to encrypt or no public key is set.
    Production only ever calls this — it cannot decrypt."""
    if not plaintext:
        return None
    pub = _load_pubkey(pubkey_b64)
    if pub is None:
        return None
    return SealedBox(pub).encrypt(plaintext.encode())


def unseal(ciphertext: bytes, privkey_b64: str) -> str:
    """Decrypt a sealed edge with the OFFLINE private key. Not used by production —
    intended for an admin investigation tool running off the prod host."""
    sk = PrivateKey(base64.b64decode(privkey_b64))
    return SealedBox(sk).decrypt(ciphertext).decode()
