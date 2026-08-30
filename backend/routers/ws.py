# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
/ws — WebSocket-соединения для P2P HSI Bond уведомлений.

GET /ws/{did_hash}        — основной канал для поручителей и запрашивающих
GET /ws/bond/{request_id} — канал анонимного чата в рамках конкретного bond

Протокол сообщений (JSON):
  Входящие (клиент → сервер):
    {"type": "bond:approve",  "request_id": "...", "did": "did:key:..."}
    {"type": "bond:reject",   "request_id": "...", "did": "did:key:..."}
    {"type": "bond:chat",     "request_id": "...", "text": "...", "role": "guarantor"}
    {"type": "ping"}

  Исходящие (сервер → клиент):
    {"type": "bond:request",  "request_id": "...", "requester": "short_hash", "confidence_badge": "⭐ high"}
    {"type": "bond:approved", "request_id": "...", "approvals": 2}
    {"type": "bond:rejected", "request_id": "...", "approvals": 1}
    {"type": "bond:retry",    "request_id": "...", "retry_num": 1}
    {"type": "bond:complete", "request_id": "...", "tx_hash": "0x..."}
    {"type": "bond:chat",     "request_id": "...", "from": "requester", "text": "..."}
    {"type": "pong"}
    {"type": "error",         "message": "..."}
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request

router = APIRouter()


@router.websocket("/{did_hash}")
async def ws_endpoint(websocket: WebSocket, did_hash: str, request: Request = None):
    """
    Основной WebSocket канал DID.
    did_hash — первые 16+ символов SHA3-256(did), анонимный идентификатор.

    После подключения:
      - Поручители получают push «bond:request» при новых запросах
      - Запрашивающие получают «bond:approved/complete» при одобрениях
      - Обе стороны могут обмениваться анонимными сообщениями «bond:chat»
    """
    app = websocket.app
    ws_manager = app.state.ws_manager
    db = app.state.db
    aptos = app.state.aptos

    await ws_manager.connect(websocket, did_hash)
    try:
        while True:
            raw = await websocket.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text('{"type":"error","message":"invalid JSON"}')
                continue

            msg_type = msg.get("type", "")

            # ── Keepalive ──────────────────────────────────────────────────────
            if msg_type == "ping":
                await websocket.send_text('{"type":"pong"}')
                continue

            # ── Одобрить bond через WS ─────────────────────────────────────────
            if msg_type == "bond:approve":
                request_id = msg.get("request_id", "")
                approver_did = msg.get("did", "")
                if not request_id or not approver_did:
                    await websocket.send_text(
                        '{"type":"error","message":"request_id and did required"}'
                    )
                    continue

                bond_req = await db.get_bond_request(request_id)
                if not bond_req or bond_req["status"] != "pending":
                    await websocket.send_text(
                        f'{{"type":"error","message":"request {request_id} not found or not pending"}}'
                    )
                    continue

                if approver_did == bond_req["requester_did"]:
                    await websocket.send_text(
                        '{"type":"error","message":"cannot vouch for yourself"}'
                    )
                    continue

                approvals = await db.add_approval(request_id, approver_did)
                n = len(approvals)

                # Уведомить запрашивающего
                from services.did_key import did_hash as _did_hash
                requester_hash = _did_hash(bond_req["requester_did"])[:16]
                await ws_manager.notify_bond_update(
                    requester_hash, request_id, "approved", approvals=n
                )

                if n >= 3:
                    # Выдать credential
                    from routers.bond import _issue_credential, _calculate_trust_score
                    tx_hash = await _issue_credential(aptos, bond_req, approvals)
                    await db.update_bond_status(request_id, "approved", tx_hash=tx_hash)

                    new_score = _calculate_trust_score(n)
                    await aptos.update_trust_score(
                        address=bond_req["requester_did"],
                        new_score=new_score,
                        bond_sponsors=[_did_hash(d)[:12] for d in approvals],
                    )
                    await ws_manager.notify_bond_update(
                        requester_hash, request_id, "complete",
                        approvals=n, tx_hash=tx_hash
                    )
                    await websocket.send_text(json.dumps({
                        "type": "bond:vouch_done",
                        "request_id": request_id,
                        "approvals": n,
                        "tx_hash": tx_hash,
                    }))
                else:
                    await websocket.send_text(json.dumps({
                        "type": "bond:vouch_recorded",
                        "request_id": request_id,
                        "approvals": n,
                        "needed": 3 - n,
                    }))
                continue

            # ── Отклонить bond через WS ────────────────────────────────────────
            if msg_type == "bond:reject":
                request_id = msg.get("request_id", "")
                rejecter_did = msg.get("did", "")
                if not request_id:
                    await websocket.send_text('{"type":"error","message":"request_id required"}')
                    continue

                bond_req = await db.get_bond_request(request_id)
                if not bond_req:
                    continue

                # Записываем отказ и проверяем нужен ли retry
                needs_retry = await db.record_rejection(request_id, rejecter_did)

                from services.did_key import did_hash as _did_hash
                requester_hash = _did_hash(bond_req["requester_did"])[:16]

                if needs_retry:
                    retry_num = bond_req.get("retry_count", 0) + 1
                    await ws_manager.notify_bond_update(
                        requester_hash, request_id, "retry", retry_num=retry_num
                    )

                await websocket.send_text(json.dumps({
                    "type": "bond:reject_recorded",
                    "request_id": request_id,
                }))
                continue

            # ── Анонимный чат в рамках bond ────────────────────────────────────
            if msg_type == "bond:chat":
                request_id = msg.get("request_id", "")
                text = str(msg.get("text", ""))[:500]
                role = msg.get("role", "unknown")  # "requester" | "guarantor"

                if not request_id or not text:
                    continue

                bond_req = await db.get_bond_request(request_id)
                if not bond_req:
                    continue

                from services.did_key import did_hash as _did_hash

                # Определяем получателя по роли отправителя
                if role == "requester":
                    # Сообщение от запрашивающего → всем активным поручителям
                    approvals = bond_req.get("approvals", [])
                    for approver_did in approvals:
                        target_hash = _did_hash(approver_did)[:16]
                        await ws_manager.send_bond_chat(
                            target_hash, request_id, "requester", text
                        )
                elif role == "guarantor":
                    # Сообщение от поручителя → запрашивающему
                    requester_hash = _did_hash(bond_req["requester_did"])[:16]
                    await ws_manager.send_bond_chat(
                        requester_hash, request_id, "guarantor", text
                    )

                await websocket.send_text(json.dumps({
                    "type": "bond:chat_sent",
                    "request_id": request_id,
                }))
                continue

            # ── Неизвестный тип ────────────────────────────────────────────────
            await websocket.send_text(
                f'{{"type":"error","message":"unknown type: {msg_type}"}}'
            )

    except WebSocketDisconnect:
        ws_manager.disconnect(did_hash)
    except Exception as e:
        ws_manager.disconnect(did_hash)
        try:
            await websocket.close(1011)
        except Exception:
            pass


