# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
APTOGON Backend
───────────────
Стек:
  SapiX  → верификация человека
  did:key   → анонимный DID (без Ceramic)
  Aptos     → HumanCredential on-chain
  FastAPI   → API
  Redis     → кэш бот-скоров

Убрано:
  ✗ Cosmos SDK / HSI Chain
  ✗ Ceramic / ComposeDB
  ✗ IBC Bridge

Запуск:
  uvicorn main:app --reload --port 8000
"""

import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import verify, bond, chat, translate, governance, pair as pair_router
from routers import auth as auth_router
from routers import handles as handles_router
from routers import badge as badge_router
from routers.chat import cleanup_old_uploads
from routers import ws as ws_router
from middleware.firewall import AptogonFirewall
from middleware.bot_shield import BotShield
from services.sapix_service import GonkaService
from services.aptos_service import AptosService
from services.db_service import DatabaseService
from services.device_fingerprint import DeviceFingerprintStore
from services.ws_manager import ConnectionManager
from services.rate_limiter import RateLimiter
from services.behavior_monitor import BehaviorMonitor
from services.risk_engine import RiskEngine
from services.feature_flags import feature_enabled, all_flags


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.gonka = GonkaService()
    app.state.aptos = AptosService()
    app.state.db = DatabaseService()
    app.state.fp_store = DeviceFingerprintStore()
    app.state.ws_manager = ConnectionManager()
    app.state.risk_engine = RiskEngine()   # R2: stateless, instantiate once
    from services.gesture_classifier import GestureClassifier
    app.state.ml_classifier = GestureClassifier()   # local GBM, loaded once (graceful if absent)

    # R1: embed/captcha assertion signing key (fail-safe — required when either API on)
    if feature_enabled("EMBED_API") or feature_enabled("CAPTCHA_API"):
        from services.server_key import get_server_key
        _sk = get_server_key()
        if not _sk.available:
            raise RuntimeError(
                "EMBED_API/CAPTCHA_API is enabled but APTOGON_JWT_PRIVATE_KEY is not set/invalid. "
                "Generate one: python3 -c \"import base64;"
                "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey;"
                "from cryptography.hazmat.primitives.serialization import Encoding,PrivateFormat,NoEncryption;"
                "print(base64.urlsafe_b64encode(Ed25519PrivateKey.generate()"
                ".private_bytes(Encoding.Raw,PrivateFormat.Raw,NoEncryption())).decode())\""
            )
        app.state.server_key = _sk
        print("  ✅ EMBED_API/CAPTCHA_API: server signing key loaded")

    await app.state.db.connect()

    # Rate limiter — использует Redis если доступен
    try:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"),
                                   encoding="utf-8", decode_responses=True)
        await _redis.ping()
        app.state.rate_limiter = RateLimiter(redis=_redis)
        print("  ✅ Rate limiter: Redis")
    except Exception:
        app.state.rate_limiter = RateLimiter(redis=None)
        print("  ⚠️  Rate limiter: in-memory (Redis unavailable)")

    # Behavior monitor — reuses same Redis connection
    try:
        _beh_redis = getattr(app.state.rate_limiter, '_redis', None)
        if _beh_redis:
            app.state.behavior = BehaviorMonitor(redis=_beh_redis)
            print("  ✅ Behavior monitor: Redis")
        else:
            raise RuntimeError("no redis")
    except Exception:
        app.state.behavior = BehaviorMonitor(redis=None)
        print("  ⚠️  Behavior monitor: in-memory")
    app.state.gonka.set_db(app.state.db)  # enable persistent Gonka usage logging
    # Start background file-cleanup task (warns at 4 days, deletes at 5 days)
    asyncio.create_task(cleanup_old_uploads(app))
    # R1-D4: daily alerts cron (auto-resolve Level-1 + delete 30-day-old)
    if feature_enabled("ALERTS"):
        import asyncio as _asyncio
        async def _alerts_cron():
            while True:
                await _asyncio.sleep(86400)
                from services import alert_service as _as
                resolved = await _as.auto_resolve_old(app.state.db)
                deleted  = await _as.delete_expired(app.state.db)
                print(f"  🗑  Alerts cron: resolved={resolved} deleted={deleted}")
        _asyncio.create_task(_alerts_cron())

    # R1-D1: daily cleanup of stale domain verifications (pending/failed > N days).
    # Different browsers/DIDs create separate pending rows per origin; without this
    # they pile up as garbage. 'verified' rows are always kept.
    if feature_enabled("EMBED_API"):
        import asyncio as _asyncio_dv
        _dv_stale_days = int(os.getenv("DOMAIN_VERIFY_STALE_DAYS", "7"))
        async def _domain_cleanup_cron():
            import time as _t
            while True:
                await _asyncio_dv.sleep(86400)
                cutoff = int(_t.time()) - (_dv_stale_days * 86400)
                n = await app.state.db.delete_stale_domain_verifications(cutoff)
                if n:
                    print(f"  🗑  Domain-verif cleanup: removed {n} stale pending/failed (>{_dv_stale_days}d)")
        _asyncio_dv.create_task(_domain_cleanup_cron())

    stats = await app.state.aptos.get_stats()
    print(f"""
