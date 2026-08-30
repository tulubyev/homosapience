"""
DatabaseService — хранилище bond-запросов.

В production: asyncpg + PostgreSQL (DATABASE_URL env).
В dev:        in-memory dict (fallback, если DATABASE_URL не задан).
"""

from __future__ import annotations

import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

try:
    import asyncpg
    _HAS_ASYNCPG = True
except ImportError:
    _HAS_ASYNCPG = False

DATABASE_URL = os.getenv("DATABASE_URL", "")


def _gold_person_counts(rows: list, online_gold_dids: Optional[set] = None) -> tuple:
    """
    Collapse Gold-member rows into people. A person = their display_name compared
    case-insensitively with collapsed whitespace, so one human's several device
    DIDs count once. Returns (total_persons, online_persons); online = persons
    with at least one DID in `online_gold_dids` (the live bond-panel connections).
    """
    def nk(s: str) -> str:
        return " ".join((s or "").split()).lower()
    total = {nk(r.get("display_name", "")) for r in rows} - {""}
    online: set = set()
    if online_gold_dids:
        online = {nk(r.get("display_name", "")) for r in rows
                  if r.get("did_full") in online_gold_dids} - {""}
    return len(total), len(online)

# How long an issued credential stays valid. The device-fingerprint Sybil bind
# uses the same window: the rule is one ACTIVE credential per device, so a bind
# older than this is stale and must not block a fresh verification.
CREDENTIAL_TTL_DAYS = 30

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS human_credentials (
    did              TEXT    PRIMARY KEY,
    did_hash         TEXT    NOT NULL,
    expression_proof TEXT    NOT NULL,
    bond_count       INT     NOT NULL DEFAULT 0,
    trust_score      REAL    NOT NULL DEFAULT 0.1,
    trust_label      TEXT    NOT NULL DEFAULT 'newcomer',
    tx_hash          TEXT,
    issued_at        BIGINT  NOT NULL,
    valid_until      BIGINT  NOT NULL,
    revoked          BOOLEAN NOT NULL DEFAULT FALSE,
    gold_member      BOOLEAN NOT NULL DEFAULT FALSE,
    mode             TEXT    NOT NULL DEFAULT 'public'   -- public | shielded (Shielded Human)
);

