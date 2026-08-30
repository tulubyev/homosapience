import pytest
from services.db_service import DatabaseService


@pytest.fixture
async def db():
    d = DatabaseService()
    # Pin in-memory backend so tests never write to the production database
    # (DATABASE_URL is set in the container). connect() is a no-op in mem mode.
    d._use_mem = True
    await d.connect()
    return d


async def test_ensure_person_creates_and_is_idempotent(db):
    p1 = await db.ensure_person_for_did("did:key:zA")
    assert p1.startswith("person_")
    # Same DID → same person, no new id
    p2 = await db.ensure_person_for_did("did:key:zA")
    assert p1 == p2
    assert await db.get_person_for_did("did:key:zA") == p1
    # Unknown DID → no person
    assert await db.get_person_for_did("did:key:zUnknown") is None


async def test_link_device_groups_under_same_person(db):
    person = await db.ensure_person_for_did("did:key:zPrimary", is_primary=True)
    await db.link_device(person, "did:key:zPhone", label="phone")
    await db.link_device(person, "did:key:zLaptop", label="laptop")

    devices = await db.list_devices(person)
    dids = {d["did"] for d in devices}
    assert dids == {"did:key:zPrimary", "did:key:zPhone", "did:key:zLaptop"}
    # Both linked devices resolve to the same person
    assert await db.get_person_for_did("did:key:zPhone") == person
    assert await db.get_person_for_did("did:key:zLaptop") == person


async def test_revoke_device_excluded_from_list(db):
    person = await db.ensure_person_for_did("did:key:zA")
    await db.link_device(person, "did:key:zB")
    assert len(await db.list_devices(person)) == 2

    assert await db.revoke_device("did:key:zB") is True
    live = await db.list_devices(person)
    assert {d["did"] for d in live} == {"did:key:zA"}
    # revoking again is a no-op
    assert await db.revoke_device("did:key:zB") is False
    # include_revoked surfaces it again
    assert len(await db.list_devices(person, include_revoked=True)) == 2


async def test_account_summary_aggregates_best_trust(db):
    person = await db.ensure_person_for_did("did:key:zLow")
    await db.link_device(person, "did:key:zHigh")
    # Credentials with different trust scores
    await db.save_credential(did="did:key:zLow", did_hash="h1", expression_proof="p",
                             trust_score=0.1, trust_label="newcomer")
    await db.save_credential(did="did:key:zHigh", did_hash="h2", expression_proof="p",
                             trust_score=0.9, trust_label="trusted")

    summary = await db.account_summary(person)
    assert summary["device_count"] == 2
    assert summary["max_trust_score"] == pytest.approx(0.9)
    assert summary["max_trust_label"] == "trusted"


async def test_revoked_device_not_in_summary(db):
    person = await db.ensure_person_for_did("did:key:zA")
    await db.link_device(person, "did:key:zB")
    await db.revoke_device("did:key:zB")
    summary = await db.account_summary(person)
    assert summary["device_count"] == 1
    assert {d["did"] for d in summary["devices"]} == {"did:key:zA"}
