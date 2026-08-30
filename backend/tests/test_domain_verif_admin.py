import time
import pytest

from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()
    await d.connect()
    return d


async def test_list_domain_verifications_admin_spans_owners(db):
    await db.create_domain_verification("did:key:zA", "https://a.com", "tokA")
    await db.create_domain_verification("did:key:zB", "https://b.com", "tokB")
    rows = await db.list_domain_verifications_admin(limit=100)
    assert len(rows) == 2
    assert {r["origin"] for r in rows} == {"https://a.com", "https://b.com"}


async def test_list_admin_includes_multiple_dids_same_origin(db):
    # same origin claimed by two different DIDs (the "garbage" scenario)
    await db.create_domain_verification("did:key:zA", "https://dup.com", "tA")
    await db.create_domain_verification("did:key:zB", "https://dup.com", "tB")
    rows = await db.list_domain_verifications_admin()
    dup = [r for r in rows if r["origin"] == "https://dup.com"]
    assert len(dup) == 2
    assert {r["owner_did"] for r in dup} == {"did:key:zA", "did:key:zB"}


async def test_delete_stale_keeps_verified_and_fresh(db):
    v = await db.create_domain_verification("did:key:zV", "https://verified.com", "tv")
    await db.mark_domain_verified(v["id"], "dns_txt")
    old = await db.create_domain_verification("did:key:zO", "https://old.com", "to")
    await db.create_domain_verification("did:key:zF", "https://fresh.com", "tf")

    cutoff = int(time.time()) - 100
    # age the verified row + the pending "old" row below the cutoff
    db._mem_domains[v["id"]]["created_at"] = cutoff - 50
    db._mem_domains[old["id"]]["created_at"] = cutoff - 50
    # fresh stays at "now" (> cutoff)

    deleted = await db.delete_stale_domain_verifications(cutoff)
    assert deleted == 1  # only the stale pending row

    origins = {r["origin"] for r in await db.list_domain_verifications_admin()}
    assert "https://verified.com" in origins  # verified kept regardless of age
    assert "https://fresh.com" in origins      # fresh pending kept
    assert "https://old.com" not in origins    # stale pending deleted


async def test_delete_stale_removes_failed(db):
    f = await db.create_domain_verification("did:key:zX", "https://failed.com", "tx")
    await db.mark_domain_failed(f["id"])
    db._mem_domains[f["id"]]["created_at"] = int(time.time()) - 1000
    deleted = await db.delete_stale_domain_verifications(int(time.time()) - 100)
    assert deleted == 1


async def test_delete_stale_nothing_when_all_fresh(db):
    await db.create_domain_verification("did:key:zN", "https://new.com", "tn")
    deleted = await db.delete_stale_domain_verifications(int(time.time()) - 100)
    assert deleted == 0
