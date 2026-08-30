'use client'
import Link from 'next/link'
import type { CSSProperties } from 'react'

// ── Static content — intentionally English for developer documentation ─────

const TOKEN_EXAMPLE = `{
  "type": "AgentDelegation",
  "version": "1",
  "delegation_id": "3f8a2c71-...",
  "human_trust_score": 0.95,
  "human_trust_label": "community_verified",
  "agent_id": "my-shopping-assistant",
  "permissions": ["read", "search"],
  "issued_at": 1750000000,
  "expires_at": 1752592000
}`

const STEPS = [
  {
    num: '1',
    title: 'Human verifies',
    color: '#7c3aed',
    body: 'User completes gesture-based proof of humanity at homosapience.org/verify — generates an anonymous Ed25519 DID anchored on Aptos. No ID document, no phone number.',
    code: `# Already verified? Get your session JWT:
POST /api/auth/session
{ "did": "did:key:z6Mk…", "nonce": "<challenge>", "signature": "<ed25519>" }
→ { "token": "<jwt>" }`,
  },
  {
    num: '2',
    title: 'Issue delegation token',
    color: '#0891b2',
    body: 'The verified human calls the delegation API to create a signed token for their agent. The token carries trust metadata — not the DID itself.',
    code: `curl -X POST https://homosapience.org/api/agent/delegate \\
  -H "Authorization: Bearer <session_jwt>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_id": "my-shopping-assistant",
    "permissions": ["read", "search"],
    "expires_in": 2592000
  }'
→ { "delegation_id": "3f8a2c71-…", "token": "<delegation_jwt>", "expires_at": 1752592000 }`,
  },
  {
    num: '3',
    title: 'Agent carries the token',
    color: '#059669',
    body: 'The agent attaches the delegation token to every request to participating sites. Any site can verify it against the public API — no SDK, no contract, no API key.',
    code: `# Agent sends to your site:
Authorization: Bearer <delegation_jwt>

# Your site verifies (public endpoint, no auth required):
GET https://homosapience.org/api/agent/verify?token=<delegation_jwt>
→ {
    "valid": true,
    "human_trust_score": 0.95,
    "human_trust_label": "community_verified",
    "agent_id": "my-shopping-assistant",
    "permissions": ["read", "search"],
    "expires_at": "2026-07-24T10:00:00+00:00"
  }`,
  },
  {
    num: '4',
    title: 'Verified at runtime, not just once',
    color: '#dc2626',
    body: 'Every /api/agent/verify call re-checks expiry and revocation — trust isn’t a one-time stamp. If an agent is compromised or no longer trusted, the human owner revokes the delegation and every subsequent call fails instantly, everywhere. No need to rotate the underlying DID.',
    code: `DELETE https://homosapience.org/api/agent/<delegation_id>
Authorization: Bearer <session_jwt>
→ { "status": "revoked", "delegation_id": "3f8a2c71-…" }

# Subsequent verify calls return:
→ { "valid": false, "reason": "revoked" }`,
  },
]

const DIFF_TABLE = [
  ['Approach',     'Behavioral analysis',         'Human credential'],
  ['Who is trusted?', 'The agent (if it acts right)', 'The human owner (verified)'],
  ['Revocation',   'None (no concept of owner)',  'Instant by human'],
  ['Privacy',      'Behavioral data collected',   'Zero PII — anonymous DID'],
  ['Portable',     'Site-specific only',          'Works on any site'],
  ['Price',        '$100K–$2M/yr enterprise',     'Free API'],
]

