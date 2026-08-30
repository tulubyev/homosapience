"""Consented gesture-similarity lab study: the maths, and the gates.

The study is the only place a person key touches gesture data — production
`gesture_metrics` deliberately has none — so the gates matter as much as the
statistics: the flag, the study code, and admin-only access to the report.
"""
import pytest

from middleware.firewall import PUBLIC_PREFIXES
from services.similarity import similarity_report, zscore


# ── the maths ────────────────────────────────────────────────────────────────

def _subject(centre, n, jitter, rnd):
    """n gestures scattered around one person's characteristic centre."""
    return [[v * rnd.uniform(1 - jitter, 1 + jitter) for v in centre] for _ in range(n)]


def test_distinct_people_separate():
    """Three people with genuinely different styles must score well above 1."""
    import random
    rnd = random.Random(7)
    centres = {
        "alice": [0.9, 12, 0.030, 0.020, -0.45, 1.8, 380, 9000],
        "bob":   [0.3,  4, 0.008, 0.006, -0.10, 0.6, 120, 8500],
        "cara":  [1.7, 20, 0.055, 0.035, -0.70, 2.6, 700, 12000],
    }
    rows, labels = [], []
    for name, c in centres.items():
        block = _subject(c, 20, 0.07, rnd)
        rows += block
        labels += [name] * len(block)

    rep = similarity_report(rows, labels)
    assert rep["subjects"] == 3
    assert rep["gestures"] == 60
    assert rep["separation"] > 2.0
    assert rep["verdict"] == "strong"


def test_random_labels_show_no_signal():
    """The null case that matters most: one homogeneous population with labels
    assigned at random must NOT look like an identity signal."""
    import random
    rnd = random.Random(11)
    base = [0.9, 12, 0.030, 0.020, -0.45, 1.8, 380, 9000]
    rows = [[v * rnd.uniform(0.6, 1.4) for v in base] for _ in range(60)]
    labels = [rnd.choice(["x", "y", "z"]) for _ in rows]

    rep = similarity_report(rows, labels)
    assert rep["separation"] == pytest.approx(1.0, abs=0.15)
    assert rep["verdict"] in {"none", "weak"}


def test_single_subject_has_no_between_pairs():
    """One volunteer alone cannot answer the question — say so, don't invent it."""
    rows = [[1, 2, 3, 4, 5, 6, 7, 8], [1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1]]
    rep = similarity_report(rows, ["solo", "solo"])
    assert rep["within"] is not None
    assert rep["between"] is None
    assert rep["separation"] is None


def test_report_is_empty_but_shaped_when_no_data():
    rep = similarity_report([], [])
    assert rep["gestures"] == 0 and rep["separation"] is None


def test_zscore_survives_a_constant_feature():
    """A feature with zero spread must contribute 0, not divide by zero."""
    rows = [[1.0, 5.0], [2.0, 5.0], [3.0, 5.0]]
    out = zscore(rows)
    assert all(r[1] == 0.0 for r in out)          # constant column flattened
    assert out[0][0] != out[2][0]                 # varying column preserved


# ── the gates ────────────────────────────────────────────────────────────────

def test_submit_is_public_but_the_report_is_not():
    """Volunteers have no DID so the submit path bypasses the DID firewall, but
    the similarity report must stay behind admin auth."""
    def public(p):
        return any(p.startswith(x) for x in PUBLIC_PREFIXES)
    assert public("/api/research/study/gesture")
    assert not public("/api/research/study/similarity")


def test_missing_study_code_closes_the_study(monkeypatch):
    """Fail closed: no configured code must NOT mean 'anyone may write rows'."""
    from fastapi import HTTPException
    from routers import research_study

    monkeypatch.delenv("RESEARCH_STUDY_CODE", raising=False)
    with pytest.raises(HTTPException) as exc:
        research_study._check_code("whatever")
    assert exc.value.status_code == 403
    assert exc.value.detail["error"] == "study_closed"


def test_wrong_study_code_rejected(monkeypatch):
    from fastapi import HTTPException
    from routers import research_study

    monkeypatch.setenv("RESEARCH_STUDY_CODE", "correct-horse")
    with pytest.raises(HTTPException) as exc:
        research_study._check_code("battery-staple")
    assert exc.value.detail["error"] == "bad_study_code"
    research_study._check_code("correct-horse")   # the right one passes


@pytest.mark.parametrize("label,ok", [
    ("alice", True), ("A_1-b", True), ("ab", True), ("x" * 32, True),
    ("a", False), ("x" * 33, False), ("has space", False),
    ("emoji🙂", False), ("semi;colon", False), ("", False),
])
def test_subject_label_is_a_pseudonym_not_free_text(label, ok):
    from routers.research_study import _LABEL_RE
    assert bool(_LABEL_RE.match(label)) is ok


# ── device-fingerprint Sybil bind must expire with the credential ────────────
# The rule is one ACTIVE credential per device. The bind used to be permanent,
# so 30 days on the holder had a dead credential AND a device that could never
# issue another — a silent, total lockout for every non-admin user.

async def test_fp_bind_expires_with_the_credential():
    import time as _t
    from services.db_service import DatabaseService, CREDENTIAL_TTL_DAYS

    db = DatabaseService.__new__(DatabaseService)
    db._use_mem = True
    db._pool = None
    db._mem_fp_credentials = {}

    fp = "a" * 64
    assert await db.fp_has_credential(fp) is False        # unknown device

    await db.fp_mark_verified(fp, "deadbeef")
    assert await db.fp_has_credential(fp) is True         # fresh bind blocks

    # Age the bind past the credential lifetime.
    did_short, _ = db._mem_fp_credentials[fp]
    db._mem_fp_credentials[fp] = (
        did_short, int(_t.time()) - (CREDENTIAL_TTL_DAYS * 86400 + 60)
    )
    assert await db.fp_has_credential(fp) is False        # stale bind steps aside

    await db.fp_mark_verified(fp, "cafebabe")             # re-verify rebinds
    assert await db.fp_has_credential(fp) is True
    assert db._mem_fp_credentials[fp][0] == "cafebabe"
