"""
Phase B — sealed-box at-rest encryption for the Bond audit graph.

Threat model: prod holds ONLY the public key (can encrypt new edges), the private
key lives offline with the admin. A DB dump (ciphertext + pubkey) must NOT reveal
the plaintext DID.
"""
import base64

import pytest

from services import audit_crypto


def test_generate_keypair_roundtrip():
    pub_b64, priv_b64 = audit_crypto.generate_keypair()
    ct = audit_crypto.seal("did:key:zAlice", pub_b64)
    assert ct is not None
    assert audit_crypto.unseal(ct, priv_b64) == "did:key:zAlice"


def test_seal_uses_env_pubkey(monkeypatch):
    pub_b64, priv_b64 = audit_crypto.generate_keypair()
    monkeypatch.setenv("BOND_AUDIT_PUBKEY", pub_b64)
    ct = audit_crypto.seal("did:key:zBob")          # no explicit key → env
    assert ct is not None
    assert audit_crypto.unseal(ct, priv_b64) == "did:key:zBob"


def test_disabled_when_no_pubkey(monkeypatch):
    monkeypatch.delenv("BOND_AUDIT_PUBKEY", raising=False)
    assert audit_crypto.is_enabled() is False
    assert audit_crypto.seal("did:key:zX") is None   # nothing to encrypt to


def test_enabled_with_env(monkeypatch):
    pub_b64, _ = audit_crypto.generate_keypair()
    monkeypatch.setenv("BOND_AUDIT_PUBKEY", pub_b64)
    assert audit_crypto.is_enabled() is True


def test_dump_without_privkey_cannot_recover(monkeypatch):
    """Simulated DB breach: attacker has ciphertext + the prod public key, but
    not the offline private key → plaintext stays sealed."""
    pub_b64, priv_b64 = audit_crypto.generate_keypair()
    monkeypatch.setenv("BOND_AUDIT_PUBKEY", pub_b64)
    ct = audit_crypto.seal("did:key:zSecret")
    # ciphertext is opaque bytes; plaintext DID must not appear
    assert b"did:key" not in ct
    # a different (attacker) keypair cannot decrypt it
    _, attacker_priv = audit_crypto.generate_keypair()
    with pytest.raises(Exception):
        audit_crypto.unseal(ct, attacker_priv)
    # only the real private key works
    assert audit_crypto.unseal(ct, priv_b64) == "did:key:zSecret"


def test_seal_none_input_returns_none(monkeypatch):
    pub_b64, _ = audit_crypto.generate_keypair()
    monkeypatch.setenv("BOND_AUDIT_PUBKEY", pub_b64)
    assert audit_crypto.seal(None) is None
    assert audit_crypto.seal("") is None
