# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
chat.py — /api/chat
Защищённый чат только для верифицированных людей HSI.

Endpoints:
  GET  /messages?room=agora&limit=50  — последние сообщения
  POST /messages                      — отправить сообщение
  POST /react                         — добавить/убрать реакцию
  GET  /rooms                         — список каналов
  WS   /ws/{room}                     — real-time подписка

Хранение: PostgreSQL (asyncpg pool из app.state.db._pool).
AI-модерация: базовый regex-фильтр спама.
Rate-limit: MAX_MSG_PER_MINUTE сообщений/минуту с одного sender_short.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from collections import defaultdict
from typing import Optional

import asyncio
import concurrent.futures

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

# ── VAPID / Web Push config ──────────────────────────────────────────────────
_VAPID_PRIVATE_KEY: str = os.getenv("VAPID_PRIVATE_KEY", "").replace("\\n", "\n")
_VAPID_PUBLIC_KEY:  str = os.getenv("VAPID_PUBLIC_KEY",  "")
_VAPID_EMAIL:       str = os.getenv("VAPID_EMAIL", "admin@aptogon.com")
_PUSH_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4)

# ── File upload config ───────────────────────────────────────────────────────
_UPLOAD_DIR      = os.path.join(os.path.dirname(__file__), '..', 'uploads')
_UPLOAD_MAX_BYTES = 10 * 1024 * 1024   # 10 MB
_FILE_LIFETIME_S  = 5 * 24 * 3600      # 5 days in seconds
_FILE_WARN_BEFORE = 1 * 24 * 3600      # warn 24 h before expiry

router = APIRouter()

# ── Admin cache (DB-backed, refreshed every 60s) ────────────────────────────
# Bootstrap fallback from env (used before DB is ready / in dev mode)
_env_admin_dids: set[str] = {
    d.strip() for d in
    os.getenv("ADMIN_DIDS", os.getenv("CREATOR_SENDER_SHORT", "")).split(",")
    if d.strip()
}
_admin_cache: set[str] = set(_env_admin_dids)
_admin_cache_ts: float = 0.0
_ADMIN_CACHE_TTL = 60.0   # seconds

# Trust cache: did_short → (trust_score, trust_label, cached_at)
# Prevents clients from spoofing trust_score/trust_label in message bodies.
_trust_cache: dict[str, tuple[float, str, float]] = {}
_TRUST_CACHE_TTL = 300.0  # 5 minutes

ADMIN_AVATAR_URL:    str = "/avatar-alex.jpg"
ADMIN_DISPLAY_NAME: str = os.getenv("ADMIN_DISPLAY_NAME", "Alexander T.")


async def _refresh_admin_cache(db) -> None:
    """Reload admin DID shorts from DB (TTL-cached)."""
    global _admin_cache, _admin_cache_ts
    now = time.time()
    if now - _admin_cache_ts < _ADMIN_CACHE_TTL:
        return
    try:
        rows = await db.get_admin_dids(active_only=True)
        _admin_cache = {r["did_short"] for r in rows}
        _admin_cache_ts = now
    except Exception:
        pass  # keep stale cache


def _is_admin(sender_short: str) -> bool:
    return bool(sender_short and sender_short in _admin_cache)


async def _get_trust(db, sender_short: str) -> tuple[float, str]:
    """
    Return (trust_score, trust_label) from DB — never from client input.
    TTL-cached for _TRUST_CACHE_TTL seconds to avoid a DB hit per message.
    Admins always get trust_score=1.0 / trust_label='trusted'.
    """
    if _is_admin(sender_short):
        return 1.0, "trusted"
    cached = _trust_cache.get(sender_short)
    if cached and (time.time() - cached[2]) < _TRUST_CACHE_TTL:
        return cached[0], cached[1]
    try:
        cred = await db.get_credential_by_short(sender_short)
        if cred:
            score = float(cred.get("trust_score", 0.1))
            label = str(cred.get("trust_label", "newcomer"))
        else:
            score, label = 0.1, "newcomer"
    except Exception:
        score, label = 0.1, "newcomer"
    _trust_cache[sender_short] = (score, label, time.time())
    return score, label


