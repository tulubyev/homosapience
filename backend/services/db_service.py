"""
DatabaseService — хранилище bond-запросов.

В production: asyncpg + PostgreSQL (DATABASE_URL env).
В dev:        in-memory dict (fallback, если DATABASE_URL не задан).
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Optional

try:
    import asyncpg
    _HAS_ASYNCPG = True
except ImportError:
    _HAS_ASYNCPG = False

DATABASE_URL = os.getenv("DATABASE_URL", "")

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
    gold_member      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_cred_valid ON human_credentials (valid_until, revoked);

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
    country_band   TEXT                   -- ISO-3166-1 alpha-2 or NULL
);
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

-- Verification outcome log — counts of successful / failed verifications (zero-PII)
CREATE TABLE IF NOT EXISTS verification_log (
    id      BIGSERIAL PRIMARY KEY,
    ts      BIGINT  NOT NULL,
    passed  BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verif_log_ts ON verification_log (ts);
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
        self._api_key_seq: int = 0                       # R1: in-memory id sequence
        self._mem_domains: dict[int, dict] = {}          # R1-D1: id → verification row
        self._domain_seq: int = 0                         # R1-D1: in-memory id sequence
        self._mem_alerts: list[dict] = []         # R1-D4: in-memory alert log
        self._alert_seq: int = 0                   # R1-D4: in-memory id sequence
        self._mem_owner_plans: dict[str, dict] = {}   # R1-E: owner_did → plan row
        self._mem_data_requests: list[dict] = []       # R6.3: data-access requests
        self._dar_seq: int = 0                          # R6.3: in-memory id sequence
        self._mem_verifications: list[dict] = []        # verification outcome log {ts, passed}
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
            where = []
            if active_only:
                where.append("active = TRUE")
            if role:
                where.append(f"role = '{role}'")
            clause = ("WHERE " + " AND ".join(where)) if where else ""
            rows = await conn.fetch(
                f"SELECT * FROM admin_dids {clause} ORDER BY added_at DESC"
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
    ) -> dict:
        now = int(time.time())
        vuntil = valid_until or (now + 30 * 86400)
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
        }
        if self._use_mem:
            self._mem_credentials[did] = record
            return record
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO human_credentials
                    (did, did_hash, expression_proof, bond_count, trust_score,
                     trust_label, tx_hash, issued_at, valid_until, revoked, gold_member)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10)
                ON CONFLICT (did) DO UPDATE SET
                    bond_count=EXCLUDED.bond_count,
                    trust_score=EXCLUDED.trust_score,
                    trust_label=EXCLUDED.trust_label,
                    tx_hash=EXCLUDED.tx_hash,
                    valid_until=EXCLUDED.valid_until,
                    gold_member=EXCLUDED.gold_member
                """,
                did, did_hash, expression_proof, bond_count, trust_score,
                trust_label, tx_hash, now, vuntil, gold_member,
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
            where = []
            if only_valid:
                where.append(f"valid_until > {now} AND revoked = FALSE")
            if gold_only:
                where.append("gold_member = TRUE")
            clause = ("WHERE " + " AND ".join(where)) if where else ""
            rows = await conn.fetch(
                f"SELECT * FROM human_credentials {clause} ORDER BY issued_at DESC LIMIT $1",
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
                        signals, outcome, country_band)
                   VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)""",
                now, api_key, session_hash, risk_score, classification,
                _json.dumps(signals), outcome, country_band,
            )

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
            where = "WHERE ts >= $1"
            params: list = [since]
            if api_key is not None:
                where += " AND api_key = $2"
                params.append(api_key)

            row = await conn.fetchrow(
                f"""SELECT
                    COUNT(*)                                                AS sessions,
                    COUNT(*) FILTER (WHERE classification = 'human')       AS humans,
                    COUNT(*) FILTER (WHERE classification = 'bot')         AS bots,
                    COUNT(*) FILTER (WHERE classification = 'ai_agent')    AS ai_agents,
                    COUNT(*) FILTER (WHERE classification = 'suspicious')  AS suspicious,
                    COUNT(*) FILTER (WHERE outcome = 'blocked')            AS blocked
                FROM risk_events {where}""",
                *params,
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
            where = "WHERE ts >= $1"
            params: list = [since]
            if api_key is not None:
                where += " AND api_key = $2"
                params.append(api_key)

            rows = await conn.fetch(
                f"""SELECT
                    to_char(to_timestamp(ts), 'YYYY-MM-DD')                AS day,
                    COUNT(*)                                                AS sessions,
                    COUNT(*) FILTER (WHERE classification = 'human')       AS humans,
                    COUNT(*) FILTER (WHERE classification = 'bot')         AS bots,
                    COUNT(*) FILTER (WHERE classification = 'ai_agent')    AS ai_agents,
                    COUNT(*) FILTER (WHERE classification = 'suspicious')  AS suspicious,
                    COUNT(*) FILTER (WHERE outcome = 'blocked')            AS blocked
                FROM risk_events {where}
                GROUP BY day ORDER BY day DESC LIMIT {days}""",
                *params,
            )
            return [dict(r) for r in rows]

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
        sql = "SELECT * FROM data_access_requests"
        params: list = []
        if status:
            sql += " WHERE status=$1"; params.append(status)
        sql += f" ORDER BY created_at DESC LIMIT ${len(params)+1}"; params.append(limit)
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)
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
        conditions: list[str] = []
        params: list = []
        p = 1
        if level is not None:
            conditions.append(f"level=${p}"); params.append(level); p += 1
        if severity:
            conditions.append(f"severity=${p}"); params.append(severity); p += 1
        if status:
            conditions.append(f"status=${p}"); params.append(status); p += 1
        if owner_did_filter:
            conditions.append(f"owner_did ILIKE ${p}")
            params.append(f"%{owner_did_filter}%"); p += 1
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        params.append(limit)
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT * FROM alert_events {where} ORDER BY ts DESC LIMIT ${p}",
                *params,
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
