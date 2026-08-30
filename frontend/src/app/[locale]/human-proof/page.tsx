'use client'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useSearchParams } from 'next/navigation'
import { verifyHumanityProof, type ProofResult } from '@/lib/agentApi'

// Public viewer for an anonymous humanity proof (Shielded Human).
// A reader opens this link to confirm "the pseudonym behind this post is a verified
// human" — without ever learning who. No DID is shown; nothing is enumerable.

export default function HumanProofPage() {
  const params = useSearchParams()
  const token = params?.get('token') ?? ''
  const [result, setResult] = useState<ProofResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    verifyHumanityProof(token).then(r => { setResult(r); setLoading(false) })
  }, [token])

  const card: CSSProperties = {
    maxWidth: 460, margin: '60px auto', padding: '32px 28px',
    border: '1px solid #e5e7eb', borderRadius: 16, fontFamily: 'inherit', textAlign: 'center',
  }

  if (!token) {
    return <div style={card}><p style={{ color: '#6b7280' }}>No proof token provided.</p></div>
  }
  if (loading) {
    return <div style={card}><p style={{ color: '#6b7280' }}>Verifying…</p></div>
  }

  const ok = result?.valid
  return (
    <div style={card}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>{ok ? '✦' : '⚠️'}</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: ok ? '#16a34a' : '#dc2626' }}>
        {ok ? 'Verified human' : 'Not valid'}
      </h1>
      {ok ? (
        <>
          <p style={{ fontSize: 14, color: '#4b5563', marginBottom: 20 }}>
            The pseudonym <strong>{result?.agent_id}</strong> is backed by a verified human.
            Their identity is not revealed — only that a real person stands behind it.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'start' }}>
            <Field label="Pseudonym" value={result?.agent_id ?? '—'} />
            <Field label="Trust" value={result?.human_trust_label ?? '—'} />
            <Field label="Trust score" value={result?.human_trust_score?.toFixed(2) ?? '—'} />
            <Field label="Valid until" value={result?.expires_at?.slice(0, 10) ?? '—'} />
          </div>
        </>
      ) : (
        <p style={{ fontSize: 14, color: '#6b7280' }}>
          Reason: {result?.reason ?? 'unknown'}. This proof is expired, revoked, or invalid.
        </p>
      )}
      <p style={{ marginTop: 24, fontSize: 11, color: '#9ca3af' }}>
        Anonymous humanity proof · no DID, no personal data · homosapience.org
      </p>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 10, padding: '8px 12px', border: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#111', wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}