# In-memory: WebSocket connections + reactions cache + rate-limit
_connections: dict[str, list[WebSocket]] = defaultdict(list)
_rate_limit:  dict[str, list[float]]     = defaultdict(list)
_reactions:   dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

MAX_MSG_PER_MINUTE  = 20
MAX_STORED_PER_ROOM = 200

# ── Rooms config ──────────────────────────────────────────────────────────────
ROOMS = [
    {"id": "agora",      "icon": "🌍", "label": "Agora",      "desc": "General channel"},
    {"id": "tech",       "icon": "⚡", "label": "Technology", "desc": "Web3 · Aptos · DID"},
    {"id": "governance", "icon": "🗳️", "label": "Governance", "desc": "HSI Voting"},
    {"id": "philosophy", "icon": "🧠", "label": "Philosophy", "desc": "Manifesto · ideas"},
]

# ── Spam patterns ─────────────────────────────────────────────────────────────
_SPAM_PATTERNS = [
    r"buy\s+crypto",
    r"free\s+token",
    r"click\s+here",
    r"investment\s+opportunit",
    r"\d{3,}%\s*apy",
    r"guaranteed\s+earn",
    r"limited\s+offer",
]
_SPAM_RE = re.compile("|".join(_SPAM_PATTERNS), re.IGNORECASE)


def _is_spam(text: str, sender_short: str) -> bool:
    if _is_admin(sender_short):
        return False
    return bool(_SPAM_RE.search(text))


def _check_rate_limit(sender_short: str) -> bool:
    if _is_admin(sender_short):
        return True
    now = time.time()
    times = _rate_limit[sender_short]
    times[:] = [t for t in times if now - t < 60]
    if len(times) >= MAX_MSG_PER_MINUTE:
        return False
    times.append(now)
    return True


def _build_msg(
    content: str,
    room: str,
    sender_short: str,
    trust_label: str = "newcomer",
    trust_score: float = 0.1,
    reply_to: Optional[dict] = None,
    is_system: bool = False,
) -> dict:
    admin = _is_admin(sender_short)
    return {
        "id":            str(uuid.uuid4()),
        "sender_short":  sender_short,
        "content":       content,
        "room":          room,
        "timestamp":     int(time.time()),
        "trust_label":   trust_label,
        "trust_score":   trust_score,
        "reactions":     {},
        "is_system":     is_system,
        "is_creator":    admin,
        "display_name":  ADMIN_DISPLAY_NAME if admin else None,
        "avatar_url":    ADMIN_AVATAR_URL    if admin else None,
        "reply_to":      reply_to,
    }


def _row_to_msg(row: dict) -> dict:
    """Convert asyncpg Row / dict to API-safe message dict."""
    msg = dict(row)
    # asyncpg returns JSONB as Python objects already; handle both cases
    if isinstance(msg.get("reactions"), str):
        try:
            msg["reactions"] = json.loads(msg["reactions"])
        except Exception:
            msg["reactions"] = {}
    elif msg.get("reactions") is None:
        msg["reactions"] = {}

    if isinstance(msg.get("reply_to"), str):
        try:
            msg["reply_to"] = json.loads(msg["reply_to"])
        except Exception:
            msg["reply_to"] = None

    # Merge live reactions cache
    live = _reactions.get(msg["id"])
    if live:
        msg["reactions"] = {k: list(v) for k, v in live.items()}

    return msg


def _get_pool(request: Request):
    """Return asyncpg pool from app state (None if in-memory fallback)."""
    db = getattr(request.app.state, "db", None)
    return getattr(db, "_pool", None) if db else None


async def _broadcast(room: str, payload: dict) -> None:
    dead = []
    for ws in list(_connections[room]):
        try:
            await ws.send_text(json.dumps(payload, ensure_ascii=False, default=str))
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            _connections[room].remove(ws)
        except ValueError:
            pass


