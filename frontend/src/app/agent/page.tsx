'use client'
import { useState } from 'react'
import { delegateAgent, verifyAgent, revokeAgent, type VerifyResult } from './actions'

type Step = 'idle' | 'delegated' | 'revoked'

export default function CartPilotDemoPage() {
  const [step, setStep] = useState<Step>('idle')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [delegationId, setDelegationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VerifyResult | null>(null)

  async function onDelegate() {
    setBusy(true); setError(null)
    const r = await delegateAgent()
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setToken(r.token); setDelegationId(r.delegation_id); setStep('delegated'); setResult(null)
  }

  async function onSimulate() {
    if (!token) return
    setBusy(true); setError(null)
    const r = await verifyAgent(token)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setResult(r)
  }

  async function onRevoke() {
    if (!delegationId) return
    setBusy(true); setError(null)
    const r = await revokeAgent(delegationId)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setStep('revoked')
  }

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif', color: '#1e293b' }}>

      {/* ── HEADER ── */}
      <header style={{ background: '#111827', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }}>🛒</span>
        <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#fff' }}>CartPilot</span>
        <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginLeft: 4 }}>marketplace demo</span>
      </header>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px 64px' }}>

        {/* ── INTRO ── */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'inline-block', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 99, padding: '4px 14px', marginBottom: 16, fontSize: 11, fontWeight: 700, color: '#92400e', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            HDAA live demo
          </div>
          <h1 style={{ fontSize: 'clamp(1.5rem,4vw,2rem)', fontWeight: 900, margin: '0 0 12px', lineHeight: 1.25 }}>
            CartPilot only lets AI agents act with a valid delegation
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.65, margin: 0 }}>
            This is a real, independent site — it doesn&apos;t belong to APTOGON. It only trusts
            an AI shopping agent (&quot;ShopBot&quot;) if that agent presents a valid{' '}
            <a href="https://homosapience.org/agent-passport" style={{ color: '#7c3aed', fontWeight: 700, textDecoration: 'none' }}>
              Human-Delegated Agent Authentication
            </a>{' '}token — issued by a verified human on homosapience.org, checked live on every
            request, right here.
          </p>
        </div>

        {/* ── STEP 1: DELEGATE ── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: '3px solid #7c3aed', borderRadius: 16, padding: '24px 22px', marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Step 1</div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 8px' }}>A verified human delegates to ShopBot</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 16px', lineHeight: 1.6 }}>
            A verified human on homosapience.org issues a signed, expiring delegation token to
            their shopping agent — <code>agent_id: &quot;my-shopping-assistant&quot;</code>,
            permissions <code>read</code> + <code>search</code>.
          </p>
          <button onClick={onDelegate} disabled={busy || step !== 'idle'} style={btnStyle('#7c3aed')}>
            {step === 'idle' ? 'Delegate to ShopBot →' : '✓ Delegated'}
          </button>
          {token && (
            <div style={{ marginTop: 14, background: '#0f172a', borderRadius: 10, padding: '12px 14px', fontFamily: 'monospace', fontSize: '0.7rem', color: '#a5b4fc', overflowX: 'auto', wordBreak: 'break-all' }}>
              {token}
            </div>
          )}
        </div>

        {/* ── STEP 2: SIMULATE ── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: '3px solid #0891b2', borderRadius: 16, padding: '24px 22px', marginBottom: 16, opacity: token ? 1 : 0.5 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Step 2</div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 8px' }}>ShopBot tries to post a review on CartPilot</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 16px', lineHeight: 1.6 }}>
            Every time ShopBot acts, CartPilot calls the public{' '}
            <code>GET /api/agent/verify</code> live — no API key, no contract with APTOGON.
            Click this as many times as you like, whenever you like.
          </p>
          <button onClick={onSimulate} disabled={busy || !token} style={btnStyle('#0891b2')}>
            Simulate: ShopBot tries to post a review →
          </button>
          {result?.ok && result.valid && (
            <div style={{ marginTop: 14, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontWeight: 800, color: '#15803d', marginBottom: 6 }}>✅ Verified</div>
              <div style={{ fontSize: '0.82rem', color: '#166534', lineHeight: 1.6 }}>
                human trust: <b>{result.human_trust_label}</b> ({result.human_trust_score}) ·
                agent: <b>{result.agent_id}</b> · permissions: <b>{result.permissions.join(', ')}</b>
              </div>
            </div>
          )}
          {result?.ok && !result.valid && (
            <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontWeight: 800, color: '#dc2626', marginBottom: 6 }}>❌ Rejected</div>
              <div style={{ fontSize: '0.82rem', color: '#991b1b' }}>reason: <b>{result.reason}</b></div>
            </div>
          )}
        </div>

        {/* ── STEP 3: REVOKE ── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: '3px solid #dc2626', borderRadius: 16, padding: '24px 22px', marginBottom: 16, opacity: token && step !== 'revoked' ? 1 : 0.5 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Step 3</div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 8px' }}>The human revokes ShopBot&apos;s access</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 16px', lineHeight: 1.6 }}>
            One click, and every subsequent verify call — on CartPilot or anywhere else — fails
            instantly. Trust isn&apos;t a one-time stamp; it&apos;s checked live on every call.
          </p>
          <button onClick={onRevoke} disabled={busy || !token || step === 'revoked'} style={btnStyle('#dc2626')}>
            {step === 'revoked' ? '✓ Revoked' : "Revoke ShopBot's access →"}
          </button>
          {step === 'revoked' && (
            <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#6b7280' }}>
              Now go back to Step 2 and click &quot;Simulate&quot; again — it fails instantly.
            </p>
          )}
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', fontSize: '0.85rem', color: '#991b1b', marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* ── HONESTY CALLOUT ── */}
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '18px 20px', marginTop: 32 }}>
          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#92400e', marginBottom: 6 }}>Honest limitation</div>
          <p style={{ fontSize: '0.82rem', color: '#78350f', lineHeight: 1.65, margin: 0 }}>
            The delegation token above is a bearer credential — like an API key, whoever holds
            the string can present it, with no binding to a specific device or agent instance.
            That&apos;s exactly why the instant, every-call revocation check in Step 3 matters:
            it bounds how long a leaked token stays useful, rather than pretending theft is
            impossible.
          </p>
        </div>

        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <a href="https://homosapience.org/agent-passport" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#7c3aed', textDecoration: 'none' }}>
            ← Read the full HDAA developer guide on homosapience.org
          </a>
        </div>
      </div>
    </div>
  )
}

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '12px 24px', background: color, color: '#fff', fontWeight: 700,
    fontSize: '0.88rem', borderRadius: 10, border: 'none', cursor: 'pointer',
  }
}
