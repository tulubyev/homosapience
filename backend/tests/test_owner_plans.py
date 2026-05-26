# backend/tests/test_owner_plans.py
import pytest
from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_default_plan_is_free(db):
    assert await db.get_owner_plan("did:key:zNobody") == "free"


async def test_set_and_get_plan(db):
    row = await db.set_owner_plan("did:key:zA", "pro", updated_by="zAdmin12")
    assert row["plan"] == "pro"
    assert await db.get_owner_plan("did:key:zA") == "pro"
    # update again
    await db.set_owner_plan("did:key:zA", "enterprise", updated_by="zAdmin12")
    assert await db.get_owner_plan("did:key:zA") == "enterprise"


async def test_pooled_owner_usage(db):
    # two keys for the same owner, one for another owner
    await db.create_api_key("pk_a1", "h1", "did:key:zA", "k1", ["https://a.com"])
    await db.create_api_key("pk_a2", "h2", "did:key:zA", "k2", ["https://a.com"])
    await db.create_api_key("pk_b1", "h3", "did:key:zB", "k3", ["https://b.com"])
    period = "2026-05"
    for _ in range(3):
        await db.increment_usage("pk_a1", period)
    for _ in range(2):
        await db.increment_usage("pk_a2", period)
    await db.increment_usage("pk_b1", period)
    assert await db.get_owner_usage("did:key:zA", period) == 5   # pooled across a1+a2
    assert await db.get_owner_usage("did:key:zB", period) == 1
    assert await db.get_owner_usage("did:key:zA", "2026-04") == 0  # other period


async def test_list_owner_plans(db):
    await db.set_owner_plan("did:key:zA", "pro", updated_by="zAdmin12")
    rows = await db.list_owner_plans()
    assert any(r["owner_did"] == "did:key:zA" and r["plan"] == "pro" for r in rows)


async def test_classify_owners(db):
    # zApi  → org via active API key
    await db.create_api_key("pk_x1", "h1", "did:key:zApi", "k1", ["https://x.com"])
    # zDom  → org via verified domain
    dv = await db.create_domain_verification("did:key:zDom", "https://d.com", "tok")
    await db.mark_domain_verified(dv["id"], "dns")
    # zPaid → org via API key AND paid plan
    await db.create_api_key("pk_p1", "h2", "did:key:zPaid", "k2", ["https://p.com"])
    await db.set_owner_plan("did:key:zPaid", "pro", updated_by="zAdmin12")
    # zNone → plain human, no resources

    flags = await db.classify_owners(
        ["did:key:zApi", "did:key:zDom", "did:key:zPaid", "did:key:zNone"]
    )
    assert flags["did:key:zApi"]  == {"is_org": True,  "is_paid": False}
    assert flags["did:key:zDom"]  == {"is_org": True,  "is_paid": False}
    assert flags["did:key:zPaid"] == {"is_org": True,  "is_paid": True}
    assert flags["did:key:zNone"] == {"is_org": False, "is_paid": False}


async def test_classify_owners_unverified_domain_not_org(db):
    # pending (not verified) domain alone does NOT make an org
    await db.create_domain_verification("did:key:zPend", "https://pend.com", "tok")
    flags = await db.classify_owners(["did:key:zPend"])
    assert flags["did:key:zPend"] == {"is_org": False, "is_paid": False}
