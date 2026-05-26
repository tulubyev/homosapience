import pytest

from services.rate_limiter import (
    RateLimiter,
    CHALLENGE_LIMIT_PER_HOUR,
    VERIFY_LIMIT_PER_HOUR,
)


@pytest.fixture
def rl():
    return RateLimiter(redis=None)  # in-memory fallback


async def test_challenge_allows_within_limit(rl):
    for _ in range(CHALLENGE_LIMIT_PER_HOUR):
        allowed, _reason = await rl.check_challenge_ip("1.2.3.4")
        assert allowed is True


async def test_challenge_blocks_over_limit(rl):
    for _ in range(CHALLENGE_LIMIT_PER_HOUR):
        await rl.check_challenge_ip("9.9.9.9")
    allowed, reason = await rl.check_challenge_ip("9.9.9.9")
    assert allowed is False
    assert "challenge" in reason.lower()


async def test_challenge_does_not_touch_verify_bucket(rl):
    # Exhaust the challenge budget for an IP …
    for _ in range(CHALLENGE_LIMIT_PER_HOUR + 5):
        await rl.check_challenge_ip("5.5.5.5")
    # … the verify bucket for the same IP must be untouched.
    for _ in range(VERIFY_LIMIT_PER_HOUR):
        allowed, _reason = await rl.check_verify_ip("5.5.5.5")
        assert allowed is True