async def _send_web_push(db, did_short: str, title: str, body: str, url: str = "/chat") -> None:
    """
    Send a Web Push notification to all subscriptions of did_short.
    Silently cleans up expired/invalid subscriptions (HTTP 410).
    """
    if not _VAPID_PRIVATE_KEY or not db:
        return
    subs = await db.get_push_subscriptions(did_short)
    if not subs:
        return

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return  # pywebpush not installed yet

    payload_str = json.dumps({"title": title, "body": body, "url": url})
    loop = asyncio.get_event_loop()

    async def _push_one(sub: dict) -> None:
        def _do():
            return webpush(
                subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                data=payload_str,
                vapid_private_key=_VAPID_PRIVATE_KEY,
                vapid_claims={"sub": f"mailto:{_VAPID_EMAIL}"},
            )
        try:
            await loop.run_in_executor(_PUSH_EXECUTOR, _do)
        except Exception as exc:
            # 410 Gone / 404 = subscription expired — remove it
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                await db.delete_push_subscription(did_short, sub["endpoint"])

    await asyncio.gather(*[_push_one(s) for s in subs], return_exceptions=True)


async def _broadcast_all(payload: dict) -> None:
    """Push to every connected WS (for system events: room_created, room_deleted)."""
    for conns in list(_connections.values()):
        for ws in list(conns):
            try:
                await ws.send_text(json.dumps(payload, ensure_ascii=False, default=str))
            except Exception:
                pass


def _dm_room(a: str, b: str) -> str:
    """Deterministic DM room ID from two 8-char DID shorts (alphabetically sorted)."""
    return "dm_" + "_".join(sorted([a, b]))


# ── Schemas ───────────────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    content:      str
    room:         str            = "agora"
    sender_short: str            = "anonymous"
    trust_label:  str            = "newcomer"
    trust_score:  float          = Field(0.1, ge=0.0, le=1.0)
    reply_to:     Optional[dict] = None


class ReactRequest(BaseModel):
    message_id:   str
    emoji:        str
    sender_short: str = "guest"


class DMCreate(BaseModel):
    to_short:     str
    sender_short: str
    content:      str
    trust_label:  str   = "newcomer"
    trust_score:  float = Field(0.1, ge=0.0, le=1.0)


class RoomCreate(BaseModel):
    name:         str
    icon:         str   = "💬"
    description:  str   = ""
    access_level: str   = "public"   # public | verified | gold_only
    sender_short: str   = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/rooms")
async def list_rooms(request: Request):
    """Static system rooms + custom DB rooms."""
    db = getattr(request.app.state, "db", None)
    custom = []
    if db:
        try:
            rows = await db.list_custom_rooms(active_only=True)
            custom = [
                {
                    "id":           r["id"],
                    "icon":         r["icon"],
                    "label":        r["name"],
                    "desc":         r.get("description", ""),
                    "access_level": r.get("access_level", "public"),
                    "created_by":   r.get("created_by"),
                    "custom":       True,
                }
                for r in rows
            ]
        except Exception:
            pass
    return [*ROOMS, *custom]


@router.post("/rooms")
async def create_room(body: RoomCreate, request: Request):
    """Create a custom room. Any verified user can create; access_level restricts readers."""
    if not body.name.strip() or len(body.name.strip()) < 2:
        raise HTTPException(400, "Room name must be at least 2 characters")
    db = request.app.state.db
    slug = re.sub(r"[^a-z0-9]", "_", body.name.strip().lower())[:20].strip("_")
    room_id = f"room_{slug}"
    existing = await db.list_custom_rooms()
    if any(r["id"] == room_id for r in existing):
        room_id = f"{room_id}_{int(time.time()) % 10000}"
    access = body.access_level if body.access_level in ("public", "verified", "gold_only") else "public"
    room = await db.create_room(
        id=room_id,
        name=body.name.strip()[:40],
        icon=(body.icon or "💬")[:4],
        description=(body.description or "")[:200],
        access_level=access,
        created_by=body.sender_short,
    )
    result = {
        "id":           room["id"],
        "icon":         room["icon"],
        "label":        room["name"],
        "desc":         room.get("description", ""),
        "access_level": room.get("access_level", "public"),
        "created_by":   room.get("created_by"),
        "custom":       True,
    }
    await _broadcast_all({"type": "room_created", "room": result})
    return result


