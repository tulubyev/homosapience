'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

// ── Static technical content (kept in English — standard for dev docs) ─────

const QUICKSTEPS = [
  {
    title: 'Get your API keys', color: '#7c3aed',
    code: `// In the APTOGON console (/console): create a key, then verify your domain.
// pk_live_…  — publishable key, safe to ship in the browser
// sk_live_…  — secret key, server-side only (shown once at creation)`,
  },
  {
    title: 'Drop in the verifier (browser)', color: '#0891b2',
    code: `<!-- Declarative: renders a "Verify you're human" button -->
<script src="https://homosapience.org/embed/v1/aptogon.js"
        data-aptogon-key="pk_live_…"></script>
<div data-aptogon-verify data-on-success="onHuman"></div>

<script>
  // …or call it programmatically (opens the APTOGON signer popup):
  async function verify() {
    const { token, trust_band } = await window.Aptogon.verify({
      publishableKey: 'pk_live_…',
    })
    // send \`token\` to your backend to confirm it
    await fetch('/my/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  }
</script>`,
  },
  {
    title: 'Confirm server-side (secret key)', color: '#059669',
    code: `// On YOUR server — never expose sk_live_ to the browser
const res = await fetch('https://homosapience.org/api/embed/verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk_live_…',
  },
  body: JSON.stringify({ token }),
})
const { human, did_hash, trust_band } = await res.json()
if (human) {
  // verified, unique human — trust_band ∈ newcomer | community | trusted
  // did_hash is anonymous (no link to the user's real identity)
}`,
  },
]

const ENDPOINTS = [
  {
    method: 'POST', path: '/api/captcha/siteverify', color: '#16a34a',
    summary: 'Gesture CAPTCHA — validate a token on your server (S2S)',
    request: { type: 'application/json', body: `// Authorization: Bearer sk_live_…  (never expose in browser)
{
  "token": "<aptogon-response from the submitted form>"
}` },
    response: `{
  "success": true,
  "human": true,
  "band": "community",          // newcomer | community | trusted
  "hostname": "https://your-site.com",
  "issued_at": 1732801234
}`,
    notes: 'The billable call. Token is single-use, expires in 120s. Returns 409 if already redeemed, 403 on audience mismatch, 429 on quota cap. The aptogon.js v2 loader produces the token client-side.',
  },
  {
    method: 'POST', path: '/api/captcha/verify', color: '#0891b2',
    summary: 'Gesture CAPTCHA — classify a gesture (called by the iframe)',
    request: { type: 'application/json', body: `{
  "publishable_key": "pk_live_…",
  "origin": "https://your-site.com",
  "events": [ /* captured gesture points */ ],
  "session_id": "uuid"
}` },
    response: `{
  "token": "<signed JWT — pass to /siteverify>",
  "human": true,
  "band": "community"
}`,
    notes: 'The embedded iframe calls this automatically; you normally do not call it directly. Fails closed (503) if the classifier is unavailable — never emits human:true when down.',
  },
  {
    method: 'POST', path: '/api/embed/challenge', color: '#2563eb',
    summary: 'Create a new verification challenge',
    request: { type: 'application/json', body: `{
  "domain": "yourplatform.com",
  "session_id": "unique-session-identifier",
  "locale": "en"          // optional — defaults to "en"
}` },
    response: `{
  "challenge_id": "chal_7f4a2c9e1b...",
  "nonce": "7f4a2c9e1b3d4a5f...",
  "expires_at": 1732801234,
  "gesture_path": [3, 1, 4, 1, 5, 9],
  "widget_url": "https://homosapience.org/embed/verify?c=chal_..."
}`,
    notes: 'challenge_id expires in 60 seconds. gesture_path is the sequence of gesture segments the user must trace.',
  },
  {
    method: 'POST', path: '/api/embed/assert', color: '#7c3aed',
    summary: 'Submit gesture proof and verify liveness',
    request: { type: 'application/json', body: `{
  "challenge_id": "chal_7f4a2c9e1b...",
  "did": "did:aptogon:device:abc123...",
  "gesture_hash": "sha3_256_of_gesture_data",
  "signature": "ed25519_signature_of_nonce+gesture_hash",
  "canvas_fp": "webgl_canvas_fingerprint"
}` },
    response: `{
  "token": "tok_9f3b1d7c...",
  "trust_band": "community",
  "did_hash": "sha256_anonymous_hash",
  "expires_at": 1732887634
}`,
    notes: 'Token is single-use. Pass it to POST /api/embed/verify on your server. The aptogon.js widget handles this endpoint automatically.',
  },
  {
    method: 'POST', path: '/api/embed/verify', color: '#059669',
    summary: 'Server-to-server: redeem token with your secret key',
    request: { type: 'application/json', body: `// Authorization: Bearer sk_live_…  (never expose in browser)
{
  "token": "tok_9f3b1d7c..."
}` },
    response: `{
  "human": true,
  "did_hash": "sha256_anonymous_hash",
  "trust_band": "community",   // newcomer | community | trusted
  "issued_at": 1732801234
}`,
    notes: 'This is the billable call. Use sk_live_ only on your server. Returns human: false if token is expired, tampered, or already redeemed.',
  },
  {
    method: 'GET', path: '/api/verify/status', color: '#0891b2',
    summary: 'Look up the verification status of a DID',
    request: { type: 'query params', body: `GET /api/verify/status?did=did:aptogon:device:abc123...` },
    response: `{
  "is_human": true,
  "trust_band": "community",
  "valid_until": 1732887634,
  "bond_count": 12
}`,
    notes: 'Use for long-lived sessions where you want to re-check without a new gesture. Returns is_human: false if credential has expired.',
  },
]

