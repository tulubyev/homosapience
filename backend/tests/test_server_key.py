import base64
import os

import pytest

from services.server_key import ServerKey


def _fresh_key_b64() -> str:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
    raw = Ed25519PrivateKey.generate().private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    return base64.urlsafe_b64encode(raw).decode()


def test_sign_then_verify_roundtrip():
    sk = ServerKey(_fresh_key_b64())
    token = sk.sign_jwt({"sub": "abc", "aud": "https://site.com"})
    claims = sk.verify_jwt(token)
    assert claims is not None
    assert claims["sub"] == "abc"
    assert claims["aud"] == "https://site.com"


def test_expired_token_rejected():
    import time
    sk = ServerKey(_fresh_key_b64())
    token = sk.sign_jwt({"sub": "abc", "exp": int(time.time()) - 10})
    assert sk.verify_jwt(token) is None


def test_tampered_token_rejected():
    sk = ServerKey(_fresh_key_b64())
    token = sk.sign_jwt({"sub": "abc"})
    tampered = token[:-3] + ("aaa" if not token.endswith("aaa") else "bbb")
    assert sk.verify_jwt(tampered) is None


def test_jwks_shape():
    sk = ServerKey(_fresh_key_b64())
    jwks = sk.jwks()
    assert "keys" in jwks and len(jwks["keys"]) == 1
    k = jwks["keys"][0]
    assert k["kty"] == "OKP"
    assert k["crv"] == "Ed25519"
    assert k["alg"] == "EdDSA"
    assert k["use"] == "sig"
    assert k["kid"] == sk.kid
    assert isinstance(k["x"], str) and len(k["x"]) > 0


def test_missing_key_not_available():
    sk = ServerKey(None)
    assert sk.available is False


def test_kid_is_deterministic_from_pubkey():
    b64 = _fresh_key_b64()
    assert ServerKey(b64).kid == ServerKey(b64).kid
