# Security Policy

## Supported Versions

APTOGON is under active development. Security fixes are applied to the
`main` branch and the most recent tagged release.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security problems.**

Email: **security@homosapience.org**
PGP key: available on request.

Please include:
- A description of the issue and its impact
- Steps to reproduce (PoC if possible)
- Affected version / commit hash
- Your name / handle for credit (optional)

We aim to:
- Acknowledge your report within **72 hours**
- Provide a status update within **7 days**
- Publish a fix or mitigation within **30 days** for high-severity issues

We will credit reporters in release notes unless you prefer to remain
anonymous. We do not currently run a paid bounty program.

## Scope

In scope:
- `backend/` — FastAPI server, auth, JWT handling, DB queries
- `frontend/` — Next.js app, client-side crypto, DID handling
- `browser-extension/` — Chrome MV3 extension
- `sapix/` — AI verification pipeline, Gonka client
- Smart contracts under `sapix/contracts/`
- Production infra: `nginx.conf`, `docker-compose.prod.yml`

Out of scope:
- Denial-of-service via volumetric attacks
- Issues requiring physical access to the user's device
- Social engineering of project maintainers
- Third-party services (Aptos nodes, Gonka network, OpenRouter)

## Cryptographic Material

The private DID key never leaves the user's browser. If you find a path
where the key, gesture coordinates, or biometric-equivalent data can be
exfiltrated, **treat it as critical**.
