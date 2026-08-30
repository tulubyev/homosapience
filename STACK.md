# APTOGON — Tech Stack

APTOGON is a **polyglot full-stack monorepo**. Each layer uses the language that
fits it: a **Python** server, a **TypeScript** web app, and a **JavaScript**
browser extension. They are not alternatives to one another — a browser cannot
run Python and a verification/crypto/DB backend has no business in browser JS.
The web app and the server communicate over HTTP (JSON).

```
Browser extension (JS, MV3) ─┐
Web app (TypeScript/Next.js) ─┼─ HTTP/JSON ─▶ API (Python/FastAPI) ─▶ Postgres / Redis
                              │                       │
                              │                       └─▶ sapix (Python verification engine)
                              └─ embed snippet (aptogon.js, plain JS)        └─▶ Aptos (on-chain)
```

---

## Repository layout

| Path | Language | Responsibility |
|---|---|---|
| `backend/` | Python | FastAPI API: routers, services, DB layer, middleware |
| `sapix/` | Python | Core human-verification engine (gesture analysis, antibot, bond matcher) |
| `frontend/` | TypeScript | Next.js web app (`/console`, `/admin`, `/research`, `/stats`, `/verify`, …) |
| `browser-extension/` | JavaScript | Manifest V3 extension (content + background service worker) |
| `frontend/public/embed/v1/aptogon.js` | JavaScript | Dependency-free drop-in verifier for integrators |
| `docs/` | Markdown | Specs & plans (private; excluded from the public repo) |

---

## Backend — Python

- **Framework:** FastAPI (`fastapi>=0.111`), served by **uvicorn** (`uvicorn[standard]`).
- **Models/validation:** Pydantic v2.
- **Database access:** `asyncpg` against **PostgreSQL**, behind a single thin
  `services/db_service.py` (`DatabaseService`). Every method has an **in-memory
  dict fallback** (`self._use_mem`) used when `DATABASE_URL` is unset — this is
  what the test suite runs against, so tests need no real database.
- **Cache / rate limits / behavior counters:** **Redis** (`redis[asyncio]`),
  with an in-memory fallback when Redis is unavailable.
- **Crypto:** `cryptography` (Ed25519 for DID keys + the embed JWT signing key),
  `PyJWT` for session tokens.
- **Other libs:** `dnspython` (domain-ownership TXT checks), `maxminddb`
  (GeoLite2-ASN for the R2 risk engine), `pywebpush` (push), `python-multipart`
  (uploads), `openai` (LLM client used by the verification engine / fallback).
- **Layout:** `routers/` (HTTP endpoints, one module per area) · `services/`
  (business logic: `db_service`, `risk_engine`, `behavior_monitor`,
  `alert_service`, `billing`, `data_access`, `ip_intel`, `domain_verify`,
  `feature_flags`, …) · `middleware/` (`AptogonFirewall`).

## Verification engine — Python (`sapix/`)

A separate Python package (`import sapix`) holding the verification core:
expression/gesture engine, antibot firewall, translation bridge, bond matcher.
The backend imports it; if it is absent it degrades to a stub. It is shipped
into the API image and must be on `PYTHONPATH` (`/app`).

## Frontend — TypeScript

- **Framework:** Next.js 14 (App Router) + React 18, **TypeScript 5**.
- **i18n:** `next-intl` (locales: en, ru, zh, es, fr, ar, he, pt, hi, de, ja).
- **Styling convention:** **inline styles** (no Tailwind / CSS-in-JS lib) — a
  deliberate project preference for self-contained, reviewable components.
- **Pages:** `src/app/[locale]/…` — `console`, `admin`, `research`, `stats`,
  `verify`, `chat`, `developers`, `privacy`, `manifest`, etc.
- **API wrappers:** typed `fetch` helpers in `src/lib/*.ts` (`consoleApi`,
  `alertsApi`, `billingApi`, `researchApi`, `sessionAuth`). Auth headers come
  from `sessionAuth` (Bearer JWT or `X-APTOGON-DID` fallback).
- **QR:** `qrcode.react` (client-side; no third-party QR service).

## Browser extension — JavaScript (MV3)

Manifest V3 (Chrome + Firefox). `background.js` service worker (credential sync,
on-chain status, alert polling), content scripts for the per-site badge. Plain
JS, no build step.

---

## Cross-cutting concerns

### Identity & auth
- **DID:** anonymous `did:key` (Ed25519), W3C-compatible. No accounts, no PII.
- **On-chain:** a `HumanCredential` hash is anchored on **Aptos**; credentials
  expire (~30 days) and carry a trust score + bond count.
- **Request auth:** `require_verified_did` (valid non-expired credential) for
  org/console endpoints; `_require_admin` (DID in `admin_dids`) for admin;
  the embed product uses **publishable/secret API keys** (`pk_live_`/`sk_live_`,
  the secret stored only as a SHA-256 hash) with a `challenge → assert → verify`
  flow.

### Feature flags (dark launches)
`services/feature_flags.py` — every cycle ships behind `FEATURE_<NAME>` env
flags (default off), so new code can land in `main` "dark" and be enabled per
deploy with instant rollback. Routers register only when their flag is on.
Current flags include `EMBED_API`, `CONSOLE`, `SELF_SERVE_KEYS`,
`REQUIRE_DOMAIN_VERIFICATION`, `ALERTS`, `BILLING`, `STATS_COLLECT`,
`STATS_PAGE`, `RISK_GATE`, `BENCHMARK_PAGE`. The frontend reads them via
`GET /api/features`.

### Frontend ↔ backend contract
There is no shared codegen: Pydantic response models on the server and the TS
interfaces in `frontend/src/lib/*.ts` are kept **in sync by hand**. Keep them
matched when changing an endpoint's shape.

### Data stores
PostgreSQL (durable: credentials, bonds, api_keys, usage, domains, alerts,
risk_events, owner_plans, data_access_requests, …) + Redis (ephemeral:
nonces, rate-limit counters, behavior signals). Schema lives in `_SCHEMA_SQL`
in `db_service.py` and auto-migrates (`CREATE TABLE IF NOT EXISTS`) on connect.

### Testing
- Backend: **pytest** (async via anyio) against the in-memory DB — no external
  services required. Run: `cd backend && python3 -m pytest tests/ -q`.
- Frontend: `npx tsc --noEmit` + `npm run build`.

---

## Deployment (high level)

- **API:** uvicorn (FastAPI) — containerized; PostgreSQL + Redis as services.
- **Web app:** Next.js production build, served via a process manager (PM2).
- **Routing:** a reverse proxy (Traefik) terminates TLS and routes
  `/api/*` → backend, everything else → the web app.
- Feature flags + secrets live in the server `.env` (never committed).

> Server-specific deploy steps are in `DEPLOY.md` (private — not in the public repo).

---

## Public / private split

The private repo (full history, internal docs, deploy config) is mirrored to a
public open-source repo via `scripts/sync-to-public.sh` (orphan clone, secret
scan). `frontend/` and `backend/` are public; `.env`, keys, `docs/`,
`outreach/`, `security/`, `DEPLOY.md`, infra configs, and store assets are
excluded. License: **AGPL-3.0** with a commercial option (see
`COMMERCIAL-LICENSE.md`).
