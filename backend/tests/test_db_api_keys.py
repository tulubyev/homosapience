import pytest

from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()      # no DATABASE_URL → in-memory mode
    await d.connect()
    return d


async def test_create_and_get_by_pk(db):
    await db.create_api_key("pk_live_1", "hash1", "did:key:zOwner", "My App", ["https://a.com"])
    row = await db.get_api_key_by_pk("pk_live_1")
    assert row is not None
    assert row["owner_did"] == "did:key:zOwner"
    assert row["allowed_origins"] == ["https://a.com"]
    assert row["active"] is True


async def test_get_by_secret_hash(db):
    await db.create_api_key("pk_live_2", "hash2", "did:key:zOwner", "App2", [])
    row = await db.get_api_key_by_secret_hash("hash2")
    assert row is not None and row["publishable_key"] == "pk_live_2"
    assert await db.get_api_key_by_secret_hash("nope") is None


async def test_list_api_keys_for_owner(db):
    await db.create_api_key("pk_live_3", "h3", "did:key:zA", "A", [])
    await db.create_api_key("pk_live_4", "h4", "did:key:zB", "B", [])
    rows = await db.list_api_keys("did:key:zA")
    assert len(rows) == 1 and rows[0]["publishable_key"] == "pk_live_3"


async def test_deactivate_only_own_key(db):
    await db.create_api_key("pk_live_5", "h5", "did:key:zA", "A", [])
    row = await db.get_api_key_by_pk("pk_live_5")
    # wrong owner cannot deactivate
    assert await db.deactivate_api_key(row["id"], "did:key:zB") is False
    assert await db.deactivate_api_key(row["id"], "did:key:zA") is True
    assert (await db.get_api_key_by_pk("pk_live_5"))["active"] is False


async def test_usage_increment_and_get(db):
    await db.increment_usage("pk_live_6", "2026-05")
    await db.increment_usage("pk_live_6", "2026-05")
    assert await db.get_usage("pk_live_6", "2026-05") == 2
    assert await db.get_usage("pk_live_6", "2026-06") == 0


async def test_count_active_api_keys(db):
    await db.create_api_key("pk_c1", "h", "did:key:zCount", "A", [])
    await db.create_api_key("pk_c2", "h", "did:key:zCount", "B", [])
    await db.create_api_key("pk_c3", "h", "did:key:zOther", "C", [])
    assert await db.count_active_api_keys("did:key:zCount") == 2
    row = await db.get_api_key_by_pk("pk_c1")
    await db.deactivate_api_key(row["id"], "did:key:zCount")
    assert await db.count_active_api_keys("did:key:zCount") == 1


async def test_reactivate_api_key(db):
    await db.create_api_key("pk_r1", "h", "did:key:zR", "A", [])
    row = await db.get_api_key_by_pk("pk_r1")
    await db.deactivate_api_key(row["id"], "did:key:zR")
    assert (await db.get_api_key_by_pk("pk_r1"))["active"] is False
    assert await db.reactivate_api_key(row["id"], "did:key:zWrong") is False
    assert await db.reactivate_api_key(row["id"], "did:key:zR") is True
    assert (await db.get_api_key_by_pk("pk_r1"))["active"] is True
