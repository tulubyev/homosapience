"""
Unit tests for routers/_auth_helpers.py.

These tests pin the contract of extract_proven_did / require_proven_did
independently of any router so that future refactors of the helper itself
cannot silently re-open the X-APTOGON-DID bypass we closed in a608f7f.

Regression guards in here, in priority order:
  1. extract_proven_did MUST NOT accept request.state.did when auth_mode is
     "legacy_did" (firewall promotion of the unsigned header).
  2. extract_proven_did MUST NOT accept request.state.did when auth_mode is
     anything other than "jwt" (defensive default).
  3. extract_proven_did MUST accept a Bearer JWT directly when the firewall
     is not installed (test-client path).
  4. require_proven_did MUST raise 401 bearer_jwt_required on every reject
     path, NOT 403 — the latter masks the bug at the wrong gate.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers._auth_helpers import extract_proven_did, require_proven_did
from routers.auth import _issue_jwt
from services.db_service import DatabaseService


KNOWN_DID = "did:key:zKnownProven"


# ── Synchronous extract_proven_did unit tests ─────────────────────────────────
# These need only a Request-shaped object (headers + state). No DB.

def _req(headers=None, state=None):
    return SimpleNamespace(
        headers=headers or {},
        state=SimpleNamespace(**(state or {})),
    )


def test_extract_proven_did_accepts_state_when_auth_mode_jwt():
    r = _req(state={"did": "did:key:zABC", "auth_mode": "jwt"})
    assert extract_proven_did(r) == "did:key:zABC"


def test_extract_proven_did_rejects_state_when_auth_mode_legacy_did():
    """Critical guard: this is the exact bypass a608f7f fixed."""
    r = _req(state={"did": "did:key:zABC", "auth_mode": "legacy_did"})
    assert extract_proven_did(r) == ""


def test_extract_proven_did_rejects_state_without_auth_mode():
    """If something proxies state.did but forgets to set auth_mode, deny."""
    r = _req(state={"did": "did:key:zABC"})
    assert extract_proven_did(r) == ""


def test_extract_proven_did_rejects_state_with_unknown_auth_mode():
    """Future auth_mode tags must be opt-in, not opt-out."""
    r = _req(state={"did": "did:key:zABC", "auth_mode": "api_key"})
    assert extract_proven_did(r) == ""


def test_extract_proven_did_rejects_xaptogon_did_header_only():
    """The unsigned legacy header MUST NOT authenticate this helper."""
    r = _req(headers={"X-APTOGON-DID": "did:key:zABC"})
    assert extract_proven_did(r) == ""


def test_extract_proven_did_accepts_real_bearer_jwt_without_firewall():
    """Test-client path: no firewall middleware → direct Bearer parse works."""
    token = _issue_jwt("did:key:zABC", session_id="test")["token"]
    r = _req(headers={"Authorization": f"Bearer {token}"})
    assert extract_proven_did(r) == "did:key:zABC"


def test_extract_proven_did_rejects_malformed_bearer():
    r = _req(headers={"Authorization": "Bearer not.a.real.jwt.token"})
    assert extract_proven_did(r) == ""


def test_extract_proven_did_rejects_no_auth_at_all():
    assert extract_proven_did(_req()) == ""


# ── Async require_proven_did tests ────────────────────────────────────────────
# Need a real DB so the credential lookup runs.

@pytest.fixture
async def known_db():
    db = DatabaseService()
    # Pin in-memory backend so tests never touch the production database.
    db._use_mem = True
    await db.connect()   # no-op in mem mode
    await db.save_credential(
        did=KNOWN_DID, did_hash="h", expression_proof="p",
        bond_count=0, trust_score=0.1, trust_label="newcomer",
    )
    return db


def _req_with_db(db, headers=None, state=None):
    return SimpleNamespace(
        headers=headers or {},
        state=SimpleNamespace(**(state or {})),
        app=SimpleNamespace(state=SimpleNamespace(db=db)),
    )


async def test_require_proven_did_401_on_no_auth(known_db):
    with pytest.raises(HTTPException) as exc:
        await require_proven_did(_req_with_db(known_db))
    assert exc.value.status_code == 401
    assert exc.value.detail["error"] == "bearer_jwt_required"


async def test_require_proven_did_401_on_unsigned_header_only(known_db):
    """The original attack: X-APTOGON-DID alone must fail at the auth gate (401),
    NOT at the credential gate (403). Routes around the world cared about this."""
    r = _req_with_db(known_db, headers={"X-APTOGON-DID": KNOWN_DID})
    with pytest.raises(HTTPException) as exc:
        await require_proven_did(r)
    assert exc.value.status_code == 401, (
        f"expected 401 bearer_jwt_required at the auth gate, got {exc.value.status_code} — "
        "this means the legacy header is sneaking through somewhere"
    )
    assert exc.value.detail["error"] == "bearer_jwt_required"


async def test_require_proven_did_401_on_legacy_did_state(known_db):
    """Production-like path: firewall set state.did + auth_mode=legacy_did.
    Helper must still reject — this is the Variant-A bypass guard."""
    r = _req_with_db(known_db, state={"did": KNOWN_DID, "auth_mode": "legacy_did"})
    with pytest.raises(HTTPException) as exc:
        await require_proven_did(r)
    assert exc.value.status_code == 401
    assert exc.value.detail["error"] == "bearer_jwt_required"


async def test_require_proven_did_accepts_jwt_state_for_known_did(known_db):
    r = _req_with_db(known_db, state={"did": KNOWN_DID, "auth_mode": "jwt"})
    assert await require_proven_did(r) == KNOWN_DID


async def test_require_proven_did_403_when_jwt_did_has_no_credential(known_db):
    """Auth succeeded (Bearer proven) but the DID has no valid credential.
    The 403 verified_human_required SHOULD fire — that's the right gate."""
    r = _req_with_db(known_db, state={"did": "did:key:zUnregistered", "auth_mode": "jwt"})
    with pytest.raises(HTTPException) as exc:
        await require_proven_did(r)
    assert exc.value.status_code == 403
    assert exc.value.detail["error"] == "verified_human_required"


async def test_require_proven_did_403_when_credential_expired(known_db):
    """Expired credential is NOT a valid human, even with a proven JWT.
    Exercises the valid_until branch of the credential check."""
    import time
    await known_db.save_credential(
        did="did:key:zExpired", did_hash="hx", expression_proof="p",
        bond_count=0, trust_score=0.1, trust_label="newcomer",
        valid_until=int(time.time()) - 1,   # expired 1 second ago
    )
    r = _req_with_db(known_db, state={"did": "did:key:zExpired", "auth_mode": "jwt"})
    with pytest.raises(HTTPException) as exc:
        await require_proven_did(r)
    assert exc.value.status_code == 403
    assert exc.value.detail["error"] == "verified_human_required"
