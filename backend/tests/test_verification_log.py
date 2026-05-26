import pytest
from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_log_verification_counts_in_gonka_stats(db):
    await db.log_verification(True)
    await db.log_verification(True)
    await db.log_verification(False)
    stats = await db.get_gonka_stats(days=30)
    assert stats["verif_passed"] == 2
    assert stats["verif_failed"] == 1
    # AI-call verifications counter present (0 in memory mode — no gonka log)
    assert stats["verifications"] == 0