@router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, request: Request, sender_short: str = ""):
    """Delete a custom room. Admin or creator only."""
    system_ids = {r["id"] for r in ROOMS}
    if room_id in system_ids:
        raise HTTPException(403, "Cannot delete system rooms")
    await _refresh_admin_cache(request.app.state.db)
    db = request.app.state.db
    rooms = await db.list_custom_rooms()
    room = next((r for r in rooms if r["id"] == room_id), None)
    if not room:
        raise HTTPException(404, "Room not found")
    if not _is_admin(sender_short) and room.get("created_by") != sender_short:
        raise HTTPException(403, "Admin or room creator required")
    await db.delete_room(room_id)
    await _broadcast_all({"type": "room_deleted", "room_id": room_id})
    return {"status": "deleted", "room_id": room_id}


@router.post("/dm")
async def send_dm(body: DMCreate, request: Request):
    """Send a direct message. Uses a deterministic room derived from both DID shorts."""
    if not body.to_short or not body.sender_short or not body.content.strip():
        raise HTTPException(400, "to_short, sender_short and content required")
    if not _check_rate_limit(body.sender_short):
        raise HTTPException(429, "Rate limit exceeded")

    # ── Behavioral analysis ───────────────────────────────────────────────────
    beh = getattr(request.app.state, "behavior", None)
    if beh and not _is_admin(body.sender_short):
        client_ip = (
            request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.headers.get("X-Real-IP", "")
            or (request.client.host if request.client else "")
        )
        beh_result = await beh.record_message(
            did_short=body.sender_short,
            content=body.content,
            ip=client_ip,
            room="dm",
        )
        if beh_result.is_blocked:
            raise HTTPException(
                status_code=429,
                detail={
                    "error":    "behavior_blocked",
                    "level":    beh_result.level,
                    "reason":   beh_result.reason,
                    "reverify": beh_result.needs_reverify,
                    "message":  "Suspicious activity detected. Please re-verify your humanity.",
                },
            )
    db = getattr(request.app.state, "db", None)
    trust_score, trust_label = await _get_trust(db, body.sender_short)
    room = _dm_room(body.sender_short, body.to_short)
    msg  = _build_msg(body.content.strip(), room, body.sender_short,
                      trust_label, trust_score)
    pool = _get_pool(request)
    if pool:
        await _save_msg(pool, msg)
    await _broadcast(room, msg)
    # In-app notify (WS) + Web Push (works when tab is closed)
    await _broadcast(f"notify_{body.to_short}", {
        "type":    "dm_notification",
        "from":    body.sender_short,
        "dm_room": room,
        "preview": body.content[:80],
    })
    asyncio.create_task(_send_web_push(
        db, body.to_short,
        title=f"💬 Сообщение от …{body.sender_short}",
        body=body.content[:100],
        url="/chat",
    ))
    return msg


@router.get("/dm/partners")
async def dm_partners(request: Request, me: str = ""):
    """Recent DM partners for a user (derived from dm_ room history in chat_messages)."""
    if not me or len(me) != 8:
        return []
    pool = _get_pool(request)
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT room,
                   MAX(timestamp) AS last_ts,
                   (SELECT content FROM chat_messages c2
                    WHERE c2.room = cm.room ORDER BY c2.timestamp DESC LIMIT 1) AS preview
            FROM chat_messages cm
            WHERE room LIKE 'dm\\_%' ESCAPE '\\' AND room LIKE $1
            GROUP BY room
            ORDER BY last_ts DESC
            LIMIT 30
            """,
            f"%{me}%",
        )
    result = []
    for row in rows:
        rid = row["room"]         # dm_{short1}_{short2}
        suffix = rid[3:]          # {short1}_{short2}
        if len(suffix) != 17:     # 8 + '_' + 8
            continue
        s1, s2 = suffix[:8], suffix[9:]
        partner = s2 if s1 == me else s1
        result.append({
            "short":   partner,
            "dm_room": rid,
            "last_ts": row["last_ts"],
            "preview": (row["preview"] or "")[:60],
        })
    return result


@router.get("/messages")
async def get_messages(request: Request, room: str = "agora", limit: int = 50):
    pool = _get_pool(request)
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM chat_messages
            WHERE room = $1
            ORDER BY timestamp ASC
            LIMIT $2
            """,
            room, limit,
        )
    return [_row_to_msg(dict(r)) for r in rows]


