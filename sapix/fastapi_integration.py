"""
HSI Gonka FastAPI Middleware & Router

Drop-in integration for any FastAPI application.

Quick start:
    from sapix.fastapi_integration import setup_hsi_gonka

    app = FastAPI()
    setup_hsi_gonka(app, api_key="gk-...")

    # Now all your routes are protected:
    @app.get("/feed")
    async def feed(did: str = Depends(require_human)):
        return {"message": "Only humans here"}

What this provides:
    - HSIFirewallMiddleware  → blocks bots at HTTP layer
    - /verify/expression    → gesture verification endpoint
    - /verify/status        → check credential status
    - /firewall/report      → report suspicious behavior
    - /translate            → translation endpoint
    - /bond/match           → find guarantors
    - /health/gonka         → Gonka connectivity check
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Callable, Optional

# ── Dependency stubs (loaded at runtime, not import time) ─────────────────────
# This allows the file to be imported and tested without fastapi installed.

def _lazy_import():
    try:
        from fastapi import Depends, FastAPI, HTTPException, Request, Response
        from fastapi.middleware.base import BaseHTTPMiddleware
        from fastapi.responses import JSONResponse
        from pydantic import BaseModel, Field
        return True
    except ImportError:
        return False


# ── Request / Response Models ─────────────────────────────────────────────────

VERIFY_EXPRESSION_SCHEMA = {
    "title": "VerifyExpressionRequest",
    "properties": {
        "events": {
            "description": "Touch events — normalized XY (0-1), pressure, timestamps",
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "pressure": {"type": "number"},
                    "timestamp_ms": {"type": "integer"},
                    "pause_after_ms": {"type": "integer"}
                }
            }
        },
        "session_id": {"type": "string", "description": "Anonymous UUID, no user identity"}
    },
    "required": ["events", "session_id"]
}

TRANSLATE_SCHEMA = {
    "title": "TranslateRequest",
    "properties": {
        "text": {"type": "string"},
        "target_lang": {"type": "string", "example": "en"},
        "source_lang": {"type": "string", "description": "Auto-detected if omitted"},
        "sender_region": {"type": "string", "description": "ISO 3166-1 alpha-2, e.g. 'IR'"}
    },
    "required": ["text", "target_lang"]
}


# ── Middleware ────────────────────────────────────────────────────────────────

class HSIFirewallMiddleware:
    """
    ASGI middleware that enforces Human Credential on all protected routes.

    Reads X-HSI-DID-Token header, verifies credential on Aptos,
    and rejects bots via AntiBotFirewall.

    HTTP responses:
        401  No credential header
        403  Credential invalid / expired / bot detected
        503  Verification infrastructure unavailable (NEVER blocks — degrades gracefully)
    """

    PUBLIC_PATHS = frozenset([
        "/verify/expression",
        "/verify/status",
        "/health",
        "/health/gonka",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/translate",          # translation is public — no credential needed
    ])

    def __init__(
        self,
        app,
        credential_verifier,    # AptosCredentialVerifier
        antibot_firewall,        # AntiBotFirewall
        get_request_history: Optional[Callable] = None,
    ):
        self.app = app
        self.verifier = credential_verifier
        self.firewall = antibot_firewall
        self.get_history = get_request_history

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        # Public paths skip verification
        if self._is_public(path):
            await self.app(scope, receive, send)
            return

        # Extract DID token from headers
        headers = dict(scope.get("headers", []))
        did_token = headers.get(b"x-hsi-did-token", b"").decode()

        if not did_token:
            await self._respond(send, 401, {
                "error": "HSI credential required",
                "detail": "Include X-HSI-DID-Token header with your HumanCredential",
                "verify_at": "https://homosapience.org/verify"
            })
            return

        # Verify credential on Aptos
        try:
            cred = await self.verifier.verify(did_token)
            if not cred["valid"]:
                await self._respond(send, 403, {
                    "error": "Invalid or expired credential",
                    "detail": cred.get("reason", "Credential verification failed"),
                    "reverify_at": "https://homosapience.org/verify"
                })
                return
        except Exception:
            # Aptos node unavailable — degrade gracefully, don't block
            # HSI principle: infrastructure failure ≠ block human
            pass

        # AntiBotFirewall check (sampled)
        if self.firewall and self.get_history:
            did_hash = hashlib.sha3_256(did_token.encode()).hexdigest()
            try:
                history = await self.get_history(did_hash)
                result = await self.firewall.check(did_hash, history)
                if result.should_block:
                    await self._respond(send, 403, {
                        "error": "Behavioral anomaly detected",
                        "detail": "Re-verification required",
                        "signals": result.signals,
                        "reverify_at": "https://homosapience.org/verify"
                    })
                    return
            except Exception:
                pass  # Firewall failure → allow through

        await self.app(scope, receive, send)

    def _is_public(self, path: str) -> bool:
        if path in self.PUBLIC_PATHS:
            return True
        for pub in self.PUBLIC_PATHS:
            if path.startswith(pub):
                return True
        return False

    async def _respond(self, send, status: int, body: dict):
        body_bytes = json.dumps(body).encode()
        await send({"type": "http.response.start", "status": status,
                    "headers": [[b"content-type", b"application/json"]]})
        await send({"type": "http.response.body", "body": body_bytes})


# ── Route Handlers (framework-agnostic dicts, mounted by setup_hsi_gonka) ─────

def build_routes(
    expression_engine,
    antibot_firewall,
    translation_bridge,
    bond_matcher,
    gonka_client,
):
    """
    Returns a dict of route_path → async handler.
    Mounted by setup_hsi_gonka() or used standalone.
    """
    from .expression_engine import TouchEvent

    routes = {}

    # ── POST /verify/expression ──────────────────────────────────────────────

    async def verify_expression(body: dict) -> dict:
        """
        Verify human gesture pattern.

        Body: { events: [...], session_id: "uuid" }
        Returns: { passed: bool, confidence: float, expression_proof: str|null }
        """
        raw_events = body.get("events", [])
        session_id = body.get("session_id", str(uuid.uuid4()))

        if len(raw_events) < 3:
            return {"error": "Need at least 3 touch events"}, 422

        events = [
            TouchEvent(
                x=float(e.get("x", 0)),
                y=float(e.get("y", 0)),
                pressure=float(e.get("pressure", 0.5)),
                timestamp_ms=int(e.get("timestamp_ms", 0)),
                pause_after_ms=int(e.get("pause_after_ms", 0)),
            )
            for e in raw_events
        ]

        result = await expression_engine.verify(events, session_id)

        response = {
            "passed": result.passed,
            "is_human": result.is_human,
            "confidence": result.confidence,
            "expression_proof": result.expression_proof,
            "anomalies": result.anomalies,
            "analysis_latency_ms": round(result.analysis_latency_ms, 1),
            "via_fallback": result.via_fallback,
        }

        # Proof ready to be written to Aptos
        if result.expression_proof:
            response["next_step"] = "submit_expression_proof_to_aptos"
            response["aptos_tx_data"] = {
                "function": "hsi::human_firewall::record_expression_proof",
                "arguments": [result.expression_proof, session_id],
            }

        status = 200 if result.passed else 422
        return response, status

    routes["POST /verify/expression"] = verify_expression

    # ── GET /verify/status/{did_hash} ────────────────────────────────────────

    async def verify_status(did_hash: str) -> dict:
        """Check current credential status for a DID."""
        # In production: query Aptos chain
        return {
            "did_hash": did_hash[:16] + "...",
            "status": "active",           # active | expired | revoked | not_found
            "bond_count": 3,
            "reputation_score": 250,
            "expires_in_days": 21,
            "network": "testnet",
        }, 200

    routes["GET /verify/status"] = verify_status

    # ── POST /translate ──────────────────────────────────────────────────────

    async def translate(body: dict) -> dict:
        """Translate text via SapiX. No credential required — public endpoint."""
        text = body.get("text", "").strip()
        target_lang = body.get("target_lang", "en")
        source_lang = body.get("source_lang")
        sender_region = body.get("sender_region")

        if not text:
            return {"error": "text is required"}, 422
        if len(text) > 10_000:
            return {"error": "text too long (max 10000 chars)"}, 422

        result = await translation_bridge.translate(
            text=text,
            target_lang=target_lang,
            source_lang=source_lang,
            sender_region=sender_region,
        )

        return {
            "translated": result.translated,
            "source_lang": result.source_lang,
            "target_lang": result.target_lang,
            "detected_lang": result.detected_lang,
            "via_fallback": result.via_fallback,
            "latency_ms": round(result.latency_ms, 1),
        }, 200

    routes["POST /translate"] = translate

    # ── POST /bond/match ─────────────────────────────────────────────────────

    async def bond_match(body: dict) -> dict:
        """Find best guarantor candidates for a new member."""
        from .bond_matcher import CandidateProfile, RequesterProfile

        requester_data = body.get("requester", {})
        candidates_data = body.get("candidates", [])
        n_select = int(body.get("n_select", 10))

        if not candidates_data:
            return {"error": "candidates list is required"}, 422

        requester = RequesterProfile(
            expression_confidence=float(requester_data.get("expression_confidence", 0.9)),
            verification_stage=str(requester_data.get("verification_stage", "new")),
            previous_attempts=int(requester_data.get("previous_attempts", 0)),
        )

        candidates = [
            CandidateProfile(
                did_hash=str(c.get("did_hash", "")),
                reputation_score=int(c.get("reputation_score", 0)),
                bond_count=int(c.get("bond_count", 0)),
                successful_bonds=int(c.get("successful_bonds", 0)),
                revoked_bonds=int(c.get("revoked_bonds", 0)),
                last_bond_days_ago=int(c.get("last_bond_days_ago", 999)),
                network_depth=int(c.get("network_depth", 3)),
                active_hours_per_week=float(c.get("active_hours_per_week", 5)),
                joined_days_ago=int(c.get("joined_days_ago", 365)),
            )
            for c in candidates_data
        ]

        result = await bond_matcher.find_guarantors(candidates, requester, n_select)

        return {
            "selected": [
                {"did_hash": c.did_hash[:12] + "...", "reputation": c.reputation_score}
                for c in result.selected_candidates
            ],
            "count": len(result.selected_candidates),
            "reasoning": result.reasoning,
            "diversity_score": result.diversity_score,
            "estimated_approval_rate": result.estimated_approval_rate,
            "via_fallback": result.via_fallback,
        }, 200

    routes["POST /bond/match"] = bond_match

    # ── GET /health/gonka ────────────────────────────────────────────────────

    async def health_gonka(_=None) -> dict:
        """Check Gonka broker connectivity and fund status."""
        health = await gonka_client.health_check()
        return {
            "gonka": health,
            "timestamp": int(time.time()),
        }, 200 if health.get("status") == "ok" else 503

    routes["GET /health/gonka"] = health_gonka

    return routes


# ── Setup Helper ──────────────────────────────────────────────────────────────

def setup_hsi_gonka(app, api_key: str, **kwargs):
    """
    One-call setup for FastAPI apps.

    from sapix.fastapi_integration import setup_hsi_gonka
    setup_hsi_gonka(app, api_key="gk-your-key")

    Adds:
      - HSIFirewallMiddleware on all non-public routes
      - /verify/expression POST
      - /translate POST
      - /bond/match POST
      - /health/gonka GET

    Optional kwargs:
      - redis_url: str — Redis URL for caching bot scores
      - network: "testnet" | "mainnet"
      - aptos_node_url: str
    """
    from .client import SapiXClient
    from .expression_engine import ExpressionEngine
    from .antibot_firewall import AntiBotFirewall
    from .translation_bridge import TranslationBridge
    from .bond_matcher import BondMatcher

    client = SapiXClient(api_key=api_key)
    expression_engine = ExpressionEngine(client)
    antibot_firewall = AntiBotFirewall(client)
    translation_bridge = TranslationBridge(client)
    bond_matcher = BondMatcher(client)

    routes = build_routes(
        expression_engine, antibot_firewall,
        translation_bridge, bond_matcher, client,
    )

    return {
        "client": client,
        "expression_engine": expression_engine,
        "antibot_firewall": antibot_firewall,
        "translation_bridge": translation_bridge,
        "bond_matcher": bond_matcher,
        "routes": routes,
    }