CREATE INDEX IF NOT EXISTS idx_cred_valid ON human_credentials (valid_until, revoked);
-- Shielded Human: existing installs default to 'public' (no behaviour change).
ALTER TABLE human_credentials ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS bond_requests (
    id               TEXT    PRIMARY KEY,
    requester_did    TEXT    NOT NULL,
    expression_proof TEXT    NOT NULL,
    confidence       REAL    NOT NULL DEFAULT 0.0,
    message          TEXT,
    status           TEXT    NOT NULL DEFAULT 'pending',
    auto_approved    BOOLEAN NOT NULL DEFAULT FALSE,
    tx_hash          TEXT,
    retry_count      INT     NOT NULL DEFAULT 0,
    sent_to_count    INT     NOT NULL DEFAULT 0,
    created_at       BIGINT  NOT NULL,
    updated_at       BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS bond_approvals (
    id            SERIAL  PRIMARY KEY,
    request_id    TEXT    NOT NULL REFERENCES bond_requests(id) ON DELETE CASCADE,
    approver_did  TEXT    NOT NULL,
    approved_at   BIGINT  NOT NULL,
    -- Ed25519 подпись approver_did над canonical message (base64url, 64 bytes → ~86 chars)
    -- NULL только для записей созданных до введения подписей (migration window)
    signature     TEXT    DEFAULT NULL,
    sig_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (request_id, approver_did)
);

CREATE TABLE IF NOT EXISTS bond_rejections (
    id            SERIAL PRIMARY KEY,
    request_id    TEXT   NOT NULL REFERENCES bond_requests(id) ON DELETE CASCADE,
    rejecter_did  TEXT,
    rejected_at   BIGINT NOT NULL,
    UNIQUE (request_id, rejecter_did)
);

CREATE INDEX IF NOT EXISTS idx_bond_req_requester ON bond_requests (requester_did);
CREATE INDEX IF NOT EXISTS idx_bond_req_status    ON bond_requests (status);
CREATE INDEX IF NOT EXISTS idx_bond_approvals_req ON bond_approvals (request_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id           TEXT    PRIMARY KEY,
    sender_short TEXT    NOT NULL,
    content      TEXT    NOT NULL,
    room         TEXT    NOT NULL DEFAULT 'agora',
    timestamp    BIGINT  NOT NULL,
    trust_label  TEXT    NOT NULL DEFAULT 'newcomer',
    trust_score  REAL    NOT NULL DEFAULT 0.1,
    is_system    BOOLEAN NOT NULL DEFAULT FALSE,
    is_creator   BOOLEAN NOT NULL DEFAULT FALSE,
    display_name TEXT,
    avatar_url   TEXT,
    reply_to     JSONB,
    reactions    JSONB   NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_chat_room_ts ON chat_messages (room, timestamp);

CREATE TABLE IF NOT EXISTS admin_dids (
    id           SERIAL  PRIMARY KEY,
    did_short    TEXT    UNIQUE NOT NULL,   -- last 8 chars of DID
    did_full     TEXT,                      -- full did:key:z6Mk... (optional)
    display_name TEXT    NOT NULL DEFAULT 'Admin',
    avatar_url   TEXT,
    role         TEXT    NOT NULL DEFAULT 'admin',  -- 'admin' | 'gold_member'
    added_by     TEXT,
    added_at     BIGINT  NOT NULL,
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    fp_hash      TEXT                       -- SHA-256 device fingerprint (for auto-replace on re-verify)
);
-- Migration: add fp_hash column if upgrading from older schema (must run BEFORE index creation)
ALTER TABLE admin_dids ADD COLUMN IF NOT EXISTS fp_hash TEXT;
ALTER TABLE admin_dids ADD COLUMN IF NOT EXISTS browser TEXT;   -- R6 polish: device browser label
CREATE INDEX IF NOT EXISTS idx_admin_dids_role    ON admin_dids (role, active);
CREATE INDEX IF NOT EXISTS idx_admin_dids_fp_hash ON admin_dids (fp_hash) WHERE fp_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_pairings (
    link_code    TEXT    PRIMARY KEY,           -- 6-char one-time code
    did_primary  TEXT    NOT NULL,              -- device A (initiator)
    did_linked   TEXT,                          -- device B (filled on claim)
    created_at   BIGINT  NOT NULL,
    expires_at   BIGINT  NOT NULL,
    claimed_at   BIGINT                         -- NULL until claimed
);
CREATE INDEX IF NOT EXISTS idx_pairings_primary ON device_pairings (did_primary);

-- Device accounts (Вариант B): one "person" owns many device DIDs.
-- persons.did_primary UNIQUE ensures ensure_person_for_did is race-safe:
-- concurrent INSERTs for the same did_primary resolve atomically via ON CONFLICT.
CREATE TABLE IF NOT EXISTS persons (
    person_id   TEXT    PRIMARY KEY,
    did_primary TEXT    UNIQUE NOT NULL,       -- canonical DID of the first device
    created_at  BIGINT  NOT NULL
);

-- One row per device DID. person_id FK → persons. did is PK so ON CONFLICT is safe.
CREATE TABLE IF NOT EXISTS device_accounts (
    did         TEXT    PRIMARY KEY,            -- a device's did:key (one row per device)
    person_id   TEXT    NOT NULL REFERENCES persons(person_id),
    label       TEXT,                          -- optional user-set device label
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,-- first device of the person
    linked_at   BIGINT  NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE -- unlinked / compromised device
);
CREATE INDEX IF NOT EXISTS idx_device_accounts_person ON device_accounts (person_id, revoked);

CREATE TABLE IF NOT EXISTS chat_rooms (
    id           TEXT    PRIMARY KEY,
    name         TEXT    NOT NULL,
    icon         TEXT    NOT NULL DEFAULT '💬',
    description  TEXT    NOT NULL DEFAULT '',
    access_level TEXT    NOT NULL DEFAULT 'public',  -- public | verified | gold_only
    created_by   TEXT,                               -- did_short of creator
    created_at   BIGINT  NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_active ON chat_rooms (is_active, created_at);

CREATE TABLE IF NOT EXISTS gonka_usage_log (
    id           BIGSERIAL PRIMARY KEY,
    ts           BIGINT  NOT NULL,          -- unix timestamp
    task_type    TEXT    NOT NULL,          -- expression_analysis | health_check | …
    model        TEXT    NOT NULL,
    tokens_in    INT     NOT NULL DEFAULT 0,
    tokens_out   INT     NOT NULL DEFAULT 0,
    tokens_total INT     NOT NULL DEFAULT 0,
    latency_ms   REAL    NOT NULL DEFAULT 0,
    via_fallback BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_gonka_usage_ts ON gonka_usage_log (ts);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    did_short TEXT   NOT NULL,
    endpoint  TEXT   NOT NULL,
    p256dh    TEXT   NOT NULL,
    auth      TEXT   NOT NULL,
    ts        BIGINT NOT NULL,
    PRIMARY KEY (did_short, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_sub_did ON push_subscriptions (did_short);

-- R1: Organization API keys (pk public / sk hashed)
CREATE TABLE IF NOT EXISTS api_keys (
    id               BIGSERIAL PRIMARY KEY,
    publishable_key  TEXT UNIQUE NOT NULL,
    secret_hash      TEXT NOT NULL,
    owner_did        TEXT NOT NULL,
    name             TEXT NOT NULL,
    allowed_origins  JSONB NOT NULL DEFAULT '[]',
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       BIGINT NOT NULL,
    last_used_at     BIGINT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner  ON api_keys (owner_did, active);
CREATE INDEX IF NOT EXISTS idx_api_keys_secret ON api_keys (secret_hash);

-- R1: Minimal usage counting (no limits — that is subsystem E)
CREATE TABLE IF NOT EXISTS usage_counters (
    publishable_key  TEXT NOT NULL,
    period           TEXT NOT NULL,
    verifications    INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (publishable_key, period)
);

-- R2: Risk events (passive attack statistics)
CREATE TABLE IF NOT EXISTS risk_events (
    id             BIGSERIAL PRIMARY KEY,
    ts             BIGINT  NOT NULL,
    api_key        TEXT,                  -- org API key (NULL = homosapience.org)
    session_hash   TEXT,                  -- SHA-256 of session_id (NOT raw IP)
    risk_score     REAL    NOT NULL,
    classification TEXT    NOT NULL,      -- human|bot|ai_agent|suspicious
    signals        JSONB   NOT NULL DEFAULT '[]',
    outcome        TEXT    NOT NULL,      -- passed|blocked|stepped_up
    country_band   TEXT,                  -- ISO-3166-1 alpha-2 or NULL
    asn_type       TEXT    DEFAULT 'unknown'  -- datacenter|residential|vpn|tor|unknown
);
ALTER TABLE risk_events ADD COLUMN IF NOT EXISTS asn_type TEXT DEFAULT 'unknown';
ALTER TABLE ip_audit_log ADD COLUMN IF NOT EXISTS asn_type TEXT DEFAULT 'unknown';
-- Which AI provider served the gesture analysis (joingonka/together/openrouter/…).
ALTER TABLE ip_audit_log ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_risk_ts             ON risk_events (ts);
CREATE INDEX IF NOT EXISTS idx_risk_api_ts         ON risk_events (api_key, ts);
CREATE INDEX IF NOT EXISTS idx_risk_classification ON risk_events (classification, ts);

-- R2: Daily aggregation view (fast stats for /api/stats)
CREATE TABLE IF NOT EXISTS attack_stats_daily (
    date           DATE    NOT NULL,
    api_key        TEXT,
    sessions       INT     NOT NULL DEFAULT 0,
    humans         INT     NOT NULL DEFAULT 0,
    bots           INT     NOT NULL DEFAULT 0,
    ai_agents      INT     NOT NULL DEFAULT 0,
    suspicious     INT     NOT NULL DEFAULT 0,
    blocked        INT     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_daily_pk   ON attack_stats_daily (date, COALESCE(api_key, ''));
CREATE INDEX        IF NOT EXISTS idx_stats_daily_date ON attack_stats_daily (date DESC);

-- R1-D1: Domain-ownership verifications
CREATE TABLE IF NOT EXISTS domain_verifications (
    id          BIGSERIAL PRIMARY KEY,
    owner_did   TEXT   NOT NULL,
    origin      TEXT   NOT NULL,
    token       TEXT   NOT NULL,
    method      TEXT,
    status      TEXT   NOT NULL DEFAULT 'pending',
    created_at  BIGINT NOT NULL,
    verified_at BIGINT,
    UNIQUE (owner_did, origin)
);
CREATE INDEX IF NOT EXISTS idx_domain_verif_owner ON domain_verifications (owner_did, status);

-- R1-D4: Flagged-activity alerts & anomaly feed
CREATE TABLE IF NOT EXISTS alert_events (
    id          BIGSERIAL PRIMARY KEY,
    ts          BIGINT  NOT NULL,
    owner_did   TEXT    NOT NULL,
    api_key_pk  TEXT,
    severity    TEXT    NOT NULL,
    level       INT     NOT NULL,
    event_type  TEXT    NOT NULL,
    detail      JSONB   NOT NULL DEFAULT '{}',
    status      TEXT    NOT NULL DEFAULT 'active',
    resolved_at BIGINT,
    resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_owner ON alert_events (owner_did, status, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_ts    ON alert_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_key   ON alert_events (api_key_pk, ts DESC);

-- R1-E: owner billing plans
CREATE TABLE IF NOT EXISTS owner_plans (
    owner_did   TEXT   PRIMARY KEY,
    plan        TEXT   NOT NULL DEFAULT 'free',
    updated_at  BIGINT NOT NULL,
    updated_by  TEXT
);

-- Self-serve: a real, contactable person behind an owner DID. The DID proves
-- "not a bot" (gesture credential); a verified email proves "a real person we can
-- reach". Non-admin self-serve key creation requires email_verified. Magic-link
-- token is stored hashed; the raw token only ever travels in the email.
CREATE TABLE IF NOT EXISTS owner_accounts (
    did               TEXT    PRIMARY KEY,
    email             TEXT    NOT NULL,
    email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    verify_token_hash TEXT,
    token_expires     BIGINT,
    created_at        BIGINT  NOT NULL,
    verified_at       BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_accounts_email ON owner_accounts (lower(email));
-- Track D: a super-admin can suspend an owner account on abuse. Suspension blocks
-- all of the owner's keys immediately (captcha verify + siteverify) and locks them
-- out of the console.
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS suspended       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS suspended_at     BIGINT;
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS suspended_by     TEXT;
-- Super-admin private note about the account (never shown to the owner).
ALTER TABLE owner_accounts ADD COLUMN IF NOT EXISTS admin_note      TEXT;

-- R6.3: data-access requests
CREATE TABLE IF NOT EXISTS data_access_requests (
    id              BIGSERIAL PRIMARY KEY,
    did             TEXT   NOT NULL,
    did_short       TEXT   NOT NULL,
    name            TEXT   NOT NULL,
    company         TEXT   NOT NULL,
    email           TEXT   NOT NULL,
    phone           TEXT,
    suggested_level TEXT   NOT NULL,
    granted_level   TEXT,
    status          TEXT   NOT NULL DEFAULT 'pending',
    reason          TEXT,
    created_at      BIGINT NOT NULL,
    decided_at      BIGINT,
    decided_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_dar_did    ON data_access_requests (did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dar_status ON data_access_requests (status, created_at DESC);

-- IP audit log — raw IPs for security monitoring (dev/ops only, auto-purged after 30 days)
CREATE TABLE IF NOT EXISTS ip_audit_log (
    id             BIGSERIAL PRIMARY KEY,
    ts             BIGINT  NOT NULL,
    ip_addr        TEXT    NOT NULL,
    ip_hash        TEXT    NOT NULL,
    classification TEXT    NOT NULL,
    outcome        TEXT    NOT NULL,
    session_hash   TEXT,
    asn_type       TEXT    DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_ip_audit_ts   ON ip_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_ip_audit_hash ON ip_audit_log (ip_hash, ts DESC);

-- Verification outcome log — counts of successful / failed verifications (zero-PII)
CREATE TABLE IF NOT EXISTS verification_log (
    id      BIGSERIAL PRIMARY KEY,
    ts      BIGINT  NOT NULL,
    passed  BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verif_log_ts ON verification_log (ts);

-- Device fingerprint binding — one DID per device fingerprint (replay / sybil protection)
-- fp_hash is irreversible SHA-256 of browser fingerprint; no PII stored
CREATE TABLE IF NOT EXISTS device_fingerprints (
    fp_hash         TEXT PRIMARY KEY,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    has_credential  BOOLEAN NOT NULL DEFAULT FALSE,
    did_hash_short  TEXT,
    verified_at     TIMESTAMPTZ
);

-- Gesture pattern metrics — anonymized biometric signals for SapiX calibration.
-- Zero PII: no IP, no fp_hash, no session_id. Used for threshold research only.
CREATE TABLE IF NOT EXISTS gesture_metrics (
    id                   BIGSERIAL PRIMARY KEY,
    ts                   BIGINT    NOT NULL,
    passed               BOOLEAN   NOT NULL,
    via_fallback         BOOLEAN   NOT NULL DEFAULT FALSE,
    rhythm_irregularity  REAL,
    correction_count     INTEGER,
    velocity_std         REAL,
    velocity_mean        REAL,
    velocity_curvature_r REAL,
    pause_entropy        REAL,
    point_count          INTEGER,
    duration_ms          INTEGER,
    device_hint          TEXT      -- 'phone' | 'desktop' | 'unknown' (inferred from UA)
                                   -- NB: rows written before 2026-08-20 hold the raw
                                   -- UA truncated to 80 chars — see categorize_device_hint()
);
-- Local GBM shadow mode: the classifier's prediction alongside the LLM's `passed`
-- (decision unchanged in shadow — this is for measuring agreement before promotion).
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS ml_pred BOOLEAN;
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS ml_confidence REAL;
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS ml_model_version TEXT;
-- Phase E: complete the feature set for real-data retraining (velocity_curvature_r
-- already a column but was never populated; possible_motor_difficulty was missing).
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS possible_motor_difficulty BOOLEAN;
-- Gesture-CAPTCHA: attribute a training row to the embedding site (NULL = first-party
-- homosapience.org). Mirrors risk_events.api_key. Enables per-site stats + lets GBM
-- retraining filter/weight per-site data (and spot a single site poisoning the pool).
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS origin  TEXT;
-- Pen lifts, derived server-side from the gaps in the event timestamps (see
-- PatternExtractor.LIFT_PAUSE_THRESHOLD_MS). Observation only — NOT a classifier
-- input: the production GBM was trained on synthetic gestures that never lift,
-- so these are collected first and judged later. Both are plain scalars, so the
-- "Zero PII" property above is unchanged.
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS lift_count    INTEGER;
ALTER TABLE gesture_metrics ADD COLUMN IF NOT EXISTS total_lift_ms INTEGER;
-- One-off scrub: rows written before device_hint was categorised hold the raw
-- User-Agent (80 chars) — a weak fingerprint in a table that declares Zero PII.
-- Collapse them to the documented form factor. Mobile markers are checked first
-- because an Android UA also contains "Linux". Self-limiting: once a row holds a
-- category it no longer matches the WHERE, so this is a no-op on every later boot.
UPDATE gesture_metrics SET device_hint = CASE
    WHEN device_hint ILIKE '%android%'  OR device_hint ILIKE '%iphone%'
      OR device_hint ILIKE '%ipad%'     OR device_hint ILIKE '%ipod%'
      OR device_hint ILIKE '%mobile%'   OR device_hint ILIKE '%windows phone%'
      OR device_hint ILIKE '%opera mini%' OR device_hint ILIKE '%iemobile%'
      OR device_hint ILIKE '%blackberry%' OR device_hint ILIKE '%silk/%'   THEN 'phone'
    WHEN device_hint ILIKE '%windows%'  OR device_hint ILIKE '%macintosh%'
      OR device_hint ILIKE '%mac os%'   OR device_hint ILIKE '%x11%'
      OR device_hint ILIKE '%linux%'    OR device_hint ILIKE '%cros%'      THEN 'desktop'
    ELSE 'unknown'
END
WHERE device_hint IS NOT NULL
  AND device_hint NOT IN ('phone', 'desktop', 'unknown');
CREATE INDEX IF NOT EXISTS idx_gm_ts     ON gesture_metrics (ts DESC);
CREATE INDEX IF NOT EXISTS idx_gm_passed ON gesture_metrics (passed, ts DESC);
CREATE INDEX IF NOT EXISTS idx_gm_apikey ON gesture_metrics (api_key, ts DESC);

-- research_gestures — CONSENTED lab study only, deliberately separate from
-- gesture_metrics. Volunteers pick a pseudonym and knowingly let their own
-- gestures be grouped under it, which is the one thing gesture_metrics must
-- never do (it declares Zero PII, and docs/strategy/anti-deanonymization.md
-- commits to resisting a linked mode by default — Shielded Human relies on it).
-- Keeping the two tables apart is what lets us answer "does one person draw
-- consistently?" without putting a person key anywhere near production traffic.
CREATE TABLE IF NOT EXISTS research_gestures (
    id                   BIGSERIAL PRIMARY KEY,
    ts                   BIGINT  NOT NULL,
    subject_label        TEXT    NOT NULL,   -- volunteer's self-chosen pseudonym
    seq                  INTEGER,            -- position within their run
    rhythm_irregularity  REAL,
    correction_count     INTEGER,
    velocity_std         REAL,
    velocity_mean        REAL,
    velocity_curvature_r REAL,
    pause_entropy        REAL,
    point_count          INTEGER,
    duration_ms          INTEGER,
    lift_count           INTEGER,
    total_lift_ms        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rg_subject ON research_gestures (subject_label, ts DESC);

-- platform_handles — self-declared username ↔ DID mappings for public badge
CREATE TABLE IF NOT EXISTS platform_handles (
    id          BIGSERIAL PRIMARY KEY,
    platform    TEXT    NOT NULL,
    username_lc TEXT    NOT NULL,
    did         TEXT    NOT NULL REFERENCES human_credentials(did) ON DELETE CASCADE,
    created_at  BIGINT  NOT NULL,
    is_public   BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(platform, username_lc)
);
CREATE INDEX IF NOT EXISTS idx_ph_did ON platform_handles (did);
-- Shielded Human: existing installs grandfather all current handles as public
-- (don't break working badges), then flip the column default to FALSE so NEW
-- handles are private-by-default. App layer always passes is_public explicitly.
ALTER TABLE platform_handles ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE platform_handles ALTER COLUMN is_public SET DEFAULT FALSE;

-- HDAA: Human-Delegated Agent Authentication delegation tokens
CREATE TABLE IF NOT EXISTS agent_delegations (
    id           TEXT    PRIMARY KEY,
    human_did    TEXT    NOT NULL REFERENCES human_credentials(did) ON DELETE CASCADE,
    agent_id     TEXT    NOT NULL,
    agent_name   TEXT,
    permissions  TEXT[]  NOT NULL DEFAULT '{read}',
    token_hash   TEXT    NOT NULL UNIQUE,
    issued_at    BIGINT  NOT NULL,
    expires_at   BIGINT  NOT NULL,
    last_used_at BIGINT,
    use_count    INT     NOT NULL DEFAULT 0,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at   BIGINT
);
CREATE INDEX IF NOT EXISTS idx_agent_del_human ON agent_delegations(human_did, revoked);
CREATE INDEX IF NOT EXISTS idx_agent_del_token ON agent_delegations(token_hash);
"""


class DatabaseService:
    """
    Thin async data layer.  All callers use the same interface regardless of
    whether they're backed by PostgreSQL or the in-memory fallback.
    """

    def __init__(self) -> None:
        self._pool: "asyncpg.Pool | None" = None
        self._mem: dict[str, dict] = {}
        self._mem_approvals: dict[str, list[str]] = {}  # request_id → [dids]
        self._mem_credentials: dict[str, dict] = {}    # did → credential record
        self._mem_admin_dids: dict[str, dict] = {}     # did_short → admin record
        self._mem_pairings:  dict[str, dict] = {}     # link_code → pairing record
        self._mem_rooms:     dict[str, dict] = {}     # room_id → room record
        self._mem_risk_events: list[dict] = []        # R2: in-memory risk event log
        self._mem_api_keys: dict[str, dict] = {}        # R1: publishable_key → row
        self._mem_usage: dict[tuple[str, str], int] = {} # R1: (pk, period) → count
        self._mem_owner_accounts: dict[str, dict] = {}   # self-serve: did → owner account row
        self._api_key_seq: int = 0                       # R1: in-memory id sequence
        self._mem_domains: dict[int, dict] = {}          # R1-D1: id → verification row
        self._domain_seq: int = 0                         # R1-D1: in-memory id sequence
        self._mem_alerts: list[dict] = []         # R1-D4: in-memory alert log
        self._alert_seq: int = 0                   # R1-D4: in-memory id sequence
        self._mem_owner_plans: dict[str, dict] = {}   # R1-E: owner_did → plan row
        self._mem_data_requests: list[dict] = []       # R6.3: data-access requests
        self._dar_seq: int = 0                          # R6.3: in-memory id sequence
        self._mem_verifications: list[dict] = []        # verification outcome log {ts, passed}
        self._mem_device_accounts: dict[str, dict] = {} # B: did → {person_id, label, is_primary, linked_at, revoked}
        self._mem_persons: dict[str, str] = {}           # B: did_primary → person_id (race-safe via setdefault)
        # fp_hash → (did_hash_short, bound_at_unix). The timestamp mirrors the
        # DB's verified_at so the in-memory path expires binds the same way.
        self._mem_fp_credentials: dict[str, tuple[str, int]] = {}
        self._mem_handles: list[dict] = []   # [{platform, username_lc, did, created_at}]
        self._mem_delegations: list[dict] = []  # HDAA: [{id, human_did, agent_id, ...}]
        self._use_mem = not (DATABASE_URL and _HAS_ASYNCPG)

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def connect(self) -> None:
        if self._use_mem:
            reason = "asyncpg not installed" if not _HAS_ASYNCPG else "no DATABASE_URL"
            print(f"⚠️  DatabaseService: {reason} — using in-memory store (dev mode)")
            return
        self._pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        await self._migrate()
        await self._bootstrap_admin_dids()
        print(f"✅ DatabaseService: connected to PostgreSQL ({DATABASE_URL[:30]}…)")

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    async def _migrate(self) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(_SCHEMA_SQL)

    async def _bootstrap_admin_dids(self) -> None:
        """
        Seed admin_dids table from env vars on first start.
        ADMIN_DIDS=did_short1,did_short2,...  (last-8-char identifiers)
        GOLD_MEMBER_DIDS=did:key:z6Mk...,... (full DIDs, comma-separated)
        """
        now = int(time.time())
        admin_raw    = os.getenv("ADMIN_DIDS", "")
        gold_raw     = os.getenv("GOLD_MEMBER_DIDS", "")
        admin_shorts = [s.strip() for s in admin_raw.split(",") if s.strip()]
        gold_dids    = [d.strip() for d in gold_raw.split(",") if d.strip()]

        async with self._pool.acquire() as conn:
            for short in admin_shorts:
                await conn.execute(
                    """INSERT INTO admin_dids (did_short, role, display_name, added_at, active)
                       VALUES ($1, 'admin', 'Admin', $2, TRUE)
                       ON CONFLICT (did_short) DO NOTHING""",
                    short, now,
                )
            for full_did in gold_dids:
                short = full_did[-8:]
                await conn.execute(
                    """INSERT INTO admin_dids (did_short, did_full, role, display_name, added_at, active)
                       VALUES ($1, $2, 'gold_member', 'Gold Member', $3, TRUE)
                       ON CONFLICT (did_short) DO NOTHING""",
                    short, full_did, now,
                )

    # ── Admin DIDs ────────────────────────────────────────────────────────────

    async def get_admin_dids(
        self, role: Optional[str] = None, active_only: bool = True
    ) -> list[dict]:
        """List admin/gold-member DIDs from DB."""
        if self._use_mem:
            rows = list(self._mem_admin_dids.values())
            if role:
                rows = [r for r in rows if r.get("role") == role]
            if active_only:
                rows = [r for r in rows if r.get("active")]
            return rows
        async with self._pool.acquire() as conn:
            if active_only and role:
                rows = await conn.fetch(
                    "SELECT * FROM admin_dids WHERE active = TRUE AND role = $1 ORDER BY added_at DESC",
                    role,
                )
            elif active_only:
                rows = await conn.fetch(
                    "SELECT * FROM admin_dids WHERE active = TRUE ORDER BY added_at DESC"
                )
            elif role:
                rows = await conn.fetch(
                    "SELECT * FROM admin_dids WHERE role = $1 ORDER BY added_at DESC",
                    role,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM admin_dids ORDER BY added_at DESC"
                )
            return [dict(r) for r in rows]

    async def is_admin_did(self, did_short: str) -> bool:
        """Check if did_short is an active admin (any role)."""
        if self._use_mem:
            rec = self._mem_admin_dids.get(did_short)
            return bool(rec and rec.get("active"))
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id FROM admin_dids WHERE did_short=$1 AND active=TRUE", did_short
            )
            return row is not None

    async def is_super_admin_did(self, did_short: str) -> bool:
        """Only role='super_admin' — the platform moderators who can view and suspend
        other owners' accounts. A plain 'admin' is NOT a super-admin."""
        if self._use_mem:
            rec = self._mem_admin_dids.get(did_short)
            return bool(rec and rec.get("active") and rec.get("role") == "super_admin")
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id FROM admin_dids WHERE did_short=$1 AND active=TRUE AND role='super_admin'",
                did_short,
            )
            return row is not None

    async def upsert_admin_did(
        self,
        did_short: str,
        did_full: Optional[str] = None,
        display_name: str = "Admin",
        avatar_url: Optional[str] = None,
        role: str = "admin",
        added_by: Optional[str] = None,
        fp_hash: Optional[str] = None,
        browser: Optional[str] = None,
    ) -> bool:
        """Insert or update an admin/gold-member DID. Returns True on success."""
        now = int(time.time())
        if self._use_mem:
            existing = self._mem_admin_dids.get(did_short, {})
            self._mem_admin_dids[did_short] = {
                "did_short": did_short, "did_full": did_full,
                "display_name": display_name, "avatar_url": avatar_url,
                "role": role, "added_by": added_by,
                "added_at": now, "active": True, "fp_hash": fp_hash,
                "browser": browser or existing.get("browser"),
            }
            return True
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO admin_dids
                       (did_short, did_full, display_name, avatar_url, role, added_by, added_at, active, fp_hash, browser)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9)
                   ON CONFLICT (did_short) DO UPDATE SET
                       did_full=EXCLUDED.did_full,
                       display_name=EXCLUDED.display_name,
                       avatar_url=EXCLUDED.avatar_url,
                       role=EXCLUDED.role,
                       added_by=EXCLUDED.added_by,
                       active=TRUE,
                       fp_hash=COALESCE(EXCLUDED.fp_hash, admin_dids.fp_hash),
                       browser=COALESCE(EXCLUDED.browser, admin_dids.browser)""",
                did_short, did_full, display_name, avatar_url, role, added_by, now, fp_hash, browser,
            )
            return True

    async def replace_admin_did_by_fp_hash(
        self,
        fp_hash: str,
        new_did_short: str,
        new_did_full: Optional[str] = None,
    ) -> Optional[str]:
        """
        If this device's fp_hash matches an existing active admin DID:
          - deactivate all old rows with that fp_hash (except the new one)
          - insert/update the new DID, copying display_name/avatar/role from old
        Returns old did_short if replaced, None otherwise.
        """
        if not fp_hash:
            return None

        if self._use_mem:
            old = next(
                (r for r in self._mem_admin_dids.values()
                 if r.get("fp_hash") == fp_hash and r.get("active") and r["did_short"] != new_did_short),
                None,
            )
            if not old:
                return None
            old["active"] = False
            self._mem_admin_dids[new_did_short] = {
                "did_short":   new_did_short,
                "did_full":    new_did_full,
                "display_name": old["display_name"],
                "avatar_url":   old.get("avatar_url"),
                "role":         old["role"],
                "added_by":     old.get("added_by"),
                "added_at":     int(time.time()),
                "active":       True,
                "fp_hash":      fp_hash,
            }
            return old["did_short"]

        async with self._pool.acquire() as conn:
            old = await conn.fetchrow(
                """SELECT * FROM admin_dids
                   WHERE fp_hash = $1 AND active = TRUE AND did_short != $2
                   LIMIT 1""",
                fp_hash, new_did_short,
            )
            if not old:
                return None
            old = dict(old)
            # Deactivate all old entries with this fp_hash
            await conn.execute(
                "UPDATE admin_dids SET active = FALSE WHERE fp_hash = $1 AND did_short != $2",
                fp_hash, new_did_short,
            )
            # Insert/update new DID with same profile
            now = int(time.time())
            await conn.execute(
                """INSERT INTO admin_dids
                       (did_short, did_full, display_name, avatar_url, role, added_by, added_at, active, fp_hash)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)
                   ON CONFLICT (did_short) DO UPDATE SET
                       did_full=EXCLUDED.did_full,
                       display_name=EXCLUDED.display_name,
                       avatar_url=EXCLUDED.avatar_url,
                       role=EXCLUDED.role,
                       active=TRUE,
                       fp_hash=EXCLUDED.fp_hash""",
                new_did_short, new_did_full,
                old["display_name"], old.get("avatar_url"), old["role"],
                old.get("added_by"), now, fp_hash,
            )
            return old["did_short"]

    async def deactivate_admin_did(self, did_short: str) -> bool:
        """Soft-delete: set active=FALSE."""
        if self._use_mem:
            rec = self._mem_admin_dids.get(did_short)
            if rec:
                rec["active"] = False
                return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE admin_dids SET active=FALSE WHERE did_short=$1", did_short
            )
            return result != "UPDATE 0"

    async def rename_person(self, old_name: str, new_name: str) -> int:
        """
        Rename a person — update display_name on ALL admin_dids rows whose name
        matches `old_name` (case-insensitive, whitespace-collapsed). Also merges:
        renaming "Tulubyev" → "Alexander Tulubyev Russia" folds it into that
        person. `new_name` should already be Title-Cased by the caller. Returns
        the number of DIDs updated.
        """
        def nk(s: str) -> str:
            return " ".join((s or "").split()).lower()
        key = nk(old_name)
        if not key or not new_name:
            return 0
        if self._use_mem:
            n = 0
            for rec in self._mem_admin_dids.values():
                if nk(rec.get("display_name", "")) == key:
                    rec["display_name"] = new_name
                    n += 1
            return n
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE admin_dids SET display_name=$1 "
                "WHERE lower(regexp_replace(trim(display_name), '\\s+', ' ', 'g')) = $2",
                new_name, key,
            )
            try:
                return int(result.split()[-1])
            except (ValueError, IndexError):
                return 0

    # ── Device Pairings ───────────────────────────────────────────────────────

    async def create_pairing(
        self, link_code: str, did_primary: str, expires_at: int
    ) -> None:
        now = int(time.time())
        record = {
            "link_code":   link_code,
            "did_primary": did_primary,
            "did_linked":  None,
            "created_at":  now,
            "expires_at":  expires_at,
            "claimed_at":  None,
        }
        if self._use_mem:
            self._mem_pairings[link_code] = record
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO device_pairings
                       (link_code, did_primary, created_at, expires_at)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (link_code) DO NOTHING""",
                link_code, did_primary, now, expires_at,
            )

    async def claim_pairing(
        self, link_code: str, new_did: str
    ) -> Optional[dict]:
        """
        Mark pairing as claimed. Returns pairing record on success, None if
        not found / expired / already claimed.
        """
        now = int(time.time())
        if self._use_mem:
            rec = self._mem_pairings.get(link_code)
            if not rec:
                return None
            if rec.get("claimed_at") or rec.get("expires_at", 0) < now:
                return None
            rec["did_linked"] = new_did
            rec["claimed_at"] = now
            return rec
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE device_pairings
                   SET did_linked = $2, claimed_at = $3
                   WHERE link_code = $1
                     AND claimed_at IS NULL
                     AND expires_at > $3
                   RETURNING *""",
                link_code, new_did, now,
            )
            return dict(row) if row else None

    async def get_pairing(self, link_code: str) -> Optional[dict]:
        if self._use_mem:
            return self._mem_pairings.get(link_code)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM device_pairings WHERE link_code = $1", link_code
            )
            return dict(row) if row else None

    # ── Device accounts (Вариант B: person ↔ many device DIDs) ──────────────────

    async def get_person_for_did(self, did: str) -> Optional[str]:
        """Return person_id owning this device DID, or None if not registered."""
        if self._use_mem:
            rec = self._mem_device_accounts.get(did)
            return rec["person_id"] if rec else None
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT person_id FROM device_accounts WHERE did = $1", did
            )

    async def link_device(
        self, person_id: str, did: str, label: Optional[str] = None,
        is_primary: bool = False,
    ) -> dict:
        """Attach a device DID to a person. Idempotent on did (PK).
        On re-link of a revoked device: clears revoked + updates linked_at.
        person_id is intentionally NOT overwritten on conflict — the device
        stays in its original person (prevents cross-person hijack on re-link).
        """
        now = int(time.time())
        if self._use_mem:
            existing = self._mem_device_accounts.get(did)
            if existing:
                existing["revoked"] = False
                existing["linked_at"] = now
                if label:
                    existing["label"] = label
                return existing
            rec = {
                "did": did, "person_id": person_id, "label": label,
                "is_primary": is_primary, "linked_at": now, "revoked": False,
            }
            self._mem_device_accounts[did] = rec
            return rec
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO device_accounts (did, person_id, label, is_primary, linked_at)
                   VALUES ($1,$2,$3,$4,$5)
                   ON CONFLICT (did) DO UPDATE SET
                       revoked = FALSE,
                       linked_at = EXCLUDED.linked_at,
                       label = COALESCE(EXCLUDED.label, device_accounts.label)
                   RETURNING *""",
                did, person_id, label, is_primary, now,
            )
            return dict(row)

    async def ensure_person_for_did(self, did: str, is_primary: bool = True) -> str:
        """Return existing person_id for did, or create a new person and link it.
        Race-safe: uses persons.did_primary UNIQUE + ON CONFLICT to guarantee
        exactly one person_id per did_primary even under concurrent requests.
        """
        new_person_id = "person_" + secrets.token_urlsafe(16)
        now = int(time.time())
        if self._use_mem:
            # setdefault is atomic for CPython GIL — first writer wins.
            person_id = self._mem_persons.setdefault(did, new_person_id)
            await self.link_device(person_id, did, is_primary=is_primary)
            return person_id
        async with self._pool.acquire() as conn:
            stmt = await conn.prepare(
                """INSERT INTO persons (person_id, did_primary, created_at)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (did_primary) DO UPDATE SET created_at = persons.created_at
                   RETURNING person_id"""
            )
            row = await stmt.fetchrow(new_person_id, did, now)
            person_id = row["person_id"]
        await self.link_device(person_id, did, is_primary=is_primary)
        return person_id

    async def count_active_devices(self, person_id: str) -> int:
        """Count non-revoked devices for a person (for device limit enforcement)."""
        if self._use_mem:
            return sum(
                1 for r in self._mem_device_accounts.values()
                if r["person_id"] == person_id and not r["revoked"]
            )
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT COUNT(*) FROM device_accounts WHERE person_id = $1 AND revoked = FALSE",
                person_id,
            )

    async def list_devices(self, person_id: str, include_revoked: bool = False) -> list[dict]:
        """All device rows for a person, newest first."""
        if self._use_mem:
            rows = [r for r in self._mem_device_accounts.values()
                    if r["person_id"] == person_id and (include_revoked or not r["revoked"])]
            return sorted(rows, key=lambda r: r["linked_at"], reverse=True)
        async with self._pool.acquire() as conn:
            if include_revoked:
                rows = await conn.fetch(
                    "SELECT * FROM device_accounts WHERE person_id = $1 ORDER BY linked_at DESC",
                    person_id,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM device_accounts WHERE person_id = $1 AND revoked = FALSE ORDER BY linked_at DESC",
                    person_id,
                )
            return [dict(r) for r in rows]

    async def revoke_device(self, did: str) -> bool:
        """Mark a device DID as revoked (unlinked). Returns True if a row changed."""
        if self._use_mem:
            rec = self._mem_device_accounts.get(did)
            if not rec or rec["revoked"]:
                return False
            rec["revoked"] = True
            return True
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE device_accounts SET revoked = TRUE WHERE did = $1 AND revoked = FALSE",
                did,
            )
            return result.endswith("1")

    async def account_summary(self, person_id: str) -> dict:
        """
        Aggregate (read-only) view of a person's live devices + best trust.
        Does NOT mutate per-DID credentials — only surfaces the aggregate.
        """
        devices = await self.list_devices(person_id)
        best_score = 0.0
        best_label = "newcomer"
        out_devices = []
        for d in devices:
            cred = await self.get_credential(d["did"])
            score = float(cred["trust_score"]) if cred else 0.0
            if score >= best_score:
                best_score = score
                if cred:
                    best_label = cred.get("trust_label", best_label)
            out_devices.append({
                "did": d["did"],
                "did_short": d["did"][-8:],
                "label": d.get("label"),
                "is_primary": d.get("is_primary", False),
                "linked_at": d["linked_at"],
                "trust_score": score,
            })
        return {
            "person_id": person_id,
            "device_count": len(out_devices),
            "max_trust_score": best_score,
            "max_trust_label": best_label,
            "devices": out_devices,
        }

    # ── Credentials ───────────────────────────────────────────────────────────

    async def save_credential(
        self,
        did: str,
        did_hash: str,
        expression_proof: str,
        bond_count: int = 0,
        trust_score: float = 0.1,
        trust_label: str = "newcomer",
        tx_hash: Optional[str] = None,
        valid_until: Optional[int] = None,
        gold_member: bool = False,
        mode: str = "public",
    ) -> dict:
        now = int(time.time())
        vuntil = valid_until or (now + CREDENTIAL_TTL_DAYS * 86400)
        record = {
            "did": did,
            "did_hash": did_hash,
            "expression_proof": expression_proof,
            "bond_count": bond_count,
            "trust_score": trust_score,
            "trust_label": trust_label,
            "tx_hash": tx_hash,
            "issued_at": now,
            "valid_until": vuntil,
            "revoked": False,
            "gold_member": gold_member,
            "mode": mode,
        }
        if self._use_mem:
            self._mem_credentials[did] = record
            return record
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO human_credentials
                    (did, did_hash, expression_proof, bond_count, trust_score,
                     trust_label, tx_hash, issued_at, valid_until, revoked, gold_member, mode)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10,$11)
                ON CONFLICT (did) DO UPDATE SET
                    bond_count=EXCLUDED.bond_count,
                    trust_score=EXCLUDED.trust_score,
                    trust_label=EXCLUDED.trust_label,
                    tx_hash=EXCLUDED.tx_hash,
                    valid_until=EXCLUDED.valid_until,
                    gold_member=EXCLUDED.gold_member,
                    mode=EXCLUDED.mode
                """,
                did, did_hash, expression_proof, bond_count, trust_score,
                trust_label, tx_hash, now, vuntil, gold_member, mode,
            )
        return record

    async def get_credential(self, did: str) -> Optional[dict]:
        if self._use_mem:
            return self._mem_credentials.get(did)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM human_credentials WHERE did=$1", did
            )
            return dict(row) if row else None

    async def get_credential_by_short(self, did_short: str) -> Optional[dict]:
        """Lookup credential by the last-8 chars of the DID (did_short)."""
        if self._use_mem:
            for cred in self._mem_credentials.values():
                if cred.get("did", "")[-8:] == did_short:
                    return cred
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT trust_score, trust_label FROM human_credentials WHERE RIGHT(did, 8)=$1 LIMIT 1",
                did_short,
            )
            return dict(row) if row else None

    async def list_credentials(
        self,
        only_valid: bool = True,
        gold_only: bool = False,
        limit: int = 100,
    ) -> list[dict]:
        now = int(time.time())
        if self._use_mem:
            creds = list(self._mem_credentials.values())
            if only_valid:
                creds = [c for c in creds if c["valid_until"] > now and not c["revoked"]]
            if gold_only:
                creds = [c for c in creds if c.get("gold_member")]
            return creds[:limit]
        async with self._pool.acquire() as conn:
            if only_valid and gold_only:
                rows = await conn.fetch(
                    "SELECT * FROM human_credentials WHERE valid_until > $1 AND revoked = FALSE AND gold_member = TRUE ORDER BY issued_at DESC LIMIT $2",
                    now, limit,
                )
            elif only_valid:
                rows = await conn.fetch(
                    "SELECT * FROM human_credentials WHERE valid_until > $1 AND revoked = FALSE ORDER BY issued_at DESC LIMIT $2",
                    now, limit,
                )
            elif gold_only:
                rows = await conn.fetch(
                    "SELECT * FROM human_credentials WHERE gold_member = TRUE ORDER BY issued_at DESC LIMIT $1",
                    limit,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM human_credentials ORDER BY issued_at DESC LIMIT $1",
                    limit,
            )
            return [dict(r) for r in rows]

    async def set_gold_member(self, did: str, gold: bool = True) -> bool:
        """Повысить/понизить статус Gold Member."""
        if self._use_mem:
            if did in self._mem_credentials:
                self._mem_credentials[did]["gold_member"] = gold
                return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE human_credentials SET gold_member=$2 WHERE did=$1", did, gold
            )
            return result != "UPDATE 0"

    async def count_approvals_by_did_since(self, approver_did: str, since_ts: int) -> int:
        """Сколько раз этот DID одобрял с момента since_ts (rate limit)."""
        if self._use_mem:
            count = 0
            for req_id, dids in self._mem_approvals.items():
                if approver_did in dids:
                    req = self._mem.get(req_id, {})
                    if req.get("updated_at", 0) >= since_ts:
                        count += 1
            return count
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                """SELECT COUNT(*) FROM bond_approvals
                   WHERE approver_did=$1 AND approved_at >= $2""",
                approver_did, since_ts,
            ) or 0

    # ── Bond Requests ──────────────────────────────────────────────────────────

    async def create_bond_request(
        self,
        requester_did: str,
        expression_proof: str,
        confidence: float,
        message: Optional[str] = None,
    ) -> dict:
        now = int(time.time())
        rid = str(uuid.uuid4())
        record: dict = {
            "id": rid,
            "requester_did": requester_did,
            "expression_proof": expression_proof,
            "confidence": confidence,
            "message": message,
            "status": "pending",
            "auto_approved": False,
            "tx_hash": None,
            "retry_count": 0,
            "sent_to_count": 0,
            "approvals": [],
            "rejections": [],
            "created_at": now,
            "updated_at": now,
        }
        if self._use_mem:
            self._mem[rid] = record
            self._mem_approvals[rid] = []
            self._mem.setdefault("_rejections", {})[rid] = []
            return record

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO bond_requests
                    (id, requester_did, expression_proof, confidence, message,
                     status, auto_approved, retry_count, sent_to_count, created_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,'pending',FALSE,0,0,$6,$6)
                """,
                rid, requester_did, expression_proof, confidence, message, now,
            )
        return record

    async def get_bond_request(self, request_id: str) -> Optional[dict]:
        if self._use_mem:
            rec = self._mem.get(request_id)
            if rec is None:
                return None
            return {**rec, "approvals": list(self._mem_approvals.get(request_id, []))}

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM bond_requests WHERE id = $1", request_id
            )
            if not row:
                return None
            approval_rows = await conn.fetch(
                "SELECT approver_did FROM bond_approvals WHERE request_id = $1",
                request_id,
            )
            result = dict(row)
            result["approvals"] = [r["approver_did"] for r in approval_rows]
            return result

    async def add_approval(
        self,
        request_id: str,
        approver_did: str,
        signature: Optional[str] = None,
        sig_verified: bool = False,
    ) -> list[str]:
        """
        Add an approval (idempotent). Returns updated approvals list.
        signature — base64url Ed25519 подпись approver_did (None для legacy записей).
        sig_verified — True если подпись прошла верификацию на сервере.
        """
        if self._use_mem:
            bucket = self._mem_approvals.setdefault(request_id, [])
            if approver_did not in bucket:
                bucket.append(approver_did)
            if request_id in self._mem:
                self._mem[request_id]["updated_at"] = int(time.time())
            return list(bucket)

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO bond_approvals
                    (request_id, approver_did, approved_at, signature, sig_verified)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (request_id, approver_did) DO NOTHING
                """,
                request_id, approver_did, int(time.time()), signature, sig_verified,
            )
            rows = await conn.fetch(
                "SELECT approver_did FROM bond_approvals WHERE request_id = $1",
                request_id,
            )
            return [r["approver_did"] for r in rows]

    async def update_bond_status(
        self,
        request_id: str,
        status: str,
        tx_hash: Optional[str] = None,
        auto_approved: bool = False,
    ) -> None:
        now = int(time.time())
        if self._use_mem:
            rec = self._mem.get(request_id)
            if rec:
                rec["status"] = status
                rec["tx_hash"] = tx_hash
                rec["auto_approved"] = auto_approved
                rec["updated_at"] = now
            return

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE bond_requests
                SET status=$2, tx_hash=$3, auto_approved=$4, updated_at=$5
                WHERE id=$1
                """,
                request_id, status, tx_hash, auto_approved, now,
            )

    async def record_rejection(
        self, request_id: str, rejecter_did: Optional[str] = None
    ) -> bool:
        """
        Записать отказ от поручительства.
        Возвращает True если все разосланные кандидаты отказали → нужен retry.
        """
        now = int(time.time())
        if self._use_mem:
            rejs = self._mem.get("_rejections", {}).setdefault(request_id, [])
            if rejecter_did and rejecter_did not in rejs:
                rejs.append(rejecter_did)
            req = self._mem.get(request_id)
            if req:
                req["updated_at"] = now
                approvals = self._mem_approvals.get(request_id, [])
                sent = req.get("sent_to_count", 0)
                # Все отказали и нет ни одного одобрения
                return len(rejs) >= sent and len(approvals) == 0
            return False

        async with self._pool.acquire() as conn:
            if rejecter_did:
                await conn.execute(
                    """
                    INSERT INTO bond_rejections (request_id, rejecter_did, rejected_at)
                    VALUES ($1,$2,$3) ON CONFLICT (request_id, rejecter_did) DO NOTHING
                    """,
                    request_id, rejecter_did, now,
                )
            rej_count = await conn.fetchval(
                "SELECT COUNT(*) FROM bond_rejections WHERE request_id=$1", request_id
            )
            appr_count = await conn.fetchval(
                "SELECT COUNT(*) FROM bond_approvals WHERE request_id=$1", request_id
            )
            sent = await conn.fetchval(
                "SELECT sent_to_count FROM bond_requests WHERE id=$1", request_id
            ) or 0
            return int(rej_count) >= sent and int(appr_count) == 0

    async def increment_retry(self, request_id: str, new_sent_to: int) -> int:
        """Увеличить счётчик retry и обновить sent_to_count. Возвращает новый retry_count."""
        now = int(time.time())
        if self._use_mem:
            req = self._mem.get(request_id)
            if req:
                req["retry_count"] = req.get("retry_count", 0) + 1
                req["sent_to_count"] = new_sent_to
                req["updated_at"] = now
                return req["retry_count"]
            return 0

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE bond_requests
                SET retry_count = retry_count + 1,
                    sent_to_count = $2,
                    updated_at = $3
                WHERE id = $1
                RETURNING retry_count
                """,
                request_id, new_sent_to, now,
            )
            return row["retry_count"] if row else 0

    async def get_pending_for_guarantor(self, approver_did: str, limit: int = 10) -> list[dict]:
        """
        Pending bond requests that this guarantor hasn't yet approved or rejected.
        Used by browser extension to show approval panel.
        """
        if self._use_mem:
            result = []
            rejected_set = set()
            for rid, rej_list in self._mem.get("_rejections", {}).items():
                if approver_did in rej_list:
                    rejected_set.add(rid)

            for req in list(self._mem.values()):
                if not isinstance(req, dict) or "requester_did" not in req:
                    continue
                if req.get("status") != "pending":
                    continue
                if req["requester_did"] == approver_did:
                    continue
                rid = req["id"]
                if rid in rejected_set:
                    continue
                approvals = self._mem_approvals.get(rid, [])
                if approver_did in approvals:
                    continue
                result.append({**req, "approvals_count": len(approvals)})
                if len(result) >= limit:
                    break
            return result

        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT br.*,
                       (SELECT COUNT(*) FROM bond_approvals ba WHERE ba.request_id = br.id) AS approvals_count
                FROM bond_requests br
                WHERE br.status = 'pending'
                  AND br.requester_did != $1
                  AND br.id NOT IN (
                      SELECT request_id FROM bond_approvals  WHERE approver_did  = $1
                  )
                  AND br.id NOT IN (
                      SELECT request_id FROM bond_rejections WHERE rejecter_did  = $1
                  )
                ORDER BY br.created_at DESC
                LIMIT $2
                """,
                approver_did, limit,
            )
            return [dict(r) for r in rows]

    async def get_bonds_for_did(self, did: str) -> dict:
        if self._use_mem:
            all_reqs = list(self._mem.values())
            outgoing = [
                {**r, "approvals": self._mem_approvals.get(r["id"], [])}
                for r in all_reqs if r["requester_did"] == did
            ]
            incoming = [
                {**r, "approvals": self._mem_approvals.get(r["id"], [])}
                for r in all_reqs if did in self._mem_approvals.get(r["id"], [])
            ]
            return {"outgoing": outgoing, "incoming": incoming}

        async with self._pool.acquire() as conn:
            out_rows = await conn.fetch(
                "SELECT * FROM bond_requests WHERE requester_did=$1 ORDER BY created_at DESC LIMIT 50",
                did,
            )
            in_rows = await conn.fetch(
                """
                SELECT br.* FROM bond_requests br
                JOIN bond_approvals ba ON ba.request_id = br.id
                WHERE ba.approver_did = $1
                ORDER BY br.created_at DESC LIMIT 50
                """,
                did,
            )
            return {
                "outgoing": [dict(r) for r in out_rows],
                "incoming": [dict(r) for r in in_rows],
            }

    # ── Custom Chat Rooms ──────────────────────────────────────────────────────

    async def create_room(
        self,
        id: str,
        name: str,
        icon: str,
        description: str,
        access_level: str,
        created_by: str,
    ) -> dict:
        now = int(time.time())
        record = {
            "id": id, "name": name, "icon": icon,
            "description": description, "access_level": access_level,
            "created_by": created_by, "created_at": now, "is_active": True,
        }
        if self._use_mem:
            self._mem_rooms[id] = record
            return record
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO chat_rooms
                     (id, name, icon, description, access_level, created_by, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)
                   ON CONFLICT (id) DO NOTHING""",
                id, name, icon, description, access_level, created_by, now,
            )
            row = await conn.fetchrow("SELECT * FROM chat_rooms WHERE id = $1", id)
            return dict(row)

    async def list_custom_rooms(self, active_only: bool = True) -> list[dict]:
        if self._use_mem:
            return [r for r in self._mem_rooms.values()
                    if not active_only or r.get("is_active", True)]
        async with self._pool.acquire() as conn:
            q = "SELECT * FROM chat_rooms"
            if active_only:
                q += " WHERE is_active = TRUE"
            q += " ORDER BY created_at ASC"
            rows = await conn.fetch(q)
            return [dict(r) for r in rows]

    async def delete_room(self, room_id: str) -> bool:
        if self._use_mem:
            if room_id in self._mem_rooms:
                self._mem_rooms[room_id]["is_active"] = False
                return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE chat_rooms SET is_active = FALSE WHERE id = $1", room_id
            )
            return result != "UPDATE 0"

    # ── Gonka Usage Log ───────────────────────────────────────────────────────

    async def log_gonka_usage(
        self,
        task_type: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
        tokens_total: int,
        latency_ms: float,
        via_fallback: bool = False,
    ) -> None:
        if self._use_mem:
            return  # dev mode — skip
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO gonka_usage_log
                   (ts, task_type, model, tokens_in, tokens_out, tokens_total, latency_ms, via_fallback)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                int(time.time()), task_type, model,
                tokens_in, tokens_out, tokens_total,
                latency_ms, via_fallback,
            )

    async def get_gonka_stats(self, days: int = 30) -> dict:
        """Aggregate usage stats for the last N days."""
        if self._use_mem:
            since = int(time.time()) - days * 86400
            vl = [v for v in self._mem_verifications if v["ts"] >= since]
            return {"total_requests": 0, "total_tokens": 0, "verifications": 0,
                    "verif_passed": sum(1 for v in vl if v["passed"]),
                    "verif_failed": sum(1 for v in vl if not v["passed"]),
                    "by_day": [], "by_task": []}
        since = int(time.time()) - days * 86400
        async with self._pool.acquire() as conn:
            summary = await conn.fetchrow(
                """SELECT
                     COUNT(*)                            AS total_requests,
                     COALESCE(SUM(tokens_total), 0)      AS total_tokens,
                     COALESCE(SUM(tokens_in), 0)         AS tokens_in,
                     COALESCE(SUM(tokens_out), 0)        AS tokens_out,
                     COALESCE(AVG(latency_ms), 0)        AS avg_latency_ms,
                     COUNT(*) FILTER (WHERE via_fallback) AS fallback_count,
                     COUNT(*) FILTER (WHERE task_type = 'expression_analysis') AS verifications
                   FROM gonka_usage_log WHERE ts >= $1""",
                since,
            )
            by_day = await conn.fetch(
                """SELECT
                     to_char(to_timestamp(ts), 'YYYY-MM-DD') AS day,
                     COUNT(*)                                  AS requests,
                     COALESCE(SUM(tokens_total), 0)            AS tokens
                   FROM gonka_usage_log WHERE ts >= $1
                   GROUP BY day ORDER BY day DESC LIMIT 30""",
                since,
            )
            by_task = await conn.fetch(
                """SELECT task_type,
                     COUNT(*)                         AS requests,
                     COALESCE(SUM(tokens_total), 0)   AS tokens
                   FROM gonka_usage_log WHERE ts >= $1
                   GROUP BY task_type ORDER BY requests DESC""",
                since,
            )
            vf = await conn.fetchrow(
                """SELECT COUNT(*) FILTER (WHERE passed)     AS passed,
                          COUNT(*) FILTER (WHERE NOT passed) AS failed
                   FROM verification_log WHERE ts >= $1""",
                since,
            )
        return {
            "total_requests":  summary["total_requests"],
            "total_tokens":    summary["total_tokens"],
            "tokens_in":       summary["tokens_in"],
            "tokens_out":      summary["tokens_out"],
            "avg_latency_ms":  round(summary["avg_latency_ms"], 0),
            "fallback_count":  summary["fallback_count"],
            "est_cost_usd":    round(summary["total_tokens"] * 0.000002, 6),
            "verifications":   summary["verifications"],
            "verif_passed":    vf["passed"],
            "verif_failed":    vf["failed"],
            "by_day":          [dict(r) for r in by_day],
            "by_task":         [dict(r) for r in by_task],
        }

    async def log_verification(self, passed: bool) -> None:
        """Record one verification outcome (for the admin Gonka counter). Never raises hard."""
        now = int(time.time())
        if self._use_mem:
            self._mem_verifications.append({"ts": now, "passed": bool(passed)})
            if len(self._mem_verifications) > 50000:
                self._mem_verifications = self._mem_verifications[-50000:]
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO verification_log (ts, passed) VALUES ($1,$2)", now, bool(passed))

    # ── Gesture biometric research ─────────────────────────────────────────────

    async def log_gesture_metrics(
        self,
        passed: bool,
        via_fallback: bool,
        rhythm_irregularity: Optional[float],
        correction_count: Optional[int],
        velocity_std: Optional[float],
        velocity_mean: Optional[float],
        velocity_curvature_r: Optional[float],
        pause_entropy: Optional[float],
        point_count: Optional[int],
        duration_ms: Optional[int],
        device_hint: Optional[str] = None,
        ml_pred: Optional[bool] = None,
        ml_confidence: Optional[float] = None,
        ml_model_version: Optional[str] = None,
        possible_motor_difficulty: Optional[bool] = None,
        api_key: Optional[str] = None,
        origin: Optional[str] = None,
        lift_count: Optional[int] = None,
        total_lift_ms: Optional[int] = None,
    ) -> None:
        """Append one anonymized gesture-pattern row. Never raises hard.
        ml_* fields carry the local GBM's shadow prediction (None when the model
        is off/unavailable). api_key/origin attribute the row to an embedding site
        (both None = first-party homosapience.org traffic). lift_count/total_lift_ms
        record pen lifts for research only — they are not classifier inputs."""
        if self._use_mem:
            return
        if not self._pool:
            return
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO gesture_metrics (
                        ts, passed, via_fallback,
                        rhythm_irregularity, correction_count,
                        velocity_std, velocity_mean, velocity_curvature_r,
                        pause_entropy, point_count, duration_ms, device_hint,
                        ml_pred, ml_confidence, ml_model_version, possible_motor_difficulty,
                        api_key, origin, lift_count, total_lift_ms
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                    """,
                    int(time.time()), bool(passed), bool(via_fallback),
                    rhythm_irregularity, correction_count,
                    velocity_std, velocity_mean, velocity_curvature_r,
                    pause_entropy, point_count, duration_ms, device_hint,
                    ml_pred, ml_confidence, ml_model_version, possible_motor_difficulty,
                    api_key, origin, lift_count, total_lift_ms,
                )
        except Exception:
            pass

    async def log_research_gesture(
        self,
        subject_label: str,
        seq: Optional[int],
        rhythm_irregularity: Optional[float],
        correction_count: Optional[int],
        velocity_std: Optional[float],
        velocity_mean: Optional[float],
        velocity_curvature_r: Optional[float],
        pause_entropy: Optional[float],
        point_count: Optional[int],
        duration_ms: Optional[int],
        lift_count: Optional[int] = None,
        total_lift_ms: Optional[int] = None,
    ) -> None:
        """Store one gesture from a consented volunteer. Never raises hard.

        Separate from log_gesture_metrics on purpose: this row carries a person
        key, which production traffic must never do."""
        if self._use_mem or not self._pool:
            return
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO research_gestures (
                        ts, subject_label, seq,
                        rhythm_irregularity, correction_count,
                        velocity_std, velocity_mean, velocity_curvature_r,
                        pause_entropy, point_count, duration_ms,
                        lift_count, total_lift_ms
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    """,
                    int(time.time()), subject_label, seq,
                    rhythm_irregularity, correction_count,
                    velocity_std, velocity_mean, velocity_curvature_r,
                    pause_entropy, point_count, duration_ms,
                    lift_count, total_lift_ms,
                )
        except Exception:
            pass

    async def get_research_similarity(self) -> dict:
        """Within- vs between-subject gesture similarity over the study data."""
        from services.similarity import FEATURES, similarity_report
        empty = {"gestures": 0, "subjects": 0, "per_subject": {},
                 "within": None, "between": None, "separation": None, "verdict": None}
        if self._use_mem or not self._pool:
            return empty
        try:
            async with self._pool.acquire() as conn:
                # Columns spelled out rather than interpolated from FEATURES —
                # no dynamic SQL, nothing for a scanner to flag.
                rows = await conn.fetch(
                    """
                    SELECT subject_label,
                           rhythm_irregularity, correction_count,
                           velocity_std, velocity_mean, velocity_curvature_r,
                           pause_entropy, point_count, duration_ms
                    FROM research_gestures ORDER BY ts
                    """
                )
        except Exception:
            return empty
        vecs, labels = [], []
        for r in rows:
            # A row with a NULL feature would skew the standardisation; drop it.
            vals = [r[f] for f in FEATURES]
            if any(v is None for v in vals):
                continue
            vecs.append([float(v) for v in vals])
            labels.append(r["subject_label"])
        if not vecs:
            return empty
        return similarity_report(vecs, labels)

    async def get_ml_shadow_stats(self, days: int = 14) -> dict:
        """Agreement between the local GBM shadow prediction and the LLM `passed`
        decision over the last N days. Admin-only (see routers/admin.py)."""
        empty = {"days": days, "total": 0, "agree": 0, "agreement_rate": 0.0,
                 "ml_human_llm_bot": 0, "ml_bot_llm_human": 0, "model_versions": []}
        if self._use_mem or not self._pool:
            return empty
        since = int(time.time()) - days * 86400
        try:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    """SELECT
                         count(*)                                            AS total,
                         count(*) FILTER (WHERE ml_pred = passed)            AS agree,
                         count(*) FILTER (WHERE ml_pred AND NOT passed)      AS ml_human_llm_bot,
                         count(*) FILTER (WHERE NOT ml_pred AND passed)      AS ml_bot_llm_human
                       FROM gesture_metrics
                       WHERE ts >= $1 AND ml_pred IS NOT NULL""",
                    since,
                )
                vers = await conn.fetch(
                    """SELECT ml_model_version AS v, count(*) AS n
                       FROM gesture_metrics
                       WHERE ts >= $1 AND ml_model_version IS NOT NULL
                       GROUP BY ml_model_version ORDER BY n DESC""",
                    since,
                )
        except Exception:
            return empty
        total = row["total"] or 0
        return {
            "days": days,
            "total": total,
            "agree": row["agree"] or 0,
            "agreement_rate": round((row["agree"] or 0) / total, 4) if total else 0.0,
            "ml_human_llm_bot": row["ml_human_llm_bot"] or 0,   # GBM says human, LLM says bot
            "ml_bot_llm_human": row["ml_bot_llm_human"] or 0,   # GBM says bot, LLM says human
            "model_versions": [{"version": r["v"], "count": r["n"]} for r in vers],
        }

    async def get_gesture_stats(self, days: int = 30) -> dict:
        """Return aggregated gesture metric stats for the admin Gesture Research panel."""
        if self._use_mem or not self._pool:
            return {"total": 0, "passed": 0, "failed": 0, "period_days": days,
                    "by_day": [], "distributions": {}, "records": [],
                    "lifts": {"tracked": 0, "with_lift": 0, "no_lift": 0,
                              "lift_share": None, "pass_rate_with_lift": None,
                              "pass_rate_no_lift": None, "avg_lifts_when_lifted": None,
                              "avg_lift_ms_when_lifted": None}}
        since = int(time.time()) - days * 86400
        async with self._pool.acquire() as conn:
            total_row = await conn.fetchrow(
                "SELECT COUNT(*) AS n, SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS p "
                "FROM gesture_metrics WHERE ts >= $1", since
            )
            total = total_row["n"] or 0
            passed = total_row["p"] or 0

            dist_row = await conn.fetchrow(
                """
                SELECT
                    AVG(rhythm_irregularity)  AS avg_rhythm,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rhythm_irregularity) AS med_rhythm,
                    AVG(correction_count)     AS avg_corrections,
                    AVG(velocity_std)         AS avg_vel_std,
                    AVG(pause_entropy)        AS avg_pause_entropy,
                    AVG(point_count)          AS avg_points,
                    AVG(duration_ms)          AS avg_duration_ms
                FROM gesture_metrics WHERE ts >= $1
                """,
                since,
            )

            by_day_rows = await conn.fetch(
                """
                SELECT
                    TO_CHAR(TO_TIMESTAMP(ts), 'YYYY-MM-DD') AS day,
                    COUNT(*) AS total,
                    SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed
                FROM gesture_metrics WHERE ts >= $1
                GROUP BY day ORDER BY day DESC LIMIT 30
                """,
                since,
            )

            record_rows = await conn.fetch(
                """
                SELECT ts, passed, via_fallback,
                       rhythm_irregularity, correction_count, velocity_std,
                       pause_entropy, point_count, duration_ms, device_hint,
                       lift_count, total_lift_ms
                FROM gesture_metrics WHERE ts >= $1
                ORDER BY ts DESC LIMIT 100
                """,
                since,
            )

            # Pen lifts: how common they are, and how the CURRENT model treats
            # gestures containing one. Rows written before lift tracking shipped
            # have lift_count NULL and are excluded rather than counted as zero.
            lift_row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*)                                          AS tracked,
                    SUM(CASE WHEN lift_count > 0 THEN 1 ELSE 0 END)   AS with_lift,
                    SUM(CASE WHEN lift_count > 0 AND passed THEN 1 ELSE 0 END) AS with_lift_passed,
                    SUM(CASE WHEN lift_count = 0 THEN 1 ELSE 0 END)   AS no_lift,
                    SUM(CASE WHEN lift_count = 0 AND passed THEN 1 ELSE 0 END) AS no_lift_passed,
                    AVG(NULLIF(lift_count, 0))                        AS avg_lifts_when_lifted,
                    AVG(NULLIF(total_lift_ms, 0))                     AS avg_lift_ms_when_lifted
                FROM gesture_metrics
                WHERE ts >= $1 AND lift_count IS NOT NULL
                """,
                since,
            )

        def _f(v): return round(float(v), 4) if v is not None else None

        def _lift_summary(row) -> dict:
            """Pen-lift rates. NOTE: `passed` is the CURRENT model's own verdict,
            not ground truth (docs/strategy/finetuning-loop.md §2) — a gap between
            these two pass rates says how we TREAT lifters, not whether lifting is
            genuinely human. Useful precisely because it surfaces us penalising
            people for pausing."""
            tracked = (row["tracked"] or 0) if row else 0
            if not tracked:
                return {"tracked": 0, "with_lift": 0, "no_lift": 0,
                        "lift_share": None, "pass_rate_with_lift": None,
                        "pass_rate_no_lift": None, "avg_lifts_when_lifted": None,
                        "avg_lift_ms_when_lifted": None}
            with_lift = row["with_lift"] or 0
            no_lift   = row["no_lift"] or 0
            return {
                "tracked":   tracked,
                "with_lift": with_lift,
                "no_lift":   no_lift,
                "lift_share": round(with_lift / tracked, 4),
                "pass_rate_with_lift": round((row["with_lift_passed"] or 0) / with_lift, 4) if with_lift else None,
                "pass_rate_no_lift":   round((row["no_lift_passed"] or 0) / no_lift, 4) if no_lift else None,
                "avg_lifts_when_lifted":   _f(row["avg_lifts_when_lifted"]),
                "avg_lift_ms_when_lifted": _f(row["avg_lift_ms_when_lifted"]),
            }

        return {
            "total": total,
            "passed": passed,
            "failed": total - passed,
            "period_days": days,
            "distributions": {
                "avg_rhythm_irregularity": _f(dist_row["avg_rhythm"]),
                "med_rhythm_irregularity": _f(dist_row["med_rhythm"]),
                "avg_correction_count":    _f(dist_row["avg_corrections"]),
                "avg_velocity_std":        _f(dist_row["avg_vel_std"]),
                "avg_pause_entropy":       _f(dist_row["avg_pause_entropy"]),
                "avg_point_count":         _f(dist_row["avg_points"]),
                "avg_duration_ms":         _f(dist_row["avg_duration_ms"]),
            },
            "lifts": _lift_summary(lift_row),
            "by_day": [
                {"day": r["day"], "total": r["total"], "passed": r["passed"]}
                for r in by_day_rows
            ],
            "records": [
                {
                    "ts":                   r["ts"],
                    "passed":               r["passed"],
                    "via_fallback":         r["via_fallback"],
                    "rhythm_irregularity":  _f(r["rhythm_irregularity"]),
                    "correction_count":     r["correction_count"],
                    "velocity_std":         _f(r["velocity_std"]),
                    "pause_entropy":        _f(r["pause_entropy"]),
                    "point_count":          r["point_count"],
                    "duration_ms":          r["duration_ms"],
                    "device_hint":          (r["device_hint"] or "")[:40],
                    "lift_count":           r["lift_count"],
                    "total_lift_ms":        r["total_lift_ms"],
                }
                for r in record_rows
            ],
        }

    # ── Device fingerprint binding ─────────────────────────────────────────────

    async def fp_has_credential(self, fp_hash: str) -> bool:
        """True if this device still holds a LIVE credential.

        The Sybil rule is one *active* credential per device, not one ever.
        Credentials expire after CREDENTIAL_TTL_DAYS, but the bind used to be
        permanent — so 30 days on, the holder had a dead credential and a device
        that could never issue another one. A bind older than the credential
        lifetime is therefore stale and does not block re-verification; issuing
        again simply rebinds the same fp_hash (see fp_mark_verified's upsert).
        """
        if self._use_mem:
            rec = self._mem_fp_credentials.get(fp_hash)
            return bool(rec and rec[1] > int(time.time()) - CREDENTIAL_TTL_DAYS * 86400)
        # Cutoff computed here rather than as SQL interval arithmetic: asyncpg
        # infers a plain timestamptz parameter unambiguously. verified_at is only
        # ever NULL alongside has_credential=FALSE (one writer, and it always
        # stamps now()), so the NULL comparison cannot mask a live bind.
        cutoff = datetime.now(timezone.utc) - timedelta(days=CREDENTIAL_TTL_DAYS)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT has_credential FROM device_fingerprints "
                "WHERE fp_hash=$1 AND verified_at > $2",
                fp_hash, cutoff,
            )
            return bool(row and row["has_credential"])

    async def fp_mark_verified(self, fp_hash: str, did_hash_short: str) -> None:
        """After DID issuance, bind this fp_hash to the issued credential."""
        if self._use_mem:
            self._mem_fp_credentials[fp_hash] = (did_hash_short, int(time.time()))
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO device_fingerprints (fp_hash, has_credential, did_hash_short, verified_at)
                VALUES ($1, TRUE, $2, now())
                ON CONFLICT (fp_hash) DO UPDATE
                SET has_credential=TRUE, did_hash_short=$2, verified_at=now()
                """,
                fp_hash, did_hash_short,
            )

    # ── Web Push subscriptions ─────────────────────────────────────────────────

    async def save_push_subscription(
        self, did_short: str, endpoint: str, p256dh: str, auth: str,
    ) -> None:
        """Upsert a Web Push subscription for a DID (one per browser/device)."""
        if not self._pool:
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO push_subscriptions (did_short, endpoint, p256dh, auth, ts)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (did_short, endpoint) DO UPDATE
                SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, ts = EXCLUDED.ts
                """,
                did_short, endpoint, p256dh, auth, int(time.time()),
            )

    async def get_push_subscriptions(self, did_short: str) -> list[dict]:
        """Return all active push subscriptions for a DID."""
        if not self._pool:
            return []
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE did_short = $1",
                did_short,
            )
        return [dict(r) for r in rows]

    async def delete_push_subscription(self, did_short: str, endpoint: str) -> None:
        """Remove a specific push subscription (e.g. after 410 Gone from push service)."""
        if not self._pool:
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM push_subscriptions WHERE did_short = $1 AND endpoint = $2",
                did_short, endpoint,
            )

    # ── R2: Risk Events ───────────────────────────────────────────────────────

    async def record_risk_event(
        self,
        session_hash: Optional[str],
        risk_score: float,
        classification: str,
        signals: list[str],
        outcome: str,                   # passed | blocked | stepped_up
        api_key: Optional[str] = None,
        country_band: Optional[str] = None,
        ip_hash: Optional[str] = None,
        asn_type: Optional[str] = None,  # datacenter|residential|vpn|tor|unknown
    ) -> None:
        """
        Persist one risk assessment event (zero-PII: no raw IP, no raw UA).
        In-memory fallback keeps the last 10 000 events.
        """
        import json as _json
        now = int(time.time())
        record = {
            "ts": now,
            "api_key": api_key,
            "session_hash": session_hash,
            "risk_score": risk_score,
            "classification": classification,
            "signals": signals,
            "outcome": outcome,
            "country_band": country_band,
            "ip_hash": ip_hash,
            "asn_type": asn_type or "unknown",
        }
        if self._use_mem:
            self._mem_risk_events.append(record)
            if len(self._mem_risk_events) > 10_000:
                self._mem_risk_events = self._mem_risk_events[-10_000:]
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO risk_events
                       (ts, api_key, session_hash, risk_score, classification,
                        signals, outcome, country_band, asn_type)
                   VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)""",
                now, api_key, session_hash, risk_score, classification,
                _json.dumps(signals), outcome, country_band, asn_type or "unknown",
            )

    async def log_ip_audit(
        self,
        ip_addr: str,
        ip_hash: str,
        classification: str,
        outcome: str,
        session_hash: Optional[str] = None,
        asn_type: Optional[str] = None,
        ai_provider: Optional[str] = None,
    ) -> None:
        """Write raw IP to audit log (TTL 30 days, admin-only access)."""
        if self._use_mem or not self._pool:
            return
        now = int(time.time())
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO ip_audit_log
                       (ts, ip_addr, ip_hash, classification, outcome, session_hash, asn_type, ai_provider)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                now, ip_addr, ip_hash, classification, outcome, session_hash,
                asn_type or "unknown", ai_provider or "",
            )

    async def get_ip_audit(self, limit: int = 200, days: int = 30) -> list[dict]:
        """Return recent IP audit log entries (admin only)."""
        if self._use_mem or not self._pool:
            return []
        since = int(time.time()) - days * 86400
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT ts, ip_addr, ip_hash, classification, outcome, session_hash, asn_type, ai_provider
                   FROM ip_audit_log WHERE ts >= $1
                   ORDER BY ts DESC LIMIT $2""",
                since, limit,
            )
        return [dict(r) for r in rows]

    async def get_asn_stats(self, days: int = 30) -> dict:
        """ASN type breakdown from ip_audit_log for the last N days."""
        if self._use_mem or not self._pool:
            return {"by_type": {}, "by_outcome": {}, "total": 0, "days": days}
        since = int(time.time()) - days * 86400
        async with self._pool.acquire() as conn:
            type_rows = await conn.fetch(
                """SELECT asn_type, COUNT(*) AS cnt
                   FROM ip_audit_log WHERE ts >= $1
                   GROUP BY asn_type ORDER BY cnt DESC""",
                since,
            )
            outcome_rows = await conn.fetch(
                """SELECT asn_type, outcome, COUNT(*) AS cnt
                   FROM ip_audit_log WHERE ts >= $1
                   GROUP BY asn_type, outcome ORDER BY asn_type, outcome""",
                since,
            )
        by_type = {r["asn_type"]: r["cnt"] for r in type_rows}
        by_outcome: dict[str, dict[str, int]] = {}
        for r in outcome_rows:
            asn = r["asn_type"]
            by_outcome.setdefault(asn, {})[r["outcome"]] = r["cnt"]
        total = sum(by_type.values())
        return {"by_type": by_type, "by_outcome": by_outcome, "total": total, "days": days}

    async def cleanup_ip_audit(self, days: int = 30) -> int:
        """Delete IP audit entries older than TTL. Returns deleted count."""
        if self._use_mem or not self._pool:
            return 0
        cutoff = int(time.time()) - days * 86400
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM ip_audit_log WHERE ts < $1",
                cutoff,
            )
        try:
            return int(result.split()[-1])
        except Exception:
            return 0

    async def get_attack_stats(self, days: int = 30, api_key: Optional[str] = None) -> dict:
        """
        Aggregate attack statistics for the last N days.
        Returns totals by classification + blocked count.
        """
        since = int(time.time()) - days * 86400

        if self._use_mem:
            events = [e for e in self._mem_risk_events if e["ts"] >= since]
            if api_key is not None:
                events = [e for e in events if e.get("api_key") == api_key]
            return {
                "sessions":   len(events),
                "humans":     sum(1 for e in events if e["classification"] == "human"),
                "bots":       sum(1 for e in events if e["classification"] == "bot"),
                "ai_agents":  sum(1 for e in events if e["classification"] == "ai_agent"),
                "suspicious": sum(1 for e in events if e["classification"] == "suspicious"),
                "blocked":    sum(1 for e in events if e["outcome"] == "blocked"),
            }

        async with self._pool.acquire() as conn:
            if api_key is not None:
                row = await conn.fetchrow(
                    """SELECT COUNT(*) AS sessions,
                       COUNT(*) FILTER (WHERE classification = 'human') AS humans,
                       COUNT(*) FILTER (WHERE classification = 'bot') AS bots,
                       COUNT(*) FILTER (WHERE classification = 'ai_agent') AS ai_agents,
                       COUNT(*) FILTER (WHERE classification = 'suspicious') AS suspicious,
                       COUNT(*) FILTER (WHERE outcome = 'blocked') AS blocked
                    FROM risk_events WHERE ts >= $1 AND api_key = $2""",
                    since, api_key,
                )
            else:
                row = await conn.fetchrow(
                    """SELECT COUNT(*) AS sessions,
                       COUNT(*) FILTER (WHERE classification = 'human') AS humans,
                       COUNT(*) FILTER (WHERE classification = 'bot') AS bots,
                       COUNT(*) FILTER (WHERE classification = 'ai_agent') AS ai_agents,
                       COUNT(*) FILTER (WHERE classification = 'suspicious') AS suspicious,
                       COUNT(*) FILTER (WHERE outcome = 'blocked') AS blocked
                    FROM risk_events WHERE ts >= $1""",
                    since,
                )
            return dict(row) if row else {
                "sessions": 0, "humans": 0, "bots": 0,
                "ai_agents": 0, "suspicious": 0, "blocked": 0,
            }

    async def get_attack_stats_by_day(
        self, days: int = 30, api_key: Optional[str] = None
    ) -> list[dict]:
        """Per-day breakdown of attack stats (for chart on /stats page)."""
        since = int(time.time()) - days * 86400

        if self._use_mem:
            return []  # not worth computing in dev mode

        async with self._pool.acquire() as conn:
            if api_key is not None:
                rows = await conn.fetch(
                    """SELECT to_char(to_timestamp(ts), 'YYYY-MM-DD') AS day,
                       COUNT(*) AS sessions,
                       COUNT(*) FILTER (WHERE classification = 'human') AS humans,
                       COUNT(*) FILTER (WHERE classification = 'bot') AS bots,
                       COUNT(*) FILTER (WHERE classification = 'ai_agent') AS ai_agents,
                       COUNT(*) FILTER (WHERE classification = 'suspicious') AS suspicious,
                       COUNT(*) FILTER (WHERE outcome = 'blocked') AS blocked
                    FROM risk_events WHERE ts >= $1 AND api_key = $2
                    GROUP BY day ORDER BY day DESC LIMIT $3""",
                    since, api_key, days,
                )
            else:
                rows = await conn.fetch(
                    """SELECT to_char(to_timestamp(ts), 'YYYY-MM-DD') AS day,
                       COUNT(*) AS sessions,
                       COUNT(*) FILTER (WHERE classification = 'human') AS humans,
                       COUNT(*) FILTER (WHERE classification = 'bot') AS bots,
                       COUNT(*) FILTER (WHERE classification = 'ai_agent') AS ai_agents,
                       COUNT(*) FILTER (WHERE classification = 'suspicious') AS suspicious,
                       COUNT(*) FILTER (WHERE outcome = 'blocked') AS blocked
                    FROM risk_events WHERE ts >= $1
                    GROUP BY day ORDER BY day DESC LIMIT $2""",
                    since, days,
                )
            return [dict(r) for r in rows]

    async def get_community_stats(self, days: int = 30, online_gold_dids: Optional[set] = None) -> dict:
        """
        Vouching (HSI Bond) + Gold Member aggregates for the public /stats page.

        Returns vouching-request counts by outcome, individual vouch/decline
        tallies, and the active Gold Member total. The *online* Gold count is
        added by the endpoint (it lives in the live WebSocket manager, not the
        DB). Zero-PII: only counts, never DIDs.
        """
        since = int(time.time()) - days * 86400

        if self._use_mem:
            reqs = [
                r for r in self._mem.values()
                if isinstance(r, dict) and "requester_did" in r
                and r.get("created_at", 0) >= since
            ]
            approvals = sum(len(v) for v in self._mem_approvals.values())
            rejections = sum(len(v) for v in self._mem.get("_rejections", {}).values())
            gold_rows = [
                a for a in self._mem_admin_dids.values()
                if a.get("role") == "gold_member" and a.get("active", True)
            ]
            gt, go = _gold_person_counts(gold_rows, online_gold_dids)
            return {
                "requests_total":    len(reqs),
                "requests_approved": sum(1 for r in reqs if r.get("status") == "approved"),
                "requests_pending":  sum(1 for r in reqs if r.get("status") == "pending"),
                "requests_failed":   sum(1 for r in reqs if r.get("status") == "failed"),
                "approvals_total":   approvals,
                "rejections_total":  rejections,
                "gold_total":        gt,
                "gold_online":       go,
            }

        async with self._pool.acquire() as conn:
            req_row = await conn.fetchrow(
                """SELECT
                    COUNT(*)                                      AS requests_total,
                    COUNT(*) FILTER (WHERE status = 'approved')   AS requests_approved,
                    COUNT(*) FILTER (WHERE status = 'pending')    AS requests_pending,
                    COUNT(*) FILTER (WHERE status = 'failed')     AS requests_failed
                FROM bond_requests WHERE created_at >= $1""",
                since,
            )
            approvals_total = await conn.fetchval(
                "SELECT COUNT(*) FROM bond_approvals WHERE approved_at >= $1", since
            )
            rejections_total = await conn.fetchval(
                "SELECT COUNT(*) FROM bond_rejections WHERE rejected_at >= $1", since
            )
            gold_rows = await conn.fetch(
                "SELECT display_name, did_full FROM admin_dids "
                "WHERE role = 'gold_member' AND active = TRUE"
            )
            gt, go = _gold_person_counts([dict(r) for r in gold_rows], online_gold_dids)
            d = dict(req_row) if req_row else {}
            return {
                "requests_total":    d.get("requests_total") or 0,
                "requests_approved": d.get("requests_approved") or 0,
                "requests_pending":  d.get("requests_pending") or 0,
                "requests_failed":   d.get("requests_failed") or 0,
                "approvals_total":   approvals_total or 0,
                "rejections_total":  rejections_total or 0,
                "gold_total":        gt,
                "gold_online":       go,
            }

    async def _approval_counts_by_approver(self) -> dict:
        """Map approver_did → number of vouches they have given (all time)."""
        if self._use_mem:
            counts: dict = {}
            for lst in self._mem_approvals.values():
                for d in lst:
                    counts[d] = counts.get(d, 0) + 1
            return counts
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT approver_did, COUNT(*) AS n FROM bond_approvals GROUP BY approver_did"
            )
            return {r["approver_did"]: r["n"] for r in rows}

    async def get_bond_audit(self, requester: Optional[str] = None, approver: Optional[str] = None,
                             days: Optional[int] = None, limit: int = 200) -> list[dict]:
        """
        Vouching ledger for incident review (admin-only): who vouched for whom,
        when, whether the Ed25519 signature verified, and the request outcome.
        Filterable by requester/approver DID substring and a recency window.
        """
        if self._use_mem:
            reqs = {r["id"]: r for r in self._mem.values()
                    if isinstance(r, dict) and "requester_did" in r}
            events = []
            for rid, approvers in self._mem_approvals.items():
                req = reqs.get(rid)
                if not req:
                    continue
                for ap in approvers:
                    events.append({
                        "requester_did": req["requester_did"],
                        "approver_did":  ap,
                        "approved_at":   req.get("updated_at") or req.get("created_at"),
                        "sig_verified":  True,
                        "request_status": req.get("status"),
                        "tx_hash":       req.get("tx_hash"),
                    })
            if requester: events = [e for e in events if requester in e["requester_did"]]
            if approver:  events = [e for e in events if approver in e["approver_did"]]
            if days:
                since = int(time.time()) - days * 86400
                events = [e for e in events if (e["approved_at"] or 0) >= since]
            events.sort(key=lambda e: e["approved_at"] or 0, reverse=True)
            return events[:limit]

        async with self._pool.acquire() as conn:
            since_ts = int(time.time()) - days * 86400 if days else None
            rows = await conn.fetch(
                """SELECT br.requester_did, ba.approver_did, ba.approved_at, ba.sig_verified,
                          br.status AS request_status, br.tx_hash
                   FROM bond_approvals ba
                   JOIN bond_requests br ON br.id = ba.request_id
                   WHERE ($1::text IS NULL OR br.requester_did ILIKE $1)
                     AND ($2::text IS NULL OR ba.approver_did ILIKE $2)
                     AND ($3::bigint IS NULL OR ba.approved_at >= $3)
                   ORDER BY ba.approved_at DESC LIMIT $4""",
                f"%{requester}%" if requester else None,
                f"%{approver}%" if approver else None,
                since_ts,
                limit,
            )
            return [dict(r) for r in rows]

    async def get_founders(self, online_gold_dids: Optional[set] = None,
                           online_did_hashes: Optional[set] = None) -> list[dict]:
        """
        Public roster of admins + Gold members, grouped by person (display_name).
        Founders are public by design; we expose only what they chose — name,
        roles, avatar, vouches given, joined date, online — and truncate DIDs to
        the last 8 chars. No full DID, no PII beyond the public name.

        A person can hold BOTH roles (admin + gold) — `roles` is the full list.
        Online = any of their DIDs has a live WebSocket: either the Gold bond
        panel (`online_gold_dids`, full DIDs) or general app presence
        (`online_did_hashes`, the did_hash[:16] keys of all connections).
        """
        from services.did_key import did_hash as _did_hash
        rows = await self.get_admin_dids(role=None, active_only=True)
        counts = await self._approval_counts_by_approver()
        panel = online_gold_dids or set()
        conns = online_did_hashes or set()

        def nk(s: str) -> str:
            return " ".join((s or "").split()).lower()

        def is_online(full: str) -> bool:
            if not full:
                return False
            if full in panel:
                return True
            try:
                return _did_hash(full)[:16] in conns
            except Exception:
                return False

        groups: dict = {}
        for r in rows:
            k = nk(r.get("display_name", ""))
            if not k:
                continue
            g = groups.setdefault(k, {"name": r.get("display_name"), "roles": set(),
                                      "avatar": None, "dids": [], "joined": None,
                                      "online": False, "vouches": 0})
            g["roles"].add(r.get("role"))
            if r.get("avatar_url") and not g["avatar"]:
                g["avatar"] = r["avatar_url"]
            full = r.get("did_full") or ""
            g["dids"].append({"short": (full[-8:] if full else r.get("did_short")),
                              "browser": r.get("browser")})
            at = r.get("added_at") or 0
            g["joined"] = at if g["joined"] is None else min(g["joined"], at)
            if is_online(full):
                g["online"] = True
            g["vouches"] += counts.get(full, 0)

        out = []
        for g in groups.values():
            is_admin = "admin" in g["roles"]
            out.append({
                "name": g["name"],
                "role": "admin" if is_admin else "gold_member",  # primary (sort/colour)
                "roles": sorted(g["roles"]),                      # full set — a person can be both
                "avatar": g["avatar"],
                "dids": g["dids"],
                "device_count": len(g["dids"]),
                "joined": g["joined"],
                "online": g["online"],
                "vouches": g["vouches"],
            })
        # Admins first, then most-active vouchers, then alphabetical.
        out.sort(key=lambda x: (x["role"] != "admin", -x["vouches"], (x["name"] or "").lower()))
        return out

    # ── R1: Organization API keys ───────────────────────────────────────────────

    async def create_api_key(
        self,
        publishable_key: str,
        secret_hash: str,
        owner_did: str,
        name: str,
        allowed_origins: list[str],
    ) -> dict:
        import json as _json
        now = int(time.time())
        if self._use_mem:
            self._api_key_seq += 1
            row = {
                "id": self._api_key_seq,
                "publishable_key": publishable_key,
                "secret_hash": secret_hash,
                "owner_did": owner_did,
                "name": name,
                "allowed_origins": list(allowed_origins),
                "active": True,
                "created_at": now,
                "last_used_at": None,
            }
            self._mem_api_keys[publishable_key] = row
            return row
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO api_keys
                       (publishable_key, secret_hash, owner_did, name, allowed_origins, created_at)
                   VALUES ($1,$2,$3,$4,$5::jsonb,$6)
                   RETURNING *""",
                publishable_key, secret_hash, owner_did, name,
                _json.dumps(list(allowed_origins)), now,
            )
            return self._row_to_api_key(row)

    @staticmethod
    def _row_to_api_key(row) -> dict:
        import json as _json
        d = dict(row)
        ao = d.get("allowed_origins")
        if isinstance(ao, str):
            d["allowed_origins"] = _json.loads(ao)
        return d

    async def get_api_key_by_pk(self, publishable_key: str) -> Optional[dict]:
        if self._use_mem:
            return self._mem_api_keys.get(publishable_key)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM api_keys WHERE publishable_key = $1", publishable_key
            )
            return self._row_to_api_key(row) if row else None

    async def get_api_key_by_secret_hash(self, secret_hash: str) -> Optional[dict]:
        if self._use_mem:
            for row in self._mem_api_keys.values():
                if row["secret_hash"] == secret_hash and row["active"]:
                    return row
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM api_keys WHERE secret_hash = $1 AND active = TRUE", secret_hash
            )
            return self._row_to_api_key(row) if row else None

    async def list_api_keys(self, owner_did: str) -> list[dict]:
        if self._use_mem:
            return [r for r in self._mem_api_keys.values() if r["owner_did"] == owner_did]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM api_keys WHERE owner_did = $1 ORDER BY created_at DESC", owner_did
            )
            return [self._row_to_api_key(r) for r in rows]

    async def deactivate_api_key(self, key_id: int, owner_did: str) -> bool:
        """Soft-delete a key only if it belongs to owner_did. Returns True on success."""
        if self._use_mem:
            for row in self._mem_api_keys.values():
                if row["id"] == key_id and row["owner_did"] == owner_did:
                    row["active"] = False
                    return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE api_keys SET active = FALSE WHERE id = $1 AND owner_did = $2",
                key_id, owner_did,
            )
            return result != "UPDATE 0"

    async def count_active_api_keys(self, owner_did: str) -> int:
        if self._use_mem:
            return sum(1 for r in self._mem_api_keys.values()
                       if r["owner_did"] == owner_did and r["active"])
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(
                "SELECT COUNT(*) FROM api_keys WHERE owner_did=$1 AND active=TRUE", owner_did
            )
            return int(val or 0)

    async def reactivate_api_key(self, key_id: int, owner_did: str) -> bool:
        """Re-enable a soft-deleted key only if it belongs to owner_did."""
        if self._use_mem:
            for row in self._mem_api_keys.values():
                if row["id"] == key_id and row["owner_did"] == owner_did:
                    row["active"] = True
                    return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE api_keys SET active=TRUE WHERE id=$1 AND owner_did=$2",
                key_id, owner_did,
            )
            return result != "UPDATE 0"

    async def touch_api_key(self, publishable_key: str) -> None:
        now = int(time.time())
        if self._use_mem:
            row = self._mem_api_keys.get(publishable_key)
            if row:
                row["last_used_at"] = now
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE api_keys SET last_used_at = $2 WHERE publishable_key = $1",
                publishable_key, now,
            )

    async def increment_usage(self, publishable_key: str, period: str) -> None:
        if self._use_mem:
            key = (publishable_key, period)
            self._mem_usage[key] = self._mem_usage.get(key, 0) + 1
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO usage_counters (publishable_key, period, verifications)
                   VALUES ($1, $2, 1)
                   ON CONFLICT (publishable_key, period)
                   DO UPDATE SET verifications = usage_counters.verifications + 1""",
                publishable_key, period,
            )

    async def get_usage(self, publishable_key: str, period: str) -> int:
        if self._use_mem:
            return self._mem_usage.get((publishable_key, period), 0)
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(
                "SELECT verifications FROM usage_counters WHERE publishable_key = $1 AND period = $2",
                publishable_key, period,
            )
            return int(val or 0)

    async def get_gesture_count(self, publishable_key: str, period: str) -> int:
        """How many gestures were drawn+classified for this key in `period`
        (YYYY-MM). This is the raw attempt count — distinct from get_usage, which
        counts billed server-side /siteverify calls. gesture_metrics.ts is stored
        in SECONDS (int(time.time()))."""
        if self._use_mem or not self._pool:
            return 0
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(
                "SELECT count(*) FROM gesture_metrics "
                "WHERE api_key = $1 AND to_char(to_timestamp(ts), 'YYYY-MM') = $2",
                publishable_key, period,
            )
            return int(val or 0)

    # ── R1-D1: Domain-ownership verifications ───────────────────────────────────

    async def create_domain_verification(self, owner_did: str, origin: str, token: str) -> dict:
        """Upsert a pending verification for (owner, origin); refresh token; reset status."""
        now = int(time.time())
        if self._use_mem:
            for row in self._mem_domains.values():
                if row["owner_did"] == owner_did and row["origin"] == origin:
                    row.update(token=token, status="pending", method=None,
                               created_at=now, verified_at=None)
                    return row
            self._domain_seq += 1
            row = {
                "id": self._domain_seq, "owner_did": owner_did, "origin": origin,
                "token": token, "method": None, "status": "pending",
                "created_at": now, "verified_at": None,
            }
            self._mem_domains[row["id"]] = row
            return row
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO domain_verifications (owner_did, origin, token, status, created_at)
                   VALUES ($1,$2,$3,'pending',$4)
                   ON CONFLICT (owner_did, origin) DO UPDATE SET
                       token=EXCLUDED.token, status='pending', method=NULL,
                       created_at=EXCLUDED.created_at, verified_at=NULL
                   RETURNING *""",
                owner_did, origin, token, now,
            )
            return dict(row)

    async def get_domain_verification_by_origin(self, owner_did: str, origin: str) -> Optional[dict]:
        if self._use_mem:
            for row in self._mem_domains.values():
                if row["owner_did"] == owner_did and row["origin"] == origin:
                    return row
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM domain_verifications WHERE owner_did=$1 AND origin=$2 ORDER BY created_at DESC LIMIT 1",
                owner_did, origin,
            )
            return dict(row) if row else None

    async def get_domain_verification(self, vid: int, owner_did: str) -> Optional[dict]:
        if self._use_mem:
            row = self._mem_domains.get(vid)
            return row if (row and row["owner_did"] == owner_did) else None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM domain_verifications WHERE id=$1 AND owner_did=$2", vid, owner_did
            )
            return dict(row) if row else None

    async def list_domain_verifications(self, owner_did: str) -> list[dict]:
        if self._use_mem:
            return [r for r in self._mem_domains.values() if r["owner_did"] == owner_did]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM domain_verifications WHERE owner_did=$1 ORDER BY created_at DESC",
                owner_did,
            )
            return [dict(r) for r in rows]

    async def mark_domain_verified(self, vid: int, method: str) -> None:
        now = int(time.time())
        if self._use_mem:
            row = self._mem_domains.get(vid)
            if row:
                row.update(status="verified", method=method, verified_at=now)
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE domain_verifications SET status='verified', method=$2, verified_at=$3 WHERE id=$1",
                vid, method, now,
            )

    async def mark_domain_failed(self, vid: int) -> None:
        if self._use_mem:
            row = self._mem_domains.get(vid)
            if row:
                row["status"] = "failed"
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE domain_verifications SET status='failed' WHERE id=$1", vid
            )

    async def is_origin_verified(self, owner_did: str, origin: str) -> bool:
        if self._use_mem:
            return any(
                r["owner_did"] == owner_did and r["origin"] == origin and r["status"] == "verified"
                for r in self._mem_domains.values()
            )
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT 1 FROM domain_verifications WHERE owner_did=$1 AND origin=$2 AND status='verified'",
                owner_did, origin,
            )
            return row is not None

    async def delete_domain_verification(self, vid: int, owner_did: str) -> bool:
        """Owner-scoped delete of a single verification. Returns True if a row was removed."""
        if self._use_mem:
            row = self._mem_domains.get(vid)
            if row and row["owner_did"] == owner_did:
                del self._mem_domains[vid]
                return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM domain_verifications WHERE id=$1 AND owner_did=$2", vid, owner_did
            )
            return result != "DELETE 0"

    async def delete_domain_verification_by_id(self, vid: int) -> bool:
        """Admin delete of any verification by id (no owner scope). Returns True if removed."""
        if self._use_mem:
            return self._mem_domains.pop(vid, None) is not None
        async with self._pool.acquire() as conn:
            result = await conn.execute("DELETE FROM domain_verifications WHERE id=$1", vid)
            return result != "DELETE 0"

    async def list_domain_verifications_admin(self, limit: int = 200) -> list[dict]:
        """All domain verifications across every owner (admin observability)."""
        if self._use_mem:
            rows = sorted(self._mem_domains.values(), key=lambda r: (r["origin"], r["id"]))
            return [dict(r) for r in rows[:limit]]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM domain_verifications ORDER BY origin, id LIMIT $1", limit
            )
            return [dict(r) for r in rows]

    async def delete_stale_domain_verifications(self, cutoff_ts: int) -> int:
        """
        Delete pending/failed verifications created before cutoff_ts.
        'verified' rows are always kept regardless of age. Returns count deleted.
        """
        if self._use_mem:
            stale = [
                vid for vid, r in self._mem_domains.items()
                if r["status"] in ("pending", "failed") and r["created_at"] < cutoff_ts
            ]
            for vid in stale:
                del self._mem_domains[vid]
            return len(stale)
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM domain_verifications "
                "WHERE status IN ('pending','failed') AND created_at < $1",
                cutoff_ts,
            )
            return int(result.split()[-1])

    # ── R1-E: Billing plans ─────────────────────────────────────────────────────

    async def get_owner_plan(self, owner_did: str) -> str:
        if self._use_mem:
            row = self._mem_owner_plans.get(owner_did)
            return row["plan"] if row else "free"
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(
                "SELECT plan FROM owner_plans WHERE owner_did=$1", owner_did
            )
            return val or "free"

    async def classify_owners(self, dids: list[str]) -> dict[str, dict]:
        """
        For a batch of DIDs, return per-DID org/paid flags for the admin view.

        is_org  → owns developer resources: an active API key OR a verified domain.
        is_paid → has a billing plan other than 'free'.

        Returns: {did: {"is_org": bool, "is_paid": bool}} for every input DID.
        """
        result = {d: {"is_org": False, "is_paid": False} for d in dids}
        if not dids:
            return result

        if self._use_mem:
            org_dids = {
                r["owner_did"] for r in self._mem_api_keys.values()
                if r.get("active", True)
            } | {
                r["owner_did"] for r in self._mem_domains.values()
                if r.get("status") == "verified"
            }
            paid_dids = {
                did for did, row in self._mem_owner_plans.items()
                if row.get("plan", "free") != "free"
            }
            for d in dids:
                result[d] = {"is_org": d in org_dids, "is_paid": d in paid_dids}
            return result

        async with self._pool.acquire() as conn:
            org_rows = await conn.fetch(
                """SELECT DISTINCT owner_did FROM api_keys
                       WHERE active = TRUE AND owner_did = ANY($1::text[])
                   UNION
                   SELECT DISTINCT owner_did FROM domain_verifications
                       WHERE status = 'verified' AND owner_did = ANY($1::text[])""",
                dids,
            )
            paid_rows = await conn.fetch(
                """SELECT owner_did FROM owner_plans
                       WHERE plan <> 'free' AND owner_did = ANY($1::text[])""",
                dids,
            )
            org_dids  = {r["owner_did"] for r in org_rows}
            paid_dids = {r["owner_did"] for r in paid_rows}
            for d in dids:
                result[d] = {"is_org": d in org_dids, "is_paid": d in paid_dids}
            return result

    async def set_owner_plan(self, owner_did: str, plan: str,
                             updated_by: "str | None" = None) -> dict:
        now = int(time.time())
        if self._use_mem:
            row = {"owner_did": owner_did, "plan": plan,
                   "updated_at": now, "updated_by": updated_by}
            self._mem_owner_plans[owner_did] = row
            return row
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO owner_plans (owner_did, plan, updated_at, updated_by)
                   VALUES ($1,$2,$3,$4)
                   ON CONFLICT (owner_did) DO UPDATE SET
                       plan=EXCLUDED.plan, updated_at=EXCLUDED.updated_at,
                       updated_by=EXCLUDED.updated_by
                   RETURNING *""",
                owner_did, plan, now, updated_by,
            )
            return dict(row)

    async def get_owner_usage(self, owner_did: str, period: str) -> int:
        """Pooled verification count across all of the owner's keys for the period."""
        if self._use_mem:
            owned = {pk for pk, row in self._mem_api_keys.items()
                     if row["owner_did"] == owner_did}
            return sum(v for (pk, per), v in self._mem_usage.items()
                       if per == period and pk in owned)
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(
                """SELECT COALESCE(SUM(uc.verifications), 0)
                   FROM usage_counters uc
                   JOIN api_keys ak ON ak.publishable_key = uc.publishable_key
                   WHERE ak.owner_did = $1 AND uc.period = $2""",
                owner_did, period,
            )
            return int(val or 0)

    # ── Self-serve owner accounts (email verification) ──────────────────────────

    async def get_owner_account(self, did: str) -> "Optional[dict]":
        if self._use_mem:
            return self._mem_owner_accounts.get(did)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM owner_accounts WHERE did = $1", did)
            return dict(row) if row else None

    async def email_taken_by_other(self, email: str, did: str) -> bool:
        """True if `email` (case-insensitive) is registered to a different DID."""
        el = email.strip().lower()
        if self._use_mem:
            return any(k != did and r["email"].lower() == el
                       for k, r in self._mem_owner_accounts.items())
        async with self._pool.acquire() as conn:
            other = await conn.fetchval(
                "SELECT did FROM owner_accounts WHERE lower(email) = $1 AND did <> $2",
                el, did,
            )
            return other is not None

    async def upsert_owner_email(self, did: str, email: str, token_hash: str,
                                 token_expires: int, now: int) -> None:
        """Set/replace the owner's email + a fresh verification token, unverified."""
        if self._use_mem:
            existing = self._mem_owner_accounts.get(did, {})
            self._mem_owner_accounts[did] = {
                "did": did, "email": email, "email_verified": False,
                "verify_token_hash": token_hash, "token_expires": token_expires,
                "created_at": existing.get("created_at", now), "verified_at": None,
            }
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO owner_accounts
                     (did, email, email_verified, verify_token_hash, token_expires, created_at, verified_at)
                   VALUES ($1, $2, FALSE, $3, $4, $5, NULL)
                   ON CONFLICT (did) DO UPDATE SET
                     email = EXCLUDED.email,
                     email_verified = FALSE,
                     verify_token_hash = EXCLUDED.verify_token_hash,
                     token_expires = EXCLUDED.token_expires,
                     verified_at = NULL""",
                did, email, token_hash, token_expires, now,
            )

    async def verify_owner_email(self, token_hash: str, now: int) -> "Optional[str]":
        """Redeem a magic-link token: mark the matching account verified. Returns the
        DID on success, or None if no unexpired unverified match. Single-use — the
        token hash is cleared on success."""
        if self._use_mem:
            for did, r in self._mem_owner_accounts.items():
                if (r.get("verify_token_hash") == token_hash
                        and not r["email_verified"]
                        and int(r.get("token_expires") or 0) > now):
                    r["email_verified"] = True
                    r["verified_at"] = now
                    r["verify_token_hash"] = None
                    r["token_expires"] = None
                    return did
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE owner_accounts
                     SET email_verified = TRUE, verified_at = $2,
                         verify_token_hash = NULL, token_expires = NULL
                   WHERE verify_token_hash = $1 AND email_verified = FALSE
                     AND token_expires > $2
                   RETURNING did""",
                token_hash, now,
            )
            return row["did"] if row else None

    async def is_owner_email_verified(self, did: str) -> bool:
        acct = await self.get_owner_account(did)
        return bool(acct and acct.get("email_verified"))

    async def is_owner_suspended(self, did: str) -> bool:
        acct = await self.get_owner_account(did)
        return bool(acct and acct.get("suspended"))

    async def set_owner_suspended(self, did: str, suspended: bool, reason: "Optional[str]",
                                  by_did: str, now: int) -> bool:
        """Suspend/unsuspend an owner. Returns False if the owner has no account row."""
        if self._use_mem:
            acct = self._mem_owner_accounts.get(did)
            if not acct:
                return False
            acct["suspended"] = suspended
            acct["suspended_reason"] = reason if suspended else None
            acct["suspended_at"] = now if suspended else None
            acct["suspended_by"] = by_did if suspended else None
            return True
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE owner_accounts
                     SET suspended = $2,
                         suspended_reason = $3,
                         suspended_at = $4,
                         suspended_by = $5
                   WHERE did = $1
                   RETURNING did""",
                did, suspended,
                reason if suspended else None,
                now if suspended else None,
                by_did if suspended else None,
            )
            return row is not None

    async def list_owner_accounts(self) -> "list[dict]":
        """All owner accounts with key count + this-month pooled usage, for the
        super-admin panel. Includes owners who have keys but never registered an
        email (email NULL)."""
        period = time.strftime("%Y-%m", time.gmtime())
        if self._use_mem:
            dids = set(self._mem_owner_accounts.keys())
            dids.update(row["owner_did"] for row in self._mem_api_keys.values())
            out = []
            for did in dids:
                acct = self._mem_owner_accounts.get(did, {})
                keys = [r for r in self._mem_api_keys.values() if r["owner_did"] == did]
                active = [k for k in keys if k["active"]]
                origins = sorted({o for k in active for o in (k.get("allowed_origins") or [])})
                labels = sorted({k["name"] for k in active if k.get("name")})
                out.append({
                    "did": did,
                    "email": acct.get("email"),
                    "email_verified": bool(acct.get("email_verified")),
                    "suspended": bool(acct.get("suspended")),
                    "suspended_reason": acct.get("suspended_reason"),
                    "admin_note": acct.get("admin_note"),
                    "key_count": len(active),
                    "labels": labels,
                    "origins": origins,
                    "usage_this_month": sum(
                        v for (pk, per), v in self._mem_usage.items()
                        if per == period and pk in {k["publishable_key"] for k in keys}
                    ),
                })
            return out
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH dids AS (
                    SELECT did FROM owner_accounts
                    UNION
                    SELECT DISTINCT owner_did AS did FROM api_keys
                )
                SELECT d.did,
                       oa.email,
                       COALESCE(oa.email_verified, FALSE) AS email_verified,
                       COALESCE(oa.suspended, FALSE)      AS suspended,
                       oa.suspended_reason,
                       oa.admin_note,
                       (SELECT count(*) FROM api_keys ak
                          WHERE ak.owner_did = d.did AND ak.active = TRUE) AS key_count,
                       COALESCE((SELECT array_agg(DISTINCT ak_l.name)
                          FROM api_keys ak_l
                          WHERE ak_l.owner_did = d.did AND ak_l.active = TRUE
                            AND ak_l.name IS NOT NULL), '{}') AS labels,
                       COALESCE((SELECT array_agg(DISTINCT origin)
                          FROM api_keys ak_o,
                               jsonb_array_elements_text(ak_o.allowed_origins) AS origin
                          WHERE ak_o.owner_did = d.did AND ak_o.active = TRUE), '{}') AS origins,
                       COALESCE((SELECT SUM(uc.verifications)
                          FROM usage_counters uc
                          JOIN api_keys ak2 ON ak2.publishable_key = uc.publishable_key
                          WHERE ak2.owner_did = d.did AND uc.period = $1), 0) AS usage_this_month
                FROM dids d
                LEFT JOIN owner_accounts oa ON oa.did = d.did
                ORDER BY suspended DESC, usage_this_month DESC
                """,
                period,
            )
            return [dict(r) for r in rows]

    def _mem_owner_did_for_pk(self, pk: str) -> "Optional[str]":
        row = self._mem_api_keys.get(pk)
        return row["owner_did"] if row else None

    async def admin_update_owner(self, did: str, email: "Optional[str]",
                                 admin_note: "Optional[str]") -> bool:
        """Super-admin edit of an owner account: change the email and/or set an
        internal note. Only provided (non-None) fields change. Returns False if the
        account row does not exist."""
        if self._use_mem:
            acct = self._mem_owner_accounts.get(did)
            if not acct:
                return False
            if email is not None:
                acct["email"] = email
            if admin_note is not None:
                acct["admin_note"] = admin_note
            return True
        # Static queries per field combination — no dynamic SQL. Values are always
        # bound parameters; nothing is interpolated into the statement text.
        async with self._pool.acquire() as conn:
            if email is not None and admin_note is not None:
                row = await conn.fetchrow(
                    "UPDATE owner_accounts SET email = $2, admin_note = $3 WHERE did = $1 RETURNING did",
                    did, email, admin_note)
            elif email is not None:
                row = await conn.fetchrow(
                    "UPDATE owner_accounts SET email = $2 WHERE did = $1 RETURNING did",
                    did, email)
            elif admin_note is not None:
                row = await conn.fetchrow(
                    "UPDATE owner_accounts SET admin_note = $2 WHERE did = $1 RETURNING did",
                    did, admin_note)
            else:
                row = await conn.fetchrow(
                    "SELECT did FROM owner_accounts WHERE did = $1", did)
            return row is not None

    async def admin_delete_owner(self, did: str) -> bool:
        """Delete an owner account and deactivate all their API keys. Returns False
        if there was neither an account row nor any keys for the DID. Usage history
        rows are left intact (they carry the pk, not the account)."""
        had = False
        if self._use_mem:
            if self._mem_owner_accounts.pop(did, None) is not None:
                had = True
            for row in self._mem_api_keys.values():
                if row["owner_did"] == did and row["active"]:
                    row["active"] = False
                    had = True
            return had
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                r1 = await conn.execute(
                    "UPDATE api_keys SET active = FALSE WHERE owner_did = $1 AND active = TRUE", did)
                r2 = await conn.execute("DELETE FROM owner_accounts WHERE did = $1", did)
            # "UPDATE N" / "DELETE N" — non-zero N on either means something existed
            had = any(part[-1] != "0" for part in (r1.split(), r2.split()) if part)
            return had

    async def list_owner_plans(self) -> list[dict]:
        if self._use_mem:
            return list(self._mem_owner_plans.values())
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM owner_plans ORDER BY updated_at DESC"
            )
            return [dict(r) for r in rows]

    # ── R6.3: Data-access requests ──────────────────────────────────────────────

    async def create_data_request(self, did: str, name: str, company: str, email: str,
                                   phone: "str | None", suggested_level: str) -> dict:
        now = int(time.time())
        if self._use_mem:
            self._dar_seq += 1
            row = {"id": self._dar_seq, "did": did, "did_short": did[-8:],
                   "name": name, "company": company, "email": email, "phone": phone,
                   "suggested_level": suggested_level, "granted_level": None,
                   "status": "pending", "reason": None, "created_at": now,
                   "decided_at": None, "decided_by": None}
            self._mem_data_requests.append(row)
            return row
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO data_access_requests
                   (did, did_short, name, company, email, phone, suggested_level, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *""",
                did, did[-8:], name, company, email, phone, suggested_level, now)
            return dict(row)

    async def get_latest_data_request(self, did: str) -> "dict | None":
        if self._use_mem:
            rows = [r for r in self._mem_data_requests if r["did"] == did]
            return max(rows, key=lambda r: r["id"]) if rows else None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM data_access_requests WHERE did=$1 ORDER BY created_at DESC LIMIT 1", did)
            return dict(row) if row else None

    async def list_data_requests(self, status: "str | None" = None, limit: int = 100) -> list[dict]:
        if self._use_mem:
            rows = list(self._mem_data_requests)
            if status:
                rows = [r for r in rows if r["status"] == status]
            rows.sort(key=lambda r: r["created_at"], reverse=True)
            return rows[:limit]
        async with self._pool.acquire() as conn:
            if status:
                rows = await conn.fetch(
                    "SELECT * FROM data_access_requests WHERE status=$1 ORDER BY created_at DESC LIMIT $2",
                    status, limit,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM data_access_requests ORDER BY created_at DESC LIMIT $1",
                    limit,
                )
            return [dict(r) for r in rows]

    async def decide_data_request(self, req_id: int, status: str, granted_level: "str | None",
                                  reason: "str | None", decided_by: str) -> "dict | None":
        now = int(time.time())
        if self._use_mem:
            for r in self._mem_data_requests:
                if r["id"] == req_id:
                    r.update(status=status, granted_level=granted_level, reason=reason,
                             decided_at=now, decided_by=decided_by)
                    return r
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE data_access_requests
                   SET status=$2, granted_level=$3, reason=$4, decided_at=$5, decided_by=$6
                   WHERE id=$1 RETURNING *""",
                req_id, status, granted_level, reason, now, decided_by)
            return dict(row) if row else None

    async def get_signal_breakdown(self, days: int = 180, limit: int = 15) -> list[dict]:
        """Count fired risk signals across risk_events in the window (zero-PII)."""
        since = int(time.time()) - days * 86400
        if self._use_mem:
            tally: dict[str, int] = {}
            for e in self._mem_risk_events:
                if e["ts"] >= since:
                    for s in (e.get("signals") or []):
                        tally[s] = tally.get(s, 0) + 1
            ordered = sorted(tally.items(), key=lambda kv: kv[1], reverse=True)[:limit]
            return [{"signal": s, "count": c} for s, c in ordered]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT s AS signal, COUNT(*) AS count
                   FROM risk_events, jsonb_array_elements_text(signals) s
                   WHERE ts >= $1 GROUP BY s ORDER BY count DESC LIMIT $2""",
                since, limit)
            return [dict(r) for r in rows]

    # ── R1-D4: Alerts ─────────────────────────────────────────────────────────

    async def create_alert(
        self,
        owner_did: str,
        api_key_pk: Optional[str],
        severity: str,
        level: int,
        event_type: str,
        detail: dict,
    ) -> dict:
        import json as _json
        now = int(time.time())
        if self._use_mem:
            self._alert_seq += 1
            row = {
                "id": self._alert_seq,
                "ts": now,
                "owner_did": owner_did,
                "api_key_pk": api_key_pk,
                "severity": severity,
                "level": level,
                "event_type": event_type,
                "detail": detail,
                "status": "active",
                "resolved_at": None,
                "resolved_by": None,
            }
            self._mem_alerts.append(row)
            return dict(row)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO alert_events
                   (ts, owner_did, api_key_pk, severity, level, event_type, detail)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)
                   RETURNING *""",
                now, owner_did, api_key_pk, severity, level, event_type,
                _json.dumps(detail),
            )
            return dict(row)

    async def list_alerts(
        self,
        owner_did: str,
        status: Optional[str] = None,
        limit: int = 20,
    ) -> list[dict]:
        if self._use_mem:
            rows = [r for r in self._mem_alerts if r["owner_did"] == owner_did]
            if status:
                rows = [r for r in rows if r["status"] == status]
            rows.sort(key=lambda r: r["ts"], reverse=True)
            return [dict(r) for r in rows[:limit]]
        params: list = [owner_did]
        if status:
            sql = "SELECT * FROM alert_events WHERE owner_did=$1 AND status=$2 ORDER BY ts DESC LIMIT $3"
            params += [status, limit]
        else:
            sql = "SELECT * FROM alert_events WHERE owner_did=$1 ORDER BY ts DESC LIMIT $2"
            params.append(limit)
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)
            return [dict(r) for r in rows]

    async def count_unread_alerts(self, owner_did: str) -> int:
        if self._use_mem:
            return sum(
                1 for r in self._mem_alerts
                if r["owner_did"] == owner_did and r["status"] == "active"
            )
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(
                "SELECT COUNT(*) FROM alert_events WHERE owner_did=$1 AND status='active'",
                owner_did,
            )
            return int(val or 0)

    async def get_alert(self, alert_id: int, owner_did: str) -> Optional[dict]:
        if self._use_mem:
            for r in self._mem_alerts:
                if r["id"] == alert_id and r["owner_did"] == owner_did:
                    return dict(r)
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM alert_events WHERE id=$1 AND owner_did=$2",
                alert_id, owner_did,
            )
            return dict(row) if row else None

    async def update_alert_status(
        self,
        alert_id: int,
        owner_did: str,
        status: str,
        resolved_by: Optional[str] = None,
    ) -> bool:
        now = int(time.time()) if status == "resolved" else None
        if self._use_mem:
            for r in self._mem_alerts:
                if r["id"] == alert_id and r["owner_did"] == owner_did:
                    r["status"] = status
                    if now:
                        r["resolved_at"] = now
                        r["resolved_by"] = resolved_by
                    return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE alert_events
                   SET status=$3, resolved_at=$4, resolved_by=$5
                   WHERE id=$1 AND owner_did=$2""",
                alert_id, owner_did, status, now, resolved_by,
            )
            return result != "UPDATE 0"

    async def escalate_alert(
        self, alert_id: int, owner_did: str, comment: str
    ) -> bool:
        import json as _json
        if self._use_mem:
            for r in self._mem_alerts:
                if r["id"] == alert_id and r["owner_did"] == owner_did:
                    r["status"] = "escalated"
                    r["level"] = 3
                    r["detail"] = {**r.get("detail", {}), "comment": comment}
                    return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE alert_events
                   SET status='escalated', level=3,
                       detail = detail || $3::jsonb
                   WHERE id=$1 AND owner_did=$2""",
                alert_id, owner_did, _json.dumps({"comment": comment}),
            )
            return result != "UPDATE 0"

    async def update_alert_status_admin(
        self, alert_id: int, status: str, resolved_by: Optional[str] = None
    ) -> bool:
        """Admin resolve — no owner_did check."""
        now = int(time.time()) if status == "resolved" else None
        if self._use_mem:
            for r in self._mem_alerts:
                if r["id"] == alert_id:
                    r["status"] = status
                    if now:
                        r["resolved_at"] = now
                        r["resolved_by"] = resolved_by
                    return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE alert_events SET status=$2, resolved_at=$3, resolved_by=$4 WHERE id=$1",
                alert_id, status, now, resolved_by,
            )
            return result != "UPDATE 0"

    async def list_all_alerts(
        self,
        level: Optional[int] = None,
        severity: Optional[str] = None,
        status: Optional[str] = None,
        owner_did_filter: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        if self._use_mem:
            rows = list(self._mem_alerts)
            if level is not None:
                rows = [r for r in rows if r["level"] == level]
            if severity:
                rows = [r for r in rows if r["severity"] == severity]
            if status:
                rows = [r for r in rows if r["status"] == status]
            if owner_did_filter:
                rows = [r for r in rows if owner_did_filter in r["owner_did"]]
            rows.sort(key=lambda r: r["ts"], reverse=True)
            return [dict(r) for r in rows[:limit]]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM alert_events
                   WHERE ($1::int IS NULL OR level = $1)
                     AND ($2::text IS NULL OR severity = $2)
                     AND ($3::text IS NULL OR status = $3)
                     AND ($4::text IS NULL OR owner_did ILIKE $4)
                   ORDER BY ts DESC LIMIT $5""",
                level if level is not None else None,
                severity or None,
                status or None,
                f"%{owner_did_filter}%" if owner_did_filter else None,
                limit,
            )
            return [dict(r) for r in rows]

    async def get_key_owner(self, api_key_pk: str) -> Optional[str]:
        if self._use_mem:
            key = self._mem_api_keys.get(api_key_pk)
            return key["owner_did"] if key else None
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT owner_did FROM api_keys WHERE publishable_key=$1",
                api_key_pk,
            )

    async def deactivate_key_by_pk(self, api_key_pk: str) -> bool:
        if self._use_mem:
            key = self._mem_api_keys.get(api_key_pk)
            if key:
                key["active"] = False
                return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE api_keys SET active=FALSE WHERE publishable_key=$1",
                api_key_pk,
            )
            return result != "UPDATE 0"

    async def auto_resolve_alerts(self, cutoff_ts: int) -> int:
        """Mark Level-1 active alerts older than cutoff as resolved by 'auto'."""
        now = int(time.time())
        if self._use_mem:
            count = 0
            for r in self._mem_alerts:
                if r["level"] == 1 and r["status"] == "active" and r["ts"] < cutoff_ts:
                    r["status"] = "resolved"
                    r["resolved_at"] = now
                    r["resolved_by"] = "auto"
                    count += 1
            return count
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE alert_events
                   SET status='resolved', resolved_at=$1, resolved_by='auto'
                   WHERE level=1 AND status='active' AND ts < $2""",
                now, cutoff_ts,
            )
            return int(result.split()[-1])

    async def delete_old_alerts(self, cutoff_ts: int) -> int:
        """Delete alerts older than cutoff_ts."""
        if self._use_mem:
            before = len(self._mem_alerts)
            self._mem_alerts = [r for r in self._mem_alerts if r["ts"] >= cutoff_ts]
            return before - len(self._mem_alerts)
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM alert_events WHERE ts < $1",
                cutoff_ts,
            )
            return int(result.split()[-1])

    # ── Platform Handles ───────────────────────────────────────────────────────

    async def upsert_handle(self, platform: str, username_lc: str, did: str,
                            created_at: int, is_public: bool = False) -> None:
        """Claim (or re-claim) platform/username for this DID. Last writer wins.
        is_public defaults to False (private) — Shielded Human privacy-by-default."""
        if self._use_mem:
            self._mem_handles = [h for h in self._mem_handles
                                 if not (h["platform"] == platform and h["username_lc"] == username_lc)]
            self._mem_handles.append({"platform": platform, "username_lc": username_lc,
                                       "did": did, "created_at": created_at,
                                       "is_public": is_public})
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO platform_handles (platform, username_lc, did, created_at, is_public)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (platform, username_lc) DO UPDATE
                   SET did=$3, created_at=$4, is_public=$5""",
                platform, username_lc, did, created_at, is_public,
            )

    async def get_handle(self, platform: str, username_lc: str) -> Optional[dict]:
        """Return {did, created_at, is_public} for this platform/username, or None."""
        if self._use_mem:
            for h in self._mem_handles:
                if h["platform"] == platform and h["username_lc"] == username_lc:
                    return {"did": h["did"], "created_at": h["created_at"],
                            "is_public": h.get("is_public", False)}
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT did, created_at, is_public FROM platform_handles WHERE platform=$1 AND username_lc=$2",
                platform, username_lc,
            )
            return dict(row) if row else None

    async def list_handles_for_did(self, did: str) -> list[dict]:
        """Return [{platform, username_lc, created_at, is_public}] for this DID."""
        if self._use_mem:
            return [{"platform": h["platform"], "username_lc": h["username_lc"],
                     "created_at": h["created_at"], "is_public": h.get("is_public", False)}
                    for h in self._mem_handles if h["did"] == did]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT platform, username_lc, created_at, is_public FROM platform_handles WHERE did=$1 ORDER BY created_at",
                did,
            )
            return [dict(r) for r in rows]

    async def set_handle_visibility(self, platform: str, username_lc: str, did: str,
                                    is_public: bool) -> bool:
        """Flip a handle's public visibility. Only the owning DID can change it.
        Returns True if a row was updated."""
        if self._use_mem:
            for h in self._mem_handles:
                if (h["platform"] == platform and h["username_lc"] == username_lc
                        and h["did"] == did):
                    h["is_public"] = is_public
                    return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE platform_handles SET is_public=$4 WHERE platform=$1 AND username_lc=$2 AND did=$3",
                platform, username_lc, did, is_public,
            )
            return result != "UPDATE 0"

    async def delete_handle(self, platform: str, username_lc: str, did: str) -> bool:
        """Delete handle only if it belongs to this DID. Returns True if deleted."""
        if self._use_mem:
            before = len(self._mem_handles)
            self._mem_handles = [h for h in self._mem_handles
                                 if not (h["platform"] == platform
                                         and h["username_lc"] == username_lc
                                         and h["did"] == did)]
            return len(self._mem_handles) < before
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM platform_handles WHERE platform=$1 AND username_lc=$2 AND did=$3",
                platform, username_lc, did,
            )
            return result != "DELETE 0"

    # ── HDAA: Agent Delegation Tokens ─────────────────────────────────────────

    async def create_agent_delegation(
        self,
        delegation_id: str,
        human_did: str,
        agent_id: str,
        agent_name: Optional[str],
        permissions: list[str],
        token_hash: str,
        issued_at: int,
        expires_at: int,
    ) -> dict:
        """Persist a new delegation token. Returns the stored row."""
        row = {
            "id": delegation_id,
            "human_did": human_did,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "permissions": permissions,
            "token_hash": token_hash,
            "issued_at": issued_at,
            "expires_at": expires_at,
            "last_used_at": None,
            "use_count": 0,
            "revoked": False,
            "revoked_at": None,
        }
        if self._use_mem:
            self._mem_delegations.append(row)
            return dict(row)
        import json as _json
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO agent_delegations
                       (id, human_did, agent_id, agent_name, permissions,
                        token_hash, issued_at, expires_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                delegation_id, human_did, agent_id, agent_name,
                permissions, token_hash, issued_at, expires_at,
            )
        return row

    async def get_delegation_by_token_hash(self, token_hash: str) -> Optional[dict]:
        """Look up a delegation by SHA-256(token). Returns None if not found."""
        if self._use_mem:
            for d in self._mem_delegations:
                if d["token_hash"] == token_hash:
                    return dict(d)
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM agent_delegations WHERE token_hash=$1",
                token_hash,
            )
            return dict(row) if row else None

    async def list_delegations(self, human_did: str) -> list[dict]:
        """Return all delegations for a DID (including revoked, for audit)."""
        if self._use_mem:
            return [dict(d) for d in self._mem_delegations if d["human_did"] == human_did]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, agent_id, agent_name, permissions, issued_at, expires_at,
                          last_used_at, use_count, revoked, revoked_at
                   FROM agent_delegations WHERE human_did=$1 ORDER BY issued_at DESC""",
                human_did,
            )
            return [dict(r) for r in rows]

    async def revoke_delegation(self, delegation_id: str, human_did: str) -> bool:
        """Revoke a delegation by id, only if it belongs to human_did. Returns True if revoked."""
        now = int(time.time())
        if self._use_mem:
            for d in self._mem_delegations:
                if d["id"] == delegation_id and d["human_did"] == human_did and not d["revoked"]:
                    d["revoked"] = True
                    d["revoked_at"] = now
                    return True
            return False
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE agent_delegations SET revoked=TRUE, revoked_at=$1
                   WHERE id=$2 AND human_did=$3 AND revoked=FALSE""",
                now, delegation_id, human_did,
            )
            return result != "UPDATE 0"

    async def record_delegation_use(self, delegation_id: str) -> None:
        """Update last_used_at and increment use_count (best-effort, no raise on miss)."""
        now = int(time.time())
        if self._use_mem:
            for d in self._mem_delegations:
                if d["id"] == delegation_id:
                    d["last_used_at"] = now
                    d["use_count"] = d.get("use_count", 0) + 1
                    break
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """UPDATE agent_delegations
                   SET last_used_at=$1, use_count=use_count+1
                   WHERE id=$2""",
                now, delegation_id,
            )
