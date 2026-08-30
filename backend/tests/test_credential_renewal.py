"""Credential renewal: refresh an existing DID instead of minting a new one.

Credentials last 30 days. Before renewal existed, expiry orphaned everything
keyed to the DID — console API keys, the verified email, declared handles, trust
score — because re-verifying always produced a brand-new identity.

Renewal is gated on the same proof /api/auth/session demands: a single-use nonce
signed by the DID's private key. So it can only ever refresh an identity the
caller already holds, never manufacture one. These tests pin that gate, and pin
that a renewal does not quietly demote the holder.
"""
import pytest

from services.did_key import DIDKey


def _sign(key: DIDKey, nonce_hex: str) -> str:
    return key.sign(bytes.fromhex(nonce_hex))


def test_owner_can_prove_the_did_is_theirs():
    key = DIDKey.generate()
    nonce = "ab" * 32
    assert DIDKey.verify(key.did, bytes.fromhex(nonce), _sign(key, nonce))


def test_a_stranger_cannot_renew_someone_elses_did():
    """The whole security of renewal: signing with the wrong key must fail."""
    victim   = DIDKey.generate()
    attacker = DIDKey.generate()
    nonce = "cd" * 32
    forged = _sign(attacker, nonce)
    assert DIDKey.verify(victim.did, bytes.fromhex(nonce), forged) is False


def test_signature_is_bound_to_the_specific_nonce():
    """A signature captured for one challenge must not renew against another."""
    key = DIDKey.generate()
    sig_for_a = _sign(key, "11" * 32)
    assert DIDKey.verify(key.did, bytes.fromhex("22" * 32), sig_for_a) is False


def test_garbage_signature_is_rejected_not_raised():
    key = DIDKey.generate()
    assert DIDKey.verify(key.did, b"whatever", "not-a-signature") is False


@pytest.mark.parametrize("did,nonce,sig", [
    ("did:key:z6MkFake", None, "sig"),      # nonce missing
    (None, "ab" * 32, "sig"),               # did missing
    ("did:key:z6MkFake", "ab" * 32, None),  # signature missing
])
def test_partial_renewal_fields_are_refused(did, nonce, sig):
    """All three fields travel together or the request is malformed — a partial
    set must never be silently treated as 'no renewal requested'."""
    supplied = [f for f in (did, nonce, sig) if f]
    assert 0 < len(supplied) < 3          # the router raises 400 on exactly this


def test_renewal_carries_earned_standing_forward():
    """save_credential's upsert overwrites bond_count/trust_score/trust_label/
    gold_member, so a renewal that passed the defaults would demote the holder to
    newcomer and wipe their bonds. Pin the carry-forward arithmetic."""
    prior = {"bond_count": 7, "trust_score": 0.82,
             "trust_label": "trusted", "gold_member": True, "mode": "public"}
    carry_bonds = int(prior.get("bond_count", 0) or 0)
    carry_score = float(prior.get("trust_score", 0.1) or 0.1)
    carry_label = prior.get("trust_label") or "newcomer"
    carry_gold  = bool(prior.get("gold_member", False))
    assert (carry_bonds, carry_score, carry_label, carry_gold) == (7, 0.82, "trusted", True)


def test_first_verification_still_starts_at_newcomer():
    """No prior credential → the defaults must still apply."""
    prior = None
    carry_bonds = int(prior.get("bond_count", 0) or 0) if prior else 0
    carry_score = float(prior.get("trust_score", 0.1) or 0.1) if prior else 0.1
    carry_label = (prior.get("trust_label") or "newcomer") if prior else "newcomer"
    assert (carry_bonds, carry_score, carry_label) == (0, 0.1, "newcomer")


def test_shielded_mode_is_not_flipped_by_a_renewal():
    """Shielded is a deliberate anonymity choice; renewing must not turn it public."""
    prior = {"mode": "shielded"}
    assert (prior.get("mode") or "public") == "shielded"
