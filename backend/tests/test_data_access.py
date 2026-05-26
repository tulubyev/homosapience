import pytest
from services import data_access
from services.db_service import DatabaseService


def test_classify_level():
    assert data_access.classify_level({"gold_member": True}) == "full"
    assert data_access.classify_level({"trust_score": 0.7}) == "full"
    assert data_access.classify_level({"bond_count": 3}) == "full"
    assert data_access.classify_level({"trust_score": 0.5}) == "standard"
    assert data_access.classify_level({"bond_count": 1}) == "standard"
    assert data_access.classify_level({"trust_score": 0.1, "bond_count": 0}) == "basic"
    assert data_access.classify_level({}) == "basic"


def test_is_valid_level():
    assert data_access.is_valid_level("full") is True
    assert data_access.is_valid_level("platinum") is False


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_build_package_levels(db):
    basic = await data_access.build_package(db, "basic")
    assert basic["level"] == "basic" and basic["period_days"] == 30
    assert "totals" in basic and "by_day" not in basic and "signals" not in basic

    standard = await data_access.build_package(db, "standard")
    assert standard["period_days"] == 90 and "by_day" in standard and "signals" not in standard

    full = await data_access.build_package(db, "full")
    assert full["period_days"] == 180 and "by_day" in full and "signals" in full