@router.post("/messages")
async def post_message(body: MessageCreate, request: Request):
    await _refresh_admin_cache(request.app.state.db)
    if not _check_rate_limit(body.sender_short):
        raise HTTPException(status_code=429, detail="Rate limit exceeded (20 msg/min)")

    # ── Behavioral analysis ───────────────────────────────────────────────────
    beh = getattr(request.app.state, "behavior", None)
    if beh and not _is_admin(body.sender_short):
        client_ip = (
            request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.headers.get("X-Real-IP", "")
            or (request.client.host if request.client else "")
        )
        beh_result = await beh.record_message(
            did_short=body.sender_short,
            content=body.content,
            ip=client_ip,
            room=body.room,
        )
        if beh_result.is_blocked:
            raise HTTPException(
                status_code=429,
                detail={
                    "error":        "behavior_blocked",
                    "level":        beh_result.level,
                    "reason":       beh_result.reason,
                    "reverify":     beh_result.needs_reverify,
                    "message":      "Suspicious activity detected. Please re-verify your humanity.",
                },
            )

    if _is_spam(body.content, body.sender_short):
        warn = _build_msg(
            content=f"🛡️ Moderator blocked message from {body.sender_short}: spam/advertising.",
            room=body.room,
            sender_short="system",
            is_system=True,
        )
        pool = _get_pool(request)
        if pool:
            await _save_msg(pool, warn)
        await _broadcast(body.room, warn)
        raise HTTPException(status_code=400, detail="Message blocked by AI moderation")

    db = getattr(request.app.state, "db", None)
    trust_score, trust_label = await _get_trust(db, body.sender_short)
    msg = _build_msg(
        content=      body.content,
        room=         body.room,
        sender_short= body.sender_short,
        trust_label=  trust_label,
        trust_score=  trust_score,
        reply_to=     body.reply_to,
    )
    pool = _get_pool(request)
    if pool:
        await _save_msg(pool, msg)
    await _broadcast(body.room, msg)

    # ── @mention notifications ────────────────────────────────────────────────
    mentions = list({m for m in re.findall(r"@([A-Za-z0-9]{8})", body.content)
                     if m != body.sender_short})
    for mentioned in mentions:
        await _broadcast(f"notify_{mentioned}", {
            "type":       "mention",
            "from":       body.sender_short,
            "room":       body.room,
            "message_id": msg["id"],
            "preview":    body.content[:80],
        })
        asyncio.create_task(_send_web_push(
            db, mentioned,
            title=f"📣 @{body.sender_short} упомянул вас в #{body.room}",
            body=body.content[:100],
            url="/chat",
        ))

    return msg


@router.post("/react")
async def react_to_message(body: ReactRequest, request: Request):
    recs = _reactions[body.message_id]
    arr  = recs[body.emoji]
    if body.sender_short in arr:
        arr.remove(body.sender_short)
    else:
        arr.append(body.sender_short)

    pool = _get_pool(request)
    if pool:
        await _save_reactions(pool, body.message_id, recs)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT room FROM chat_messages WHERE id = $1", body.message_id
            )
        if row:
            payload = {
                "type":       "reaction",
                "message_id": body.message_id,
                "reactions":  {k: list(v) for k, v in recs.items()},
            }
            await _broadcast(row["room"], payload)

    return {"message_id": body.message_id, "reactions": {k: list(v) for k, v in recs.items()}}


