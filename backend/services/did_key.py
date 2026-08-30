"""
aptogon/did_key.py — W3C DID + реальный Ed25519.

Ключи генерируются через cryptography.hazmat (libsodium под капотом).
Никаких placeholder'ов — все подписи верифицируемы.

Формат хранения private key:
    base64url(32 raw bytes)  →  localStorage('aptogon_key')

Совместимость с браузером:
    WebCrypto Ed25519 принимает ключ в формате PKCS#8.
    Конвертация: raw 32 bytes → PKCS8_PREFIX + raw  (см. фронтенд)
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    PrivateFormat,
    NoEncryption,
)
from cryptography.exceptions import InvalidSignature


# ── Multibase / Multicodec ────────────────────────────────────────────────────
# did:key uses base58btc multibase + ed25519-pub multicodec prefix (0xed 0x01)

BASE58_ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58encode(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    result = []
    while n:
        n, r = divmod(n, 58)
        result.append(BASE58_ALPHABET[r:r + 1])
    result.extend([BASE58_ALPHABET[0:1]] * (len(data) - len(data.lstrip(b"\x00"))))
    return b"".join(reversed(result)).decode()


def _b58decode(s: str) -> bytes:
    n = 0
    for c in s.encode():
        n = n * 58 + BASE58_ALPHABET.index(c)
    result = n.to_bytes((n.bit_length() + 7) // 8, "big")
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + result


def _pubkey_from_did(did: str) -> Ed25519PublicKey:
    """
    Извлекает Ed25519 публичный ключ из did:key строки.
    did:key:z6Mk... → multibase decode → strip multicodec prefix → 32 raw bytes
    """
    try:
        suffix = did.split("did:key:")[1]          # z6Mk...
        raw = _b58decode(suffix[1:])               # strip 'z' multibase prefix
        pub_bytes = raw[2:]                        # strip 0xed 0x01 multicodec prefix
        if len(pub_bytes) != 32:
            raise ValueError(f"Expected 32 bytes, got {len(pub_bytes)}")
        return Ed25519PublicKey.from_public_bytes(pub_bytes)
    except Exception as exc:
        raise ValueError(f"Cannot extract public key from DID '{did}': {exc}") from exc


# ── Canonical message для bond approval ──────────────────────────────────────
# Менять версию при изменении формата — старые подписи станут невалидны.

BOND_APPROVAL_VERSION = "aptogon-bond-approval:v1"


def bond_approval_message(request_id: str, requester_did: str, timestamp: int) -> bytes:
    """
    Канонический байтовый вид сообщения для подписи одобрения бонда.

    Формат: "aptogon-bond-approval:v1:{request_id}:{requester_did}:{timestamp}"

    Привязывает:
      - request_id    — конкретный запрос (нельзя переиспользовать подпись)
      - requester_did — конкретный получатель (нельзя подменить)
      - timestamp     — окно времени (нельзя replay через N часов)
    """
    return f"{BOND_APPROVAL_VERSION}:{request_id}:{requester_did}:{timestamp}".encode()


# ── DIDKey ────────────────────────────────────────────────────────────────────

@dataclass
class DIDKey:
    """
    W3C DID using did:key method with real Ed25519 (libsodium via cryptography).
    Private key = 32 raw bytes, exported as base64url for localStorage.
    """
    _private_key: Ed25519PrivateKey
    public_key_bytes: bytes   # 32 raw bytes
    did: str

    # ── Constructors ──────────────────────────────────────────────────────────

    @classmethod
    def generate(cls) -> "DIDKey":
        """Generate a fresh Ed25519 keypair and DID."""
        priv = Ed25519PrivateKey.generate()
        pub_bytes = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        return cls(_private_key=priv, public_key_bytes=pub_bytes, did=cls._make_did(pub_bytes))

    @classmethod
    def from_private_bytes(cls, raw32: bytes) -> "DIDKey":
        """Restore DID from 32 raw private key bytes."""
        priv = Ed25519PrivateKey.from_private_bytes(raw32)
        pub_bytes = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        return cls(_private_key=priv, public_key_bytes=pub_bytes, did=cls._make_did(pub_bytes))

    @classmethod
    def import_private(cls, b64url: str) -> "DIDKey":
        """Import from base64url string (as stored in localStorage)."""
        raw = base64.urlsafe_b64decode(b64url + "==")
        return cls.from_private_bytes(raw)

    # ── Export ────────────────────────────────────────────────────────────────

    def export_private(self) -> str:
        """Export private key as base64url (32 raw bytes). Store securely."""
        raw = self._private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
        return base64.urlsafe_b64encode(raw).decode()

    def to_dict(self) -> dict:
        """Serialize DID (public info only, never includes private key)."""
        return {
            "did": self.did,
            "public_key_b64": base64.urlsafe_b64encode(self.public_key_bytes).decode(),
        }

    # ── Signing ───────────────────────────────────────────────────────────────

    def sign(self, message: bytes) -> str:
        """
        Sign raw bytes with Ed25519. Returns base64url-encoded 64-byte signature.
        Ed25519 signs the message directly (SHA-512 is used internally by the algorithm).
        Do NOT pre-hash the message.
        """
        sig = self._private_key.sign(message)
        return base64.urlsafe_b64encode(sig).decode().rstrip("=")

    def sign_bond_approval(self, request_id: str, requester_did: str, timestamp: int) -> str:
        """
        Sign a bond approval. Returns base64url signature.
        Server verifies this before recording the approval in DB.
        """
        msg = bond_approval_message(request_id, requester_did, timestamp)
        return self.sign(msg)

    def sign_credential(self, credential: dict) -> dict:
        """Sign a W3C Verifiable Credential. Adds 'proof' field."""
        payload = json.dumps(credential, sort_keys=True).encode()
        return {
            **credential,
            "proof": {
                "type": "Ed25519Signature2020",
                "created": int(time.time()),
                "verificationMethod": f"{self.did}#key-1",
                "proofPurpose": "assertionMethod",
                "proofValue": self.sign(payload),
            }
        }

    # ── Verification (static) ─────────────────────────────────────────────────

    @staticmethod
    def verify(did: str, message: bytes, proof_b64url: str) -> bool:
        """
        Verify an Ed25519 signature against a did:key.
        Returns False (not raises) on any failure.
        """
        try:
            pub_key = _pubkey_from_did(did)
            sig = base64.urlsafe_b64decode(proof_b64url + "==")
            pub_key.verify(sig, message)
            return True
        except (InvalidSignature, Exception):
            return False

    @staticmethod
    def verify_bond_approval(
        approver_did: str,
        request_id: str,
        requester_did: str,
        timestamp: int,
        signature_b64url: str,
        max_age_seconds: int = 300,   # подпись действительна 5 минут
    ) -> tuple[bool, str]:
        """
        Полная верификация подписи одобрения бонда.

        Returns:
            (True, "ok") или (False, "причина отказа")
        """
        # Проверка возраста подписи
        now = int(time.time())
        age = now - timestamp
        if age < 0:
            return False, f"timestamp in the future (age={age}s)"
        if age > max_age_seconds:
            return False, f"signature too old ({age}s > {max_age_seconds}s)"

        # Криптографическая проверка
        msg = bond_approval_message(request_id, requester_did, timestamp)
        ok = DIDKey.verify(approver_did, msg, signature_b64url)
        if not ok:
            return False, "Ed25519 signature verification failed"

        return True, "ok"

    # ── Internal ──────────────────────────────────────────────────────────────

    @staticmethod
    def _make_did(public_key_bytes: bytes) -> str:
        """Encode 32-byte Ed25519 public key as did:key:z... string."""
        multicodec = bytes([0xed, 0x01]) + public_key_bytes   # ed25519-pub prefix
        return "did:key:z" + _b58encode(multicodec)


# ── W3C Verifiable Credential ─────────────────────────────────────────────────

def create_human_credential(
    subject_did: str,
    expression_proof: str,
    bond_count: int,
    issuer_did: str,
    ttl_seconds: int = 30 * 86400,
) -> dict:
    now = int(time.time())
    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://aptogon.network/credentials/v1",
        ],
        "type": ["VerifiableCredential", "HumanCredential"],
        "id": f"urn:uuid:{hashlib.sha256(f'{subject_did}{now}'.encode()).hexdigest()[:32]}",
        "issuer": issuer_did,
        "issuanceDate": now,
        "expirationDate": now + ttl_seconds,
        "credentialSubject": {
            "id": subject_did,
            "expressionProof": expression_proof,
            "bondCount": bond_count,
            "verifiedAt": now,
        }
    }


def did_hash(did: str) -> str:
    """Anonymous short identifier for logging. SHA3-256, first 12 chars."""
    return hashlib.sha3_256(did.encode()).hexdigest()[:12]