@router.websocket("/gold-panel")
async def ws_gold_panel(websocket: WebSocket):
    """
    Dedicated WebSocket channel for Gold Member Bond Panel.

    Protocol:
      1. Client connects → server accepts
      2. Client sends:  {"type":"auth","did":"did:key:z6Mk..."}
      3. Server replies: {"type":"bond:queue","requests":[...]} + {"type":"auth_ok"}
      4. Server pushes: {"type":"bond:request","request":{...}} when new requests arrive
      5. Client may send: {"type":"ping"} → {"type":"pong"}

    No polling needed — server pushes new requests in real time.
    If no guarantors are online, requests accumulate in DB and are delivered on next connect.
    """
    app = websocket.app
    ws_manager = app.state.ws_manager
    db = app.state.db

    await websocket.accept()
    approver_did: str = ""

    try:
        # ── Auth (must arrive within 15 seconds) ──────────────────────────────
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
        except asyncio.TimeoutError:
            await websocket.send_text('{"type":"error","message":"auth timeout"}')
            return

        msg = json.loads(raw)
        if msg.get("type") != "auth":
            await websocket.send_text('{"type":"error","message":"first message must be auth"}')
            return

        approver_did = msg.get("did", "").strip()
        if not approver_did:
            await websocket.send_text('{"type":"error","message":"did required in auth"}')
            return

        # ── Verify Gold Member or Admin ────────────────────────────────────────
        gold_rows  = await db.get_admin_dids(role="gold_member", active_only=True)
        admin_rows = await db.get_admin_dids(role="admin",       active_only=True)
        all_rows   = gold_rows + admin_rows
        authorized = {r.get("did_full") for r in all_rows if r.get("did_full")} | \
                     {r.get("did_short") for r in all_rows if r.get("did_short")}

        if approver_did not in authorized:
            await websocket.send_text('{"type":"error","message":"not authorized — gold member required"}')
            return

        # ── Register & deliver queued requests ────────────────────────────────
        await ws_manager.connect_panel(approver_did, websocket)

        from routers.bond import BOND_THRESHOLD
        pending = await db.get_pending_for_guarantor(approver_did)
        await websocket.send_text(json.dumps({
            "type": "bond:queue",
            "requests": [
                {
                    "id":              r["id"],
                    "requester_did":   r["requester_did"],
                    "confidence":      round(r.get("confidence", 0), 2),
                    "message":         r.get("message"),
                    "created_at":      r.get("created_at"),
                    "approvals_count": r.get("approvals_count", 0),
                    "needed":          max(0, BOND_THRESHOLD - r.get("approvals_count", 0)),
                }
                for r in pending
            ],
            "total": len(pending),
        }))
        await websocket.send_text(
            f'{{"type":"auth_ok","queue_sent":{len(pending)}}}'
        )

        # ── Keep-alive loop (server pushes arrive via ws_manager) ────────────
        while True:
            raw = await websocket.receive_text()
            try:
                m = json.loads(raw)
                if m.get("type") == "ping":
                    await websocket.send_text('{"type":"pong"}')
            except Exception:
                pass

    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(1011)
        except Exception:
            pass
    finally:
        if approver_did:
            ws_manager.disconnect_panel(approver_did)