export default function AgentPassportPage() {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 80px', fontFamily: 'inherit' }}>

      {/* Hero */}
      <div style={{ marginBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 32 }}>✦</span>
          <span style={{
            fontSize: 12, fontWeight: 700, letterSpacing: 2,
            color: '#7c3aed', textTransform: 'uppercase',
          }}>Agent Passport · HDAA</span>
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.15, marginBottom: 16 }}>
          Human-Delegated<br />Agent Authentication
        </h1>
        <p style={{ fontSize: 18, color: '#4b5563', lineHeight: 1.6, maxWidth: 620 }}>
          Today&apos;s bot detection asks: <em>"how does this agent behave?"</em>
          {' '}We ask a different question:{' '}
          <strong style={{ color: '#111' }}>"who is this agent acting for?"</strong>
        </p>
        <p style={{ fontSize: 16, color: '#6b7280', lineHeight: 1.6, maxWidth: 620, marginTop: 12 }}>
          When a verified human issues a delegation token to their AI agent, any
          third-party site can verify it — without behavioral ML, without a
          $100K enterprise contract, and without storing any PII.
        </p>
      </div>

      {/* Concept diagram */}
      <div style={{
        background: '#f9fafb', border: '1px solid #e5e7eb',
        borderRadius: 12, padding: '24px 28px', marginBottom: 48,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 15 }}>
          {[
            { label: 'Human', icon: '👤', color: '#7c3aed' },
            { label: 'verifies →', icon: '', color: '#6b7280' },
            { label: 'DID', icon: '🔑', color: '#0891b2' },
            { label: 'delegates to →', icon: '', color: '#6b7280' },
            { label: 'Agent', icon: '🤖', color: '#059669' },
            { label: 'presents token to →', icon: '', color: '#6b7280' },
            { label: 'Any site', icon: '🌐', color: '#dc2626' },
          ].map((item, i) => (
            <span key={i} style={{ color: item.color, fontWeight: item.icon ? 700 : 400 }}>
              {item.icon && <span style={{ marginInlineEnd: 4 }}>{item.icon}</span>}
              {item.label}
            </span>
          ))}
        </div>
        <p style={{ marginTop: 12, fontSize: 13, color: '#9ca3af' }}>
          The agent inherits the human&apos;s trust_score. A verified human&apos;s agent passes.
          An anonymous or unverified agent fails.
        </p>
      </div>

      {/* Steps */}
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 28 }}>How it works</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginBottom: 56 }}>
        {STEPS.map(step => (
          <div key={step.num} style={{
            border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
              background: '#fafafa',
            }}>
              <span style={{
                width: 28, height: 28, borderRadius: '50%',
                background: step.color, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, flexShrink: 0,
              }}>{step.num}</span>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{step.title}</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.6, marginBottom: 14 }}>{step.body}</p>
              <pre style={{
                background: '#1e1e2e', color: '#cdd6f4',
                borderRadius: 8, padding: '14px 16px',
                fontSize: 12, lineHeight: 1.65,
                overflowX: 'auto', margin: 0,
              }}>{step.code}</pre>
            </div>
          </div>
        ))}
      </div>

      {/* Token anatomy */}
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Token payload</h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
        A delegation token is a HS256 JWT. The payload contains no PII —
        only trust metadata and permissions. Your site verifies the signature
        once via <code>/api/agent/verify</code>.
      </p>
      <pre style={{
        background: '#1e1e2e', color: '#cdd6f4',
        borderRadius: 8, padding: '20px 24px',
        fontSize: 13, lineHeight: 1.7,
        overflowX: 'auto', marginBottom: 56,
      }}>{TOKEN_EXAMPLE}</pre>

      {/* vs Forrester vendors */}
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
        Different from behavioral analysis
      </h2>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
        Every vendor in the Forrester Wave™ Bot &amp; Agent Trust Management Software
        (Q2 2026) analyzes <em>how the agent behaves</em>. We answer a different question.
      </p>
      <div style={{ overflowX: 'auto', marginBottom: 56 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={th}></th>
              <th style={{ ...th, color: '#dc2626' }}>Wave vendors (DataDome, HUMAN, Kasada…)</th>
              <th style={{ ...th, color: '#7c3aed' }}>APTOGON HDAA</th>
            </tr>
          </thead>
          <tbody>
            {DIFF_TABLE.map(([label, bad, good]) => (
              <tr key={label}>
                <td style={{ ...td, fontWeight: 600 }}>{label}</td>
                <td style={{ ...td, color: '#6b7280' }}>{bad}</td>
                <td style={{ ...td, color: '#16a34a', fontWeight: 500 }}>{good}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CTA */}
      <div style={{
        background: 'linear-gradient(135deg, #7c3aed11, #0891b211)',
        border: '1px solid #7c3aed33',
        borderRadius: 16, padding: '32px 36px', textAlign: 'center',
      }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>
          Get your Agent Passport
        </h3>
        <p style={{ color: '#6b7280', fontSize: 15, marginBottom: 24, maxWidth: 480, margin: '0 auto 24px' }}>
          Verify yourself first — then issue delegation tokens to your AI agents.
          Free API. No account needed beyond verification.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/en/verify" style={btnPrimary}>
            ✦ Verify as human
          </Link>
          <a
            href="https://github.com/tulubyev/homosapience"
            target="_blank"
            rel="noopener noreferrer"
            style={btnSecondary}
          >
            View on GitHub
          </a>
        </div>
        <p style={{ marginTop: 16, fontSize: 12, color: '#9ca3af' }}>
          Open source · AGPL-3.0 · Free API · No waitlist
        </p>
      </div>

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const th: CSSProperties = {
  textAlign: 'start',
  padding: '10px 14px',
  borderBottom: '2px solid #e5e7eb',
  fontWeight: 700,
  fontSize: 13,
  color: '#374151',
}

const td: CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
}

const btnPrimary: CSSProperties = {
  display: 'inline-block',
  padding: '12px 24px',
  background: '#7c3aed',
  color: '#fff',
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 15,
  textDecoration: 'none',
}

const btnSecondary: CSSProperties = {
  display: 'inline-block',
  padding: '12px 24px',
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 15,
  textDecoration: 'none',
}