╔══════════════════════════════════════╗
║  APTOGON v0.2.0 — Human Firewall     ║
║  SapiX + did:key + Aptos          ║
╠══════════════════════════════════════╣
║  Credentials: {stats['valid_credentials']:>6} valid             ║
║  Network:     {stats['network']:<20}  ║
╚══════════════════════════════════════╝
    """)
    yield
    await app.state.db.close()


app = FastAPI(
    title="APTOGON API",
    description="HSI Human Firewall — SapiX + did:key + Aptos",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://aptogon.network"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
app.add_middleware(AptogonFirewall)
app.add_middleware(BotShield)

app.include_router(auth_router.router,     prefix="/api/auth",       tags=["Auth"])
app.include_router(verify.router,      prefix="/api/verify",     tags=["Verification"])
app.include_router(bond.router,        prefix="/api/bond",       tags=["Bond"])
app.include_router(chat.router,        prefix="/api/chat",       tags=["Chat"])
app.include_router(translate.router,   prefix="/api/translate",  tags=["Translation"])
app.include_router(governance.router,      prefix="/api/governance", tags=["Governance"])
app.include_router(pair_router.router,     prefix="/api/pair",       tags=["Device Pairing"])
from routers import founders as founders_router
app.include_router(founders_router.router, prefix="/api/founders",   tags=["Founders"])
app.include_router(ws_router.router,       prefix="/ws",             tags=["WebSocket"])
app.include_router(handles_router.router,  prefix="/api/handles",    tags=["Handles"])
app.include_router(badge_router.router,    prefix="/badge",          tags=["Badge"])

# ── Feature-flagged routers (R1–R6) ───────────────────────────────────────────
# Новый код можно лить в main и держать «тёмным» — роутер регистрируется только
# когда соответствующий FEATURE_* флаг включён в .env.

# R2 — Risk Engine (stats collection + adaptive gate + public /stats page)
# STATS_COLLECT: пассивный сбор risk_events (независимо от gate)
# RISK_GATE:     адаптивный жест в verify.py
# STATS_PAGE:    публичный GET /api/risk/stats
if feature_enabled("STATS_COLLECT") or feature_enabled("RISK_GATE") or feature_enabled("STATS_PAGE"):
    from routers import risk as risk_router
    app.include_router(risk_router.router, prefix="/api/risk", tags=["Risk"])

# R6.1 — public /research benchmark summary
if feature_enabled("BENCHMARK_PAGE"):
    from routers import research as research_router
    app.include_router(research_router.router, prefix="/api/research", tags=["Research"])

# Consented gesture-similarity lab study (labelled data, separate table).
if feature_enabled("GESTURE_STUDY"):
    from routers import research_study as research_study_router
    app.include_router(research_study_router.router,
                       prefix="/api/research/study", tags=["Research"])

# R1 — Embed API + org API keys (subsystems A+B) + domain-ownership (D1)
if feature_enabled("EMBED_API"):
    from routers import embed as embed_router
    app.include_router(embed_router.router,        prefix="/api/embed",   tags=["Embed"])

# Gesture-CAPTCHA — embeddable widget (iframe /embed/verify + S2S /siteverify)
if feature_enabled("CAPTCHA_API"):
    from routers import captcha as captcha_router
    app.include_router(captcha_router.router,      prefix="/api/captcha", tags=["Captcha"])

# Org API keys + domain-ownership console — shared by both embed and captcha
if feature_enabled("EMBED_API") or feature_enabled("CAPTCHA_API"):
    from routers import console_keys as console_keys_router
    from routers import domain as domain_router
    app.include_router(console_keys_router.router, prefix="/api/console", tags=["Console"])
    app.include_router(domain_router.router,       prefix="/api/console", tags=["Console"])

# HDAA — Human-Delegated Agent Authentication (Agent Passport)
if feature_enabled("AGENT_PASSPORT"):
    from routers import agent as agent_router
    app.include_router(agent_router.router, prefix="/api/agent", tags=["Agent Passport"])

# R1-D4 — Alerts (org-owner widget + admin feed + extension push)
if feature_enabled("ALERTS"):
    from routers.alerts import console_router as alerts_console, admin_router as alerts_admin
    app.include_router(alerts_console, prefix="/api/console", tags=["Alerts"])
    app.include_router(alerts_admin,   prefix="/api/admin",   tags=["Alerts"])

# ── Static uploads ───────────────────────────────────────────────────────────
_UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(_UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOADS_DIR), name="uploads")


@app.get("/api/health")
async def health(request=None):
    aptos = request.app.state.aptos if request else None
    stats = await aptos.get_stats() if aptos else {}
    return {"status": "ok", "version": "0.2.0", "project": "APTOGON", **stats}


@app.get("/api/features")
async def features():
    """Публичные фича-флаги — фронтенд прячет/показывает страницы R1–R6 по ним."""
    return {"features": all_flags()}


@app.get("/")
async def root():
    return {
        "project": "APTOGON",
        "stack": ["SapiX", "did:key", "Aptos"],
        "removed": ["Cosmos SDK", "Ceramic", "IBC"],
        "docs": "/docs",
    }
