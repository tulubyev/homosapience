import os
import sys
import pathlib

import pytest

# Ensure backend/ is importable as the root (services., routers., etc.)
_BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))

# Enable the embed feature flag for the whole test session BEFORE app import.
os.environ["FEATURE_EMBED_API"] = "true"
# Deterministic server signing key for JWT tests (base64url of 32 raw bytes).
# Generated fresh per session to avoid leaking a real key.
import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PrivateFormat,
    NoEncryption,
)

_priv = Ed25519PrivateKey.generate()
_raw = _priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
os.environ["APTOGON_JWT_PRIVATE_KEY"] = base64.urlsafe_b64encode(_raw).decode()


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"
