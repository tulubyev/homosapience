# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
BotShield — HTTP-layer bot detection for /api/verify/expression.

Checks (in order):
  1. User-Agent blocklist  — blocks Python/curl/headless CLI clients immediately
  2. Origin header check   — POST to /expression must come from a known web origin
  3. Accept-Language check — real browsers always send it; scripts almost never do

Rationale (red team findings 2026-06-19):
  - A1 attack used python-httpx with no Origin/Accept-Language headers
  - All blocked at this layer before hitting SapiX (saves quota + inference cost)
  - Extension background fetch is exempt: it has no Origin but a real browser UA

Feature flag: BOT_SHIELD (default on).
Set FEATURE_BOT_SHIELD=false to disable (e.g. for automated integration tests).
"""

import logging
import os
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from services.feature_flags import feature_enabled

log = logging.getLogger("aptogon.bot_shield")

# ── Config ────────────────────────────────────────────────────────────────────

_BOT_UA_FRAGMENTS = [
    "python", "httpx", "requests", "urllib", "pycurl", "aiohttp", "scrapy",
    "curl/", "wget/", "go-http-client", "okhttp", "java/", "ruby",
    "node-fetch", "axios", "got/", "undici", "playwright", "puppeteer",
    "libwww-perl",
]

_VERIFY_EXPRESSION_PATH = "/api/verify/expression"

# Paths that must be reachable by automated clients (badge CDNs, health checks, etc.)
_PUBLIC_PATH_PREFIXES = ("/badge/", "/api/health")

# Paths exempt from the UA blocklist — open APIs intended for programmatic access.
# These carry their own protections (JWT auth, signature check, DB lookup, rate limiting).
_UA_EXEMPT_PATHS: frozenset[str] = frozenset({
    "/api/verify/expression",
})

# Path prefixes exempt from the UA blocklist — all endpoints under these prefixes
# are developer APIs meant to be called from scripts/servers, not browsers.
_UA_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/api/agent/",   # HDAA: JWT-protected or public, server-to-server by design
    "/api/captcha/", # gesture-CAPTCHA: /siteverify is S2S (sk_live auth + JWT signature)
)

# Base origins always allowed. Extend via ALLOWED_ORIGINS env var (comma-separated).
_ALLOWED_ORIGINS: set[str] = {
    "http://localhost:3000",
    "http://localhost:5173",
    "https://aptogon.network",
    "https://homosapience.org",
    "https://www.homosapience.org",
}
_extra = os.getenv("ALLOWED_ORIGINS", "")
if _extra:
    for _o in _extra.split(","):
        _o = _o.strip()
        if _o:
            _ALLOWED_ORIGINS.add(_o)

# Chrome/Firefox extension origins are allowed (users verify via web, not extension,
# but we don't want to block future extension-initiated verification)
_ALLOWED_ORIGIN_PREFIXES = ("chrome-extension://", "moz-extension://")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_bot_ua(ua: str) -> bool:
    ua_lower = ua.lower()
    return any(frag in ua_lower for frag in _BOT_UA_FRAGMENTS)


def _origin_allowed(origin: str) -> bool:
    if origin in _ALLOWED_ORIGINS:
        return True
    return any(origin.startswith(p) for p in _ALLOWED_ORIGIN_PREFIXES)


# ── Middleware ────────────────────────────────────────────────────────────────

class BotShield(BaseHTTPMiddleware):

    async def dispatch(self, request: Request, call_next):
        if not feature_enabled("BOT_SHIELD"):
            return await call_next(request)

        path = request.url.path

        # Public endpoints must be reachable by automated clients (badge renderers, health probes)
        if path.startswith(_PUBLIC_PATH_PREFIXES):
            response = await call_next(request)
            if path.startswith("/api/"):
                response.headers["X-Robots-Tag"] = "noindex, nofollow"
            return response

        ua = request.headers.get("User-Agent", "")

        # 1. User-Agent blocklist — skipped for open-API paths that carry their own guards
        _ua_exempt = path in _UA_EXEMPT_PATHS or any(path.startswith(p) for p in _UA_EXEMPT_PREFIXES)
        if ua and _is_bot_ua(ua) and not _ua_exempt:
            log.warning("BotShield: blocked bot UA ip=%s ua=%r",
                        request.client.host if request.client else "?", ua[:80])
            return JSONResponse(status_code=403, content={
                "error": "bot_detected",
                "message": "Automated clients are not permitted.",
            })

        # 2 & 3. Verify-expression specific checks
        if (request.method == "POST"
                and request.url.path == _VERIFY_EXPRESSION_PATH):

            origin = request.headers.get("Origin", "")
            accept_lang = request.headers.get("Accept-Language", "")

            # No Origin header + no Accept-Language = almost certainly a script
            if not origin and not accept_lang:
                log.warning("BotShield: no Origin+Accept-Language ip=%s ua=%r",
                            request.client.host if request.client else "?", ua[:80])
                return JSONResponse(status_code=403, content={
                    "error": "bot_detected",
                    "message": "Request does not appear to originate from a browser.",
                })

            # Origin present but not in allowlist
            if origin and not _origin_allowed(origin):
                log.warning("BotShield: origin not allowed ip=%s origin=%r",
                            request.client.host if request.client else "?", origin)
                return JSONResponse(status_code=403, content={
                    "error": "origin_not_allowed",
                    "message": "Cross-origin verification is not permitted.",
                })

        response = await call_next(request)

        # Prevent API paths from being indexed by search crawlers
        if path.startswith("/api/"):
            response.headers["X-Robots-Tag"] = "noindex, nofollow"

        return response
