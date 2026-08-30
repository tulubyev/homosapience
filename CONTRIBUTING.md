# Contributing to APTOGON

Thanks for considering a contribution. APTOGON is dual-licensed (AGPL-3.0 +
commercial); by submitting a PR you agree your contribution is licensed under
the same terms.

## Local setup

Prerequisites: Python 3.12+, Node.js 20+, PostgreSQL 14+, Redis.

```bash
git clone https://github.com/<your-fork>/aptogon.git
cd aptogon
cp .env.example .env          # fill in secrets — never commit .env

# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
python backend/generate_vapid_keys.py   # then paste into .env

# Frontend
cd frontend && npm install && cd ..

# Run both (in separate terminals)
uvicorn backend.main:app --reload --port 8000
cd frontend && npm run dev
```

Or use Docker:
```bash
docker compose up
```

## Pull request checklist

- [ ] Branch from `main`, small focused changes preferred
- [ ] `npm run build` passes (frontend)
- [ ] `pytest` passes (backend, if you touched Python)
- [ ] No new secrets, keys, or `.env` files staged
- [ ] No `console.log` / `print` debugging left behind
- [ ] Updated relevant docs (`README.md`, `.env.example`)
- [ ] PR description explains *why*, not just *what*

## Code style

- **Python**: PEP 8, type hints on new public functions, FastAPI conventions
- **TypeScript**: existing Next.js + Tailwind patterns, no `any` without justification
- **Commits**: short imperative subject (`feat:`, `fix:`, `security:`, `docs:`)

## Security-sensitive areas

If your PR touches authentication, JWT, DID generation, gesture verification,
or anything cryptographic, please mention it in the PR title (`security:` prefix)
and request review explicitly. See [SECURITY.md](SECURITY.md) for reporting
vulnerabilities privately.

## License agreement

By contributing, you certify that:
- You wrote the code, or have the right to submit it
- You agree it can be distributed under both AGPL-3.0 and the commercial license
