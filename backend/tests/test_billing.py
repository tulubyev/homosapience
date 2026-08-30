# backend/tests/test_billing.py
import importlib
from services import billing


def test_labels_and_validity():
    assert billing.is_valid_plan("pro") is True
    assert billing.is_valid_plan("nope") is False
    assert billing.plan_label("pro") == "Pro"
    assert billing.plan_label("unknown") == "Free"   # falls back to default


def test_cap_code_defaults(monkeypatch):
    # No env overrides → code defaults
    for var in ("PLAN_FREE_CAP", "PLAN_PRO_CAP", "PLAN_ENTERPRISE_CAP", "FREE_VERIFY_CAP"):
        monkeypatch.delenv(var, raising=False)
    assert billing.plan_cap("free") == 1000
    assert billing.plan_cap("pro") == 50000
    assert billing.plan_cap("enterprise") is None   # unlimited
    assert billing.plan_cap("unknown") == 1000       # → free


def test_cap_env_override_wins(monkeypatch):
    monkeypatch.setenv("PLAN_PRO_CAP", "99999")
    assert billing.plan_cap("pro") == 99999


def test_free_honours_free_verify_cap_alias(monkeypatch):
    monkeypatch.delenv("PLAN_FREE_CAP", raising=False)
    monkeypatch.setenv("FREE_VERIFY_CAP", "250")
    assert billing.plan_cap("free") == 250


def test_unlimited_tokens(monkeypatch):
    monkeypatch.setenv("PLAN_PRO_CAP", "unlimited")
    assert billing.plan_cap("pro") is None
    monkeypatch.setenv("PLAN_PRO_CAP", "0")
    assert billing.plan_cap("pro") is None