const ERRORS = [
  { code: '400', name: 'invalid_request', desc: 'Missing required field or malformed JSON' },
  { code: '401', name: 'unauthorized', desc: 'Missing or invalid API key in Authorization header' },
  { code: '403', name: 'domain_not_allowed', desc: 'Request domain not registered for this API key' },
  { code: '404', name: 'not_found', desc: 'challenge_id or token does not exist' },
  { code: '409', name: 'challenge_expired', desc: 'challenge_id has exceeded its 60-second validity window' },
  { code: '409', name: 'token_already_used', desc: 'Token was already redeemed — tokens are single-use' },
  { code: '422', name: 'gesture_rejected', desc: 'Gesture failed liveness check — synthetic input detected' },
  { code: '422', name: 'did_cluster_flagged', desc: 'DID was flagged by cluster detection as likely sybil' },
  { code: '429', name: 'rate_limited', desc: 'Monthly verification quota exceeded for your plan tier' },
  { code: '500', name: 'server_error', desc: 'Internal error — retry with exponential backoff' },
]


const TRUST_BANDS = [
  { label: 'trusted', score: '1.0', color: '#059669', desc: 'Hardware-attested DID, clean gesture, established bond graph. Safe to grant full access.' },
  { label: 'community', score: '0.5–0.99', color: '#d97706', desc: 'Verified DID, gesture passed, some social history. Suitable for most use cases.' },
  { label: 'newcomer', score: '0.1–0.49', color: '#dc2626', desc: 'Gesture passed, new DID with no bond history yet. Consider step-up verification or restricted access.' },
]

