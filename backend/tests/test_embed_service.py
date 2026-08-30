import pytest

from services.embed_service import (
    trust_band,
    assert_message,
    store_nonce,
    consume_nonce,
    mark_redeemed,
)


def test_trust_band_thresholds():
    assert trust_band(0.0) == "newcomer"
    assert trust_band(0.1) == "newcomer"
    assert trust_band(0.49) == "newcomer"
    assert trust_band(0.5) == "community"
    assert trust_band(0.99) == "community"
    assert trust_band(1.0) == "trusted"


def test_assert_message_is_bound_to_all_fields():
    m1 = assert_message("n1", "https://a.com", "did:key:zX")
    m2 = assert_message("n2", "https://a.com", "did:key:zX")
    m3 = assert_message("n1", "https://b.com", "did:key:zX")
    assert m1 != m2 and m1 != m3
    assert m1.startswith(b"aptogon-embed-assert:v1:")


async def test_nonce_store_consume_single_use():
    # redis=None → in-memory fallback
    await store_nonce(None, "nonceA", "pk_live_1", "https://a.com", ttl=300)
    data = await consume_nonce(None, "nonceA")
    assert data == {"pk": "pk_live_1", "origin": "https://a.com"}
    # second consume returns None (single-use)
    assert await consume_nonce(None, "nonceA") is None


async def test_consume_missing_nonce_returns_none():
    assert await consume_nonce(None, "does-not-exist") is None


async def test_mark_redeemed_first_true_then_false():
    assert await mark_redeemed(None, "tok1", ttl=300) is True
    assert await mark_redeemed(None, "tok1", ttl=300) is False
