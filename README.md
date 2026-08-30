# APTOGON — Human Firewall for the Internet

> **Prove you're human — with a gesture. No password, no email, no tracking.**

Live: **[homosapience.org](https://homosapience.org)**

---

## The Problem

Bots, AI agents, and Sybil accounts flood every network that matters — social platforms, voting systems, comment sections, DAOs. Traditional solutions demand identity documents, phone numbers, or surveillance-grade biometrics. All of them trade privacy for security.

APTOGON does neither.

---

## How It Works

### ✍️ Step 1 — Draw a symbol
Anything: a letter, a digit, a curl. You draw it with your mouse or finger. The AI watches **how** you draw — not **what**.

### 🧠 Step 2 — SapiX Analysis
The gesture pattern is analysed in real time: rhythm, velocity, pauses, micro-corrections. Bots move too smoothly. Humans are irregular — and that irregularity is the proof.

> *No image is captured. No video recorded. Only motion vectors — and only for ~10 seconds.*

### 🔑 Step 3 — Your Anonymous DID
A cryptographic key pair is generated **inside your browser in 1ms** — no server request, no account creation. The result is a `did:key` identifier: a W3C-standard anonymous passport with no name attached.

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

Your private key never leaves your device. Your DID is stored only in browser localStorage.

### ⛓️ Step 4 — Aptos Blockchain
The *fact* of verification — not your data, just a cryptographic hash — is recorded on **Aptos**. It becomes your on-chain `HumanCredential`, valid for 30 days.

### 🤝 Step 5 — Bond Vouching
Three verified humans from the HSI network vouch for you using their reputation. This layer stops bots that might pass the gesture test. Guarantors are selected by **Gonka BondMatcher** — an AI that ranks candidates by reputation, response time, and network depth.

---

## Trust Score

Every DID accumulates a trust score based on vouching history:

| Level | Bonds | Score |
|---|---|---|
| 🌱 Newcomer | 0 | 10% |
| ✅ Community Verified | 3+ | 50% |
| 🏆 Trusted | 7+ | 100% |

Guarantors who vouch for bots lose score. Those who vouch for real humans gain it. Trust is a shared resource — everyone has skin in the game.

---

## Privacy by Design

| What we collect | What we don't collect |
|---|---|
| SHA-3 hash of gesture proof | Raw gesture data |
| Device fingerprint hash (Sybil protection) | Name, email, phone |
| Anonymised DID short | Biometrics of any kind |
| On-chain verification fact | IP address (only a SHA-256 hash is kept, auto-purged after 30 days, admin-only) |
| IP hash for security monitoring (30-day TTL) | |

The gesture coordinates are destroyed in the browser. Only the math reaches the network.

---

## Multi-Device

Verified on your laptop? Link your phone securely with **QR device pairing**:
1. Click 🔗 in chat — get a 6-character one-time code + QR
2. Open on new device → complete gesture verification independently
3. Devices are linked — profile, trust score, and roles transfer automatically

The private key is never transferred. Each device proves its own humanness.

---

## Public Identity Badges

Verified humans can embed proof directly in their profiles — no extension required.

```markdown
![✦ Human Verified](https://homosapience.org/badge/github/yourusername.svg)
```

Add this to your GitHub README, Markdown bio, or any site that renders images. The badge links to a public proof page showing your verification status, trust score, and credential age.

**Claim your handle:** visit [homosapience.org/verify](https://homosapience.org/en/verify) — after verification, declare which username on each platform belongs to you.

| URL pattern | Purpose |
|-------------|---------|
| `https://homosapience.org/badge/{platform}/{username}.svg` | Badge image |
| `https://homosapience.org/h/{platform}/{username}` | Public proof page |

Supported platforms: GitHub · Reddit · X · LinkedIn · Bluesky · Hacker News · Discord · Telegram · Instagram · YouTube · GitLab · Twitch · Medium · TikTok · Substack · Notion · Stack Overflow · Habr

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| AI Verification | SapiX (Qwen3-235B via Gonka Direct) | Gesture pattern analysis |
| Identity | `did:key` W3C Standard | Anonymous DID, no servers |
| Blockchain | Aptos | `HumanCredential` on-chain |
| AI Compute | Gonka Network (decentralised GPU) | SapiX inference layer |
| Bond AI | SapiX BondMatcher | Guarantor selection |
| Translation | SapiX TranslationBridge | 11-language real-time chat |
| Backend | FastAPI + asyncpg | API server |
| Frontend | Next.js 14 + next-intl | 11 languages |
| Database | PostgreSQL | Credentials, bonds, chat |

---

## HSI Network

APTOGON is the infrastructure layer for **Homo Sapiens Intelligence** — a public network of verified humans. Members get:

- 💬 **Secure chat** — only verified humans, Sybil-resistant
- 🗳️ **Governance** — voting weighted by trust score
- 🤝 **Bond network** — reputation-backed vouching
- 🌐 **Multilingual** — AI translation across 11 languages

---

## Developer API

Add proof-of-humanity to any app. The verification endpoint is open — no key, no account:

```js
const res = await fetch('https://homosapience.org/api/verify/expression', {
  method: 'POST',
  body: JSON.stringify({ events, session_id: crypto.randomUUID() }),
})
const { passed, did, confidence } = await res.json()
```

For production integrations, the **developer console** (`/console`) issues API keys,
verifies your domains, and tracks usage. Pooled usage tiers:

| Plan | Verifications / month |
|---|---|
| Free | 1,000 |
| Pro | 50,000 |
| Enterprise | Unlimited |

Docs & pricing: **[homosapience.org/developers](https://homosapience.org/en/developers)**

---

## Live & Transparent

- 📊 **Attack statistics** — real-time classification of traffic as human / bot / **AI-agent** (a growing threat as agentic browsers spread): **[homosapience.org/stats](https://homosapience.org/en/stats)**
- 🔬 **Open benchmark & research data access**: **[homosapience.org/research](https://homosapience.org/en/research)**

---

*Zero surveillance · Zero biometrics · Zero accounts · Open infrastructure*

---

## Repositories

APTOGON is built in the open. Two public repositories:

- **[homosapience](https://github.com/tulubyev/homosapience)** — the full
  open-source mirror of the platform: verification engine, backend API, web
  frontend, browser extension, and developer console. AGPL-3.0. This is the whole
  system that runs [homosapience.org](https://homosapience.org).

- **[aptogon-captcha](https://github.com/tulubyev/aptogon-captcha)** — the
  **drop-in gesture-CAPTCHA**: a privacy-first, AI-proof alternative to image
  CAPTCHAs that any site can add to a form in two lines. Instead of picking traffic
  lights, the visitor *draws* a gesture; an AI reads the motion of a human hand, and
  your backend confirms a short-lived token — the same shape as reCAPTCHA, with no
  image grids, no tracking, and no biometrics stored. This repo is the showcase +
  copy-paste integration examples (HTML, React, Node, Python, PHP); the widget
  itself loads from our CDN. Free tier: 1,000 verifications/month.

  ```html
  <script src="https://homosapience.org/embed/v2/aptogon.js"></script>
  <div data-aptogon-captcha data-aptogon-key="pk_live_YOUR_KEY"></div>
  ```

---

## License

APTOGON is dual-licensed:

- **AGPL-3.0** ([LICENSE](LICENSE)) — for open-source, research, and personal use.
  Network use is distribution: if you run a modified APTOGON as a public service, you must publish your changes under AGPL.
- **Commercial license** ([COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)) — for proprietary integrations
  that cannot comply with AGPL's source-disclosure terms.

See [NOTICE](NOTICE) for attributions and third-party components.

## Security

Found a vulnerability? Please **do not** open a public issue.
See [SECURITY.md](SECURITY.md) for our disclosure policy and contact.

We run an internal **red-team attack simulation program** that continuously tests the gesture verification algorithm against synthetic bots, replay attacks, Sybil farms, and black-box probing. We also maintain a **bug bounty** for responsible disclosure of security vulnerabilities.

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and the PR checklist.
