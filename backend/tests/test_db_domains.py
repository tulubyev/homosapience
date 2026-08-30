import pytest
from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_create_and_get(db):
    row = await db.create_domain_verification("did:key:zA", "https://a.com", "tok1")
    assert row["status"] == "pending" and row["origin"] == "https://a.com"
    got = await db.get_domain_verification(row["id"], "did:key:zA")
    assert got and got["token"] == "tok1"
    assert await db.get_domain_verification(row["id"], "did:key:zB") is None


async def test_create_is_idempotent_per_owner_origin(db):
    r1 = await db.create_domain_verification("did:key:zA", "https://a.com", "tok1")
    r2 = await db.create_domain_verification("did:key:zA", "https://a.com", "tok2")
    assert r1["id"] == r2["id"]
    assert r2["token"] == "tok2"
    assert r2["status"] == "pending"


async def test_mark_verified_and_is_origin_verified(db):
    row = await db.create_domain_verification("did:key:zA", "https://a.com", "tok1")
    assert await db.is_origin_verified("did:key:zA", "https://a.com") is False
    await db.mark_domain_verified(row["id"], "dns_txt")
    assert await db.is_origin_verified("did:key:zA", "https://a.com") is True
    assert await db.is_origin_verified("did:key:zB", "https://a.com") is False


async def test_mark_failed(db):
    row = await db.create_domain_verification("did:key:zA", "https://a.com", "tok1")
    await db.mark_domain_failed(row["id"])
    got = await db.get_domain_verification(row["id"], "did:key:zA")
    assert got["status"] == "failed"


async def test_list_for_owner(db):
    await db.create_domain_verification("did:key:zA", "https://a.com", "t")
    await db.create_domain_verification("did:key:zB", "https://b.com", "t")
    rows = await db.list_domain_verifications("did:key:zA")
    assert len(rows) == 1 and rows[0]["origin"] == "https://a.com"