const SDK_EXAMPLES = [
  {
    label: 'cURL',
    lang: 'bash',
    code: `# 1. Create challenge (server-side)
curl -X POST https://homosapience.org/api/embed/challenge \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"domain":"yourplatform.com","session_id":"sess_abc123"}'

# 2. After widget completes, redeem token (server-side)
curl -X POST https://homosapience.org/api/embed/verify \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"tok_9f3b1d7c..."}'`,
  },
  {
    label: 'Python',
    lang: 'python',
    code: `import requests

BASE = "https://homosapience.org/api"
SK = "sk_live_…"
HEADERS = {"Authorization": f"Bearer {SK}", "Content-Type": "application/json"}

def create_challenge(domain: str, session_id: str) -> dict:
    r = requests.post(f"{BASE}/embed/challenge", headers=HEADERS,
                      json={"domain": domain, "session_id": session_id})
    r.raise_for_status()
    return r.json()

def verify_token(token: str) -> dict:
    r = requests.post(f"{BASE}/embed/verify", headers=HEADERS,
                      json={"token": token})
    r.raise_for_status()
    return r.json()

# After widget completes and sends token to your backend:
result = verify_token("tok_9f3b1d7c...")
if result["human"] and result["trust_band"] in ("community", "trusted"):
    print("Access granted")`,
  },
  {
    label: 'Node.js',
    lang: 'javascript',
    code: `const BASE = 'https://homosapience.org/api'
const SK = 'sk_live_…'
const h = { Authorization: \`Bearer \${SK}\`, 'Content-Type': 'application/json' }

async function createChallenge(domain, sessionId) {
  const r = await fetch(\`\${BASE}/embed/challenge\`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ domain, session_id: sessionId }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

async function verifyToken(token) {
  const r = await fetch(\`\${BASE}/embed/verify\`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ token }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// In your route handler (e.g. Express):
app.post('/confirm', async (req, res) => {
  const { human, did_hash, trust_band } = await verifyToken(req.body.token)
  if (!human) return res.status(403).json({ error: 'not_human' })
  // trust_band ∈ newcomer | community | trusted
  res.json({ ok: true, did_hash, trust_band })
})`,
  },
]

const METHOD_COLORS: Record<string, string> = {
  GET: '#059669', POST: '#2563eb', DELETE: '#dc2626', PATCH: '#d97706',
}

// ── Section renderers (each is one hub subpage) ──────────────────────────────

