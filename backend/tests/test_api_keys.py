from services.api_keys import generate_key_pair, hash_secret, verify_secret


def test_generate_key_pair_prefixes():
    pk, sk = generate_key_pair()
    assert pk.startswith("pk_live_")
    assert sk.startswith("sk_live_")


def test_generated_keys_are_unique():
    pk1, sk1 = generate_key_pair()
    pk2, sk2 = generate_key_pair()
    assert pk1 != pk2
    assert sk1 != sk2


def test_hash_secret_is_deterministic_and_hex():
    h1 = hash_secret("sk_live_abc")
    h2 = hash_secret("sk_live_abc")
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex
    int(h1, 16)  # raises if not hex


def test_verify_secret_true_for_match():
    sk = "sk_live_xyz"
    assert verify_secret(sk, hash_secret(sk)) is True


def test_verify_secret_false_for_mismatch():
    assert verify_secret("sk_live_xyz", hash_secret("sk_live_other")) is False