@router.websocket("/ws/{room}")
async def websocket_chat(websocket: WebSocket, room: str):
    """
    Unified WS endpoint for:
      - Regular rooms:   /ws/agora, /ws/tech, …
      - DM rooms:        /ws/dm_{short1}_{short2}
      - Notify channel:  /ws/notify_{short}  (mentions, DM alerts)
    """
    await websocket.accept()
    _connections[room].append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data.strip() == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            _connections[room].remove(websocket)
        except ValueError:
            pass


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _save_msg(pool, msg: dict) -> None:
    """Persist message to PostgreSQL and trim room to MAX_STORED_PER_ROOM."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO chat_messages
              (id, sender_short, content, room, timestamp, trust_label, trust_score,
               is_system, is_creator, display_name, avatar_url, reply_to, reactions)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (id) DO NOTHING
            """,
            msg["id"],
            msg["sender_short"],
            msg["content"],
            msg["room"],
            msg["timestamp"],
            msg["trust_label"],
            msg["trust_score"],
            msg.get("is_system", False),
            msg.get("is_creator", False),
            msg.get("display_name"),
            msg.get("avatar_url"),
            json.dumps(msg["reply_to"]) if msg.get("reply_to") else None,
            json.dumps(msg.get("reactions", {})),
        )
        # Keep only the newest MAX_STORED_PER_ROOM per room
        await conn.execute(
            """
            DELETE FROM chat_messages
            WHERE room = $1
              AND id NOT IN (
                  SELECT id FROM chat_messages
                  WHERE room = $1
                  ORDER BY timestamp DESC
                  LIMIT $2
              )
            """,
            msg["room"], MAX_STORED_PER_ROOM,
        )