function QuickstartSection({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h2 style={SEC_H2}>{title}</h2>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>{subtitle}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {QUICKSTEPS.map((s, i) => (
          <div key={i} style={{ borderRadius: 18, overflow: 'hidden', border: '1.5px solid #e2e8f0' }}>
            <div style={{ background: s.color, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 99, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 13, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>{s.title}</span>
            </div>
            <div style={{ background: '#0f172a', padding: '20px 24px' }}>
              <pre style={{ color: '#e2e8f0', fontSize: '0.82rem', fontFamily: 'monospace', lineHeight: 1.75, margin: 0, overflowX: 'auto' }}>{s.code}</pre>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function PrivacySection() {
  return (
    <>
      <h2 style={SEC_H2}>What your server receives — and what it never touches</h2>
      <p style={{ color: '#6b7280', marginBottom: 20, fontSize: '0.95rem', lineHeight: 1.6 }}>
        Every successful <code style={CODE_INLINE}>/api/embed/verify</code> call returns exactly three fields. Nothing personal is ever transmitted.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: '20px 22px' }}>
          <div style={{ fontWeight: 800, color: '#16a34a', marginBottom: 12, fontSize: '0.9rem' }}>✅ You receive</div>
          <ul style={{ margin: 0, paddingInlineStart: 20, color: '#374151', fontSize: '0.875rem', lineHeight: 1.85 }}>
            <li><code style={{ background: '#f0fdf4', padding: '1px 5px', borderRadius: 4, color: '#166534', fontSize: '0.82rem' }}>human: true</code> — a real person did this action, right now</li>
            <li><code style={{ background: '#f0fdf4', padding: '1px 5px', borderRadius: 4, color: '#166534', fontSize: '0.82rem' }}>did_hash</code> — anonymous fingerprint to enforce one-human-one-action</li>
            <li><code style={{ background: '#f0fdf4', padding: '1px 5px', borderRadius: 4, color: '#166534', fontSize: '0.82rem' }}>trust_band</code> — <code style={{ fontSize: '0.78rem' }}>newcomer | community | trusted</code></li>
          </ul>
        </div>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: '20px 22px' }}>
          <div style={{ fontWeight: 800, color: '#dc2626', marginBottom: 12, fontSize: '0.9rem' }}>🚫 You never receive (or store)</div>
          <ul style={{ margin: 0, paddingInlineStart: 20, color: '#374151', fontSize: '0.875rem', lineHeight: 1.85 }}>
            <li>No name, email, phone, or government document</li>
            <li>No biometric template — unlike iris or palm systems</li>
            <li><strong>GDPR-native</strong>: no consent banner required for the check, no biometric data liability</li>
          </ul>
        </div>
      </div>
      <div style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', padding: '14px 18px', fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.65 }}>
        Store <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 4 }}>did_hash</code> in your database to enforce "one human per action" across sessions — it is a one-way hash with no link to real identity. Never store the raw DID.
      </div>
    </>
  )
}

function ApiReferenceSection() {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ ...SEC_H2, marginBottom: 0 }}>API Reference</h2>
        <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'monospace' }}>Base URL: https://homosapience.org/api</span>
      </div>
      <p style={{ color: '#6b7280', marginBottom: 8, fontSize: '0.9rem' }}>
        All requests require <code style={{ ...CODE_INLINE, fontSize: '0.82rem' }}>Authorization: Bearer YOUR_KEY</code>. Use <code style={{ ...CODE_INLINE, fontSize: '0.82rem' }}>sk_live_</code> server-side, <code style={{ ...CODE_INLINE, fontSize: '0.82rem' }}>pk_live_</code> in the browser.
      </p>
      <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 24 }}>
        Get your keys in the <Link href="/console" style={{ color: '#2563eb' }}>developer console</Link>.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {ENDPOINTS.map((ep, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ background: METHOD_COLORS[ep.method] || '#64748b', color: '#fff', fontSize: '0.7rem', fontWeight: 800, borderRadius: 6, padding: '3px 9px', letterSpacing: '0.06em', flexShrink: 0 }}>
                {ep.method}
              </span>
              <code style={{ fontSize: '0.9rem', fontWeight: 700, color: '#111827', fontFamily: 'monospace' }}>{ep.path}</code>
              <span style={{ fontSize: '0.8rem', color: '#6b7280', marginInlineStart: 'auto' }}>{ep.summary}</span>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <div>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Request</div>
                  <div style={{ background: '#0f172a', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '5px 12px', background: '#1e293b', fontSize: '0.65rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{ep.request.type}</div>
                    <pre style={{ margin: 0, padding: '12px 14px', fontSize: '0.76rem', color: '#e2e8f0', lineHeight: 1.6, overflowX: 'auto', fontFamily: 'monospace' }}><code>{ep.request.body}</code></pre>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Response 200</div>
                  <div style={{ background: '#0f172a', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '5px 12px', background: '#1e293b', fontSize: '0.65rem', color: '#059669', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>application/json</div>
                    <pre style={{ margin: 0, padding: '12px 14px', fontSize: '0.76rem', color: '#e2e8f0', lineHeight: 1.6, overflowX: 'auto', fontFamily: 'monospace' }}><code>{ep.response}</code></pre>
                  </div>
                </div>
              </div>
              {ep.notes && (
                <div style={{ marginTop: 12, padding: '9px 14px', background: '#f8fafc', borderLeft: `3px solid ${ep.color}`, borderRadius: '0 8px 8px 0', fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.6 }}>
                  {ep.notes}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function CaptchaSection() {
  return (
    <>
      <h2 style={SEC_H2}>Gesture CAPTCHA (drop-in)</h2>
      <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 16 }}>
        A privacy-first alternative to image CAPTCHAs — the visitor draws a gesture in an inline iframe.
        Add the loader + a <code style={CODE_INLINE}>data-aptogon-captcha</code> element,
        then validate the token on your server. First: verify your domain and create a key in the <a href="/console" style={{ color: '#7c3aed' }}>Console</a>.
      </p>
      <div style={{ background: '#0f172a', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '8px 16px', background: '#1e293b', fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>1 · Client (HTML)</div>
        <pre style={{ margin: 0, padding: '18px 20px', fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.65, overflowX: 'auto', fontFamily: 'monospace' }}>
          <code>{`<script src="https://homosapience.org/embed/v2/aptogon.js"></script>

<form action="/signup" method="post">
  <!-- your fields … -->
  <div data-aptogon-captcha data-aptogon-key="pk_live_YOUR_KEY"></div>
  <button type="submit">Sign up</button>
</form>
<!-- On success the loader adds a hidden input[name="aptogon-response"]. -->`}
          </code>
        </pre>
      </div>
      <div style={{ background: '#0f172a', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px', background: '#1e293b', fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>2 · Server (validate the token, S2S)</div>
        <pre style={{ margin: 0, padding: '18px 20px', fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.65, overflowX: 'auto', fontFamily: 'monospace' }}>
          <code>{`curl -s https://homosapience.org/api/captcha/siteverify \\
  -H "Authorization: Bearer sk_live_YOUR_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"token": "<aptogon-response from the submitted form>"}'

# → { "success": true, "human": true, "band": "…",
#     "hostname": "https://your-site.com", "issued_at": 173… }`}
          </code>
        </pre>
      </div>
      <p style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.6, marginTop: 12 }}>
        Programmatic API: <code style={CODE_INLINE}>window.AptogonCaptcha.render(el, {'{ key, onVerified }'})</code>.
        Tokens are single-use and expire in 120s. Live demo: <a href="/embed/captcha-demo.html" style={{ color: '#7c3aed' }}>/embed/captcha-demo.html</a>.
      </p>
    </>
  )
}

function SdkSection() {
  return (
    <>
      <h2 style={SEC_H2}>SDK examples</h2>
      <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 20 }}>
        No official SDK yet — full flow using standard HTTP libraries.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {SDK_EXAMPLES.map(ex => (
          <div key={ex.label} style={{ borderRadius: 14, overflow: 'hidden', border: '1.5px solid #e2e8f0' }}>
            <div style={{ background: '#1e293b', padding: '8px 16px', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{ex.label}</div>
            <div style={{ background: '#0f172a', padding: '18px 20px' }}>
              <pre style={{ margin: 0, fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.65, overflowX: 'auto', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>{ex.code}</pre>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function TrustBandsSection() {
  return (
    <>
      <h2 style={SEC_H2}>Trust bands</h2>
      <p style={{ color: '#6b7280', marginBottom: 20, fontSize: '0.95rem', lineHeight: 1.6 }}>
        Every verification returns a <code style={CODE_INLINE}>trust_band</code>. Use it for access control.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {TRUST_BANDS.map(band => (
          <div key={band.label} style={{ background: '#fff', border: `1.5px solid ${band.color}40`, borderRadius: 14, padding: '18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: band.color, flexShrink: 0 }} />
              <code style={{ fontSize: '0.88rem', fontWeight: 700, color: band.color }}>{band.label}</code>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: 8, fontFamily: 'monospace' }}>score {band.score}</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.5 }}>{band.desc}</div>
          </div>
        ))}
      </div>
    </>
  )
}

function ErrorsSection() {
  return (
    <>
      <h2 style={SEC_H2}>Error codes</h2>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              {['HTTP', 'Error code', 'Description'].map(h => (
                <th key={h} style={{ padding: '11px 16px', textAlign: 'start', fontSize: '0.75rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ERRORS.map((err, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '10px 16px', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.88rem', color: parseInt(err.code) >= 500 ? '#dc2626' : parseInt(err.code) >= 400 ? '#d97706' : '#059669' }}>{err.code}</td>
                <td style={{ padding: '10px 16px' }}><code style={{ fontSize: '0.8rem', color: '#374151', background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{err.name}</code></td>
                <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: '#6b7280' }}>{err.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function LimitsSection() {
  const ROWS = [
    { k: 'Monthly quota', v: 'Per API key, per calendar month — the count is your billed /siteverify calls.' },
    { k: 'Burst', v: '100 requests / minute per key.' },
    { k: 'Reset', v: 'Quota resets at 00:00 UTC on the 1st of each month.' },
    { k: 'On cap', v: '/siteverify returns 429 quota_exceeded once the monthly cap is reached.' },
  ]
  return (
    <>
      <h2 style={SEC_H2}>Rate limits & quotas</h2>
      <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 16 }}>
        Every response carries the current window in its headers:{' '}
        <code style={{ ...CODE_INLINE, fontSize: '0.8rem' }}>X-RateLimit-Limit</code> · <code style={{ ...CODE_INLINE, fontSize: '0.8rem' }}>X-RateLimit-Remaining</code> · <code style={{ ...CODE_INLINE, fontSize: '0.8rem' }}>X-RateLimit-Reset</code>
      </p>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' }}>
        {ROWS.map((r, i) => (
          <div key={r.k} style={{ display: 'flex', gap: 16, padding: '13px 18px', borderBottom: i < ROWS.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
            <div style={{ minWidth: 130, fontWeight: 700, color: '#374151', fontSize: '0.85rem' }}>{r.k}</div>
            <div style={{ fontSize: '0.85rem', color: '#6b7280', lineHeight: 1.5 }}>{r.v}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 16, fontSize: '0.9rem', color: '#6b7280' }}>
        Volume tiers and per-verification pricing live on the{' '}
        <Link href="/pricing" style={{ color: '#7c3aed', fontWeight: 600 }}>Pricing page</Link> — one source of truth.
      </p>
    </>
  )
}

// Shared inline styles
const SEC_H2: React.CSSProperties = { fontSize: '1.4rem', fontWeight: 900, color: '#111827', marginBottom: 8 }
const CODE_INLINE: React.CSSProperties = { background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: '0.85rem' }

// ── Hub cards ────────────────────────────────────────────────────────────────

type SectionId = 'quickstart' | 'privacy' | 'api' | 'captcha' | 'sdk' | 'trust' | 'errors' | 'limits'

const CARDS: Array<{ id: SectionId; icon: string; title: string; desc: string; color: string }> = [
  { id: 'quickstart', icon: '🚀', title: 'Quickstart',        desc: 'Three steps: key → widget → server check', color: '#7c3aed' },
  { id: 'api',        icon: '📘', title: 'API Reference',      desc: 'Every endpoint, request & response shapes',  color: '#2563eb' },
  { id: 'captcha',    icon: '🛡️', title: 'Gesture CAPTCHA',    desc: 'Drop-in draw-a-gesture widget for any form',  color: '#0891b2' },
  { id: 'sdk',        icon: '🧩', title: 'SDK examples',       desc: 'Full flow in cURL, Python, Node.js',         color: '#059669' },
  { id: 'errors',     icon: '⚠️', title: 'Error codes',        desc: 'HTTP statuses and what each one means',       color: '#d97706' },
  { id: 'limits',     icon: '📊', title: 'Rate limits & quotas', desc: 'Per-key monthly volume and pricing tiers', color: '#dc2626' },
  { id: 'privacy',    icon: '🔒', title: 'Privacy & data',     desc: 'What you receive — and never store',          color: '#16a34a' },
  { id: 'trust',      icon: '🏅', title: 'Trust bands',        desc: 'newcomer · community · trusted, for access', color: '#9333ea' },
]

const SECTION_RENDER: Record<SectionId, React.ReactNode> = {
  quickstart: null, // filled in the component (needs translations)
  privacy: <PrivacySection />,
  api: <ApiReferenceSection />,
  captcha: <CaptchaSection />,
  sdk: <SdkSection />,
  trust: <TrustBandsSection />,
  errors: <ErrorsSection />,
  limits: <LimitsSection />,
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function DevelopersPage() {
  const t = useTranslations('developers')
  const features = t.raw('features') as Array<{ icon: string; title: string; desc: string }>
  const [active, setActive] = useState<SectionId | null>(null)

  const openCard = CARDS.find(c => c.id === active)

  function open(id: SectionId) {
    setActive(id)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }
  function back() {
    setActive(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <div style={{ background: 'linear-gradient(135deg, #0c1a2e 0%, #0a2540 100%)', padding: '72px 24px 60px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
        <h1 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, color: '#fff', marginBottom: 16 }}>
          {t('hero_title')}
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.05rem', maxWidth: 520, margin: '0 auto 28px' }}>
          {t('hero_subtitle')}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/console" style={{ padding: '10px 22px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '0.9rem', borderRadius: 10, textDecoration: 'none' }}>
            Get API key →
          </Link>
          <button onClick={() => open('api')} style={{ padding: '10px 22px', background: 'rgba(255,255,255,0.07)', color: '#94a3b8', fontWeight: 600, fontSize: '0.9rem', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer' }}>
            API reference →
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px 64px' }}>

        {active === null ? (
          <>
            {/* ── HUB: card grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18, marginBottom: 56 }}>
              {CARDS.map(c => (
                <button key={c.id} onClick={() => open(c.id)}
                  style={{
                    textAlign: 'start', cursor: 'pointer', background: '#fff', borderRadius: 18,
                    border: '1.5px solid #e2e8f0', borderTop: `4px solid ${c.color}`,
                    padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 10,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)', transition: 'transform .12s, box-shadow .12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.10)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)' }}
                >
                  <div style={{ width: 46, height: 46, borderRadius: 12, background: `${c.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{c.icon}</div>
                  <div style={{ fontWeight: 800, color: '#111827', fontSize: '1.02rem' }}>{c.title}</div>
                  <p style={{ fontSize: '0.85rem', color: '#6b7280', lineHeight: 1.5, margin: 0, flex: 1 }}>{c.desc}</p>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: c.color }}>Open →</span>
                </button>
              ))}
            </div>

            {/* ── FEATURES (context on the hub) ── */}
            <section style={{ marginBottom: 56 }}>
              <h2 style={{ ...SEC_H2, marginBottom: 24 }}>{t('features_title')}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
                {features.map(f => (
                  <div key={f.title} style={{ borderRadius: 16, border: '1.5px solid #e2e8f0', padding: '22px 20px', background: '#fff' }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 12 }}>{f.icon}</div>
                    <div style={{ fontWeight: 700, color: '#111827', marginBottom: 6 }}>{f.title}</div>
                    <p style={{ fontSize: '0.85rem', color: '#6b7280', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ── CTA ── */}
            <div style={{ background: '#0f172a', borderRadius: 22, padding: '40px 32px', textAlign: 'center' }}>
              <h3 style={{ color: '#fff', fontWeight: 900, fontSize: '1.3rem', marginBottom: 12 }}>{t('cta_title')}</h3>
              <p style={{ color: '#64748b', marginBottom: 28 }}>{t('cta_subtitle')}</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <a href="mailto:hello@homosapience.org"
                  style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#7c3aed,#0891b2)', color: '#fff', fontWeight: 700, borderRadius: 12, textDecoration: 'none' }}>
                  {t('cta_email')}
                </a>
                <Link href="/verify"
                  style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', fontWeight: 600, borderRadius: 12, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {t('cta_try')}
                </Link>
                <Link href="/" style={{ padding: '12px 28px', background: 'transparent', color: '#475569', fontWeight: 600, borderRadius: 12, textDecoration: 'none' }}>
                  {t('cta_home')}
                </Link>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* ── SUBPAGE: back bar + one section ── */}
            <button onClick={back} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 24,
              background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 10,
              padding: '8px 16px', fontSize: '0.9rem', fontWeight: 600, color: '#374151', cursor: 'pointer',
            }}>← All sections</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: `${openCard?.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{openCard?.icon}</div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: openCard?.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{openCard?.title}</span>
            </div>

            {active === 'quickstart'
              ? <QuickstartSection title={t('quickstart_title')} subtitle={t('quickstart_subtitle')} />
              : SECTION_RENDER[active]}

            <div style={{ marginTop: 40, textAlign: 'center' }}>
              <button onClick={back} style={{
                background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', border: 'none',
                borderRadius: 10, padding: '10px 24px', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
              }}>← Back to all sections</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