async def _save_reactions(pool, message_id: str, reactions: dict) -> None:
    """Persist updated reactions dict for a message."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE chat_messages SET reactions = $2 WHERE id = $1",
            message_id,
            json.dumps({k: list(v) for k, v in reactions.items()}),
        )


# ── Web Push endpoints ───────────────────────────────────────────────────────

@router.get("/push/vapid-key")
async def get_vapid_key():
    """Return the VAPID public key (base64url) for the browser to subscribe."""
    if not _VAPID_PUBLIC_KEY:
        raise HTTPException(501, "Web Push not configured (VAPID_PUBLIC_KEY missing)")
    return {"public_key": _VAPID_PUBLIC_KEY}


class PushSubscribeBody(BaseModel):
    sender_short: str
    subscription: dict   # {endpoint, keys: {p256dh, auth}}


@router.post("/push/subscribe")
async def push_subscribe(body: PushSubscribeBody, request: Request):
    """Save or update a push subscription for a DID short."""
    if not body.sender_short or not body.subscription.get("endpoint"):
        raise HTTPException(400, "sender_short and subscription required")
    keys = body.subscription.get("keys", {})
    db = getattr(request.app.state, "db", None)
    if db:
        await db.save_push_subscription(
            did_short=body.sender_short,
            endpoint=body.subscription["endpoint"],
            p256dh=keys.get("p256dh", ""),
            auth=keys.get("auth", ""),
        )
    return {"status": "ok"}


@router.delete("/push/subscribe")
async def push_unsubscribe(request: Request, sender_short: str = "", endpoint: str = ""):
    """Remove a push subscription."""
    db = getattr(request.app.state, "db", None)
    if db and sender_short and endpoint:
        await db.delete_push_subscription(sender_short, endpoint)
    return {"status": "ok"}


# ── File upload ──────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(
    file:         UploadFile = File(...),
    room:         str = Form(""),          # chat room where this file is sent
    sender_short: str = Form(""),          # 8-char DID short of uploader
):
    """
    Upload a file (max 10 MB).  Returns {url, name, size, type, expires_at}.
    File stored at backend/uploads/{uuid}{ext}, served as /uploads/{...}.
    A .meta sidecar is written alongside for cleanup/warning tracking.
    """
    content = await file.read()
    if len(content) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large — max 10 MB")

    original_name = file.filename or "file"
    ext  = os.path.splitext(original_name)[1].lower()[:16]
    safe_name = f"{uuid.uuid4().hex}{ext}"

    os.makedirs(_UPLOAD_DIR, exist_ok=True)
    dest = os.path.join(_UPLOAD_DIR, safe_name)
    with open(dest, "wb") as fh:
        fh.write(content)

    # ── sidecar metadata ──────────────────────────────────────────────────────
    uploaded_at = time.time()
    meta = {
        "original_name": original_name,
        "size":          len(content),
        "type":          file.content_type or "application/octet-stream",
        "uploaded_at":   uploaded_at,
        "expires_at":    uploaded_at + _FILE_LIFETIME_S,
        "room":          room,
        "sender_short":  sender_short,
        "safe_name":     safe_name,
    }
    with open(dest + ".meta", "w") as mf:
        json.dump(meta, mf)

    return {
        "url":        f"/uploads/{safe_name}",
        "name":       original_name,
        "size":       len(content),
        "type":       meta["type"],
        "expires_at": int(meta["expires_at"]),
    }


# ── Background file cleanup ──────────────────────────────────────────────────

async def cleanup_old_uploads(app) -> None:
    """
    Runs every 6 h.
    • At (lifetime - 24 h): posts a warning system message to the room.
    • At lifetime (5 days): deletes the file and posts a "deleted" system message.
    """
    import asyncio

    while True:
        await asyncio.sleep(6 * 3600)
        try:
            if not os.path.exists(_UPLOAD_DIR):
                continue

            now = time.time()
            warn_threshold   = now - (_FILE_LIFETIME_S - _FILE_WARN_BEFORE)   # 4 days old
            delete_threshold = now - _FILE_LIFETIME_S                          # 5 days old

            db = getattr(app.state, "db", None)
            pool = getattr(db, "_pool", None) if db else None

            for fname in sorted(os.listdir(_UPLOAD_DIR)):
                if fname.endswith((".meta", ".warned")):
                    continue

                fpath     = os.path.join(_UPLOAD_DIR, fname)
                meta_path = fpath + ".meta"
                warn_path = fpath + ".warned"

                try:
                    mtime = os.path.getmtime(fpath)
                except OSError:
                    continue

                meta_data: dict = {}
                if os.path.exists(meta_path):
                    try:
                        with open(meta_path) as mf:
                            meta_data = json.load(mf)
                    except Exception:
                        pass

                name         = meta_data.get("original_name", fname)
                room_id      = meta_data.get("room", "")
                expires_at   = meta_data.get("expires_at", mtime + _FILE_LIFETIME_S)

                # ── Delete expired files ──────────────────────────────────────
                if mtime < delete_threshold:
                    try:
                        os.unlink(fpath)
                    except OSError:
                        pass
                    for sidecar in (meta_path, warn_path):
                        try:
                            os.unlink(sidecar)
                        except OSError:
                            pass

                    if room_id and pool:
                        msg = _build_msg(
                            content=f"🗑️ Файл «{name}» удалён (хранился 5 дней)",
                            room=room_id, sender_short="system", is_system=True,
                        )
                        try:
                            await _save_msg(pool, msg)
                            await _broadcast(room_id, msg)
                        except Exception:
                            pass
                    continue

                # ── Warn 24 h before expiry ───────────────────────────────────
                if mtime < warn_threshold and not os.path.exists(warn_path):
                    hours_left = max(1, int((expires_at - now) / 3600))
                    if room_id and pool:
                        msg = _build_msg(
                            content=f"⚠️ Файл «{name}» будет удалён через ~{hours_left} ч",
                            room=room_id, sender_short="system", is_system=True,
                        )
                        try:
                            await _save_msg(pool, msg)
                            await _broadcast(room_id, msg)
                        except Exception:
                            pass
                    # Touch .warned so we don't repeat the warning
                    try:
                        open(warn_path, "w").close()
                    except OSError:
                        pass

        except Exception:
            pass   # never crash the loop
