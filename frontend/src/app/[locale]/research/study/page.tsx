'use client'
export const dynamic = 'force-dynamic'

/**
 * Consented gesture-similarity study.
 *
 * A volunteer picks a pseudonym and draws several gestures so we can measure
 * whether one person draws consistently enough to tell them apart from someone
 * else. Deliberately NOT part of the production verification flow: those rows
 * carry no person key by design, and this one does — which is exactly why it
 * lives behind a study code, on its own table, with the consent spelled out on
 * screen before anything is recorded.
 */
import { useState } from 'react'
import { GestureCanvas, DEFAULT_LABELS, type TouchEventData } from '@/components/GestureCanvas'

const TARGET = 6   // gestures per volunteer — enough for within-person spread

type Phase = 'intro' | 'drawing' | 'done'

export default function GestureStudyPage() {
  const [phase, setPhase]   = useState<Phase>('intro')
  const [code, setCode]     = useState('')
  const [label, setLabel]   = useState('')
  const [done, setDone]     = useState(0)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)   // remount key to reset the canvas

  const labelOk = /^[A-Za-z0-9_-]{2,32}$/.test(label.trim())

  const onGesture = async (events: TouchEventData[]) => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/research/study/gesture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          study_code: code.trim(),
          subject_label: label.trim(),
          seq: done,
          events,
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        setError(body?.detail?.message ?? `Submission failed (${r.status})`)
        setAttempt(a => a + 1)
        return
      }
      const next = done + 1
      setDone(next)
      if (next >= TARGET) setPhase('done')
      else setAttempt(a => a + 1)   // fresh canvas for the next gesture
    } catch {
      setError('Network error — nothing was recorded. Try again.')
      setAttempt(a => a + 1)
    } finally {
      setBusy(false)
    }
  }

  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 20, padding: 28,
    border: '2px solid rgba(124,58,237,0.15)', maxWidth: 620, margin: '0 auto',
  }

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 620, margin: '0 auto 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', margin: '0 0 6px' }}>
          🔬 Gesture study
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
          Research on whether a person draws consistently enough to be told apart
          from someone else. Invitation only.
        </p>
      </div>

      {phase === 'intro' && (
        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', marginTop: 0 }}>
            What is recorded, and what is not
          </h2>
          <ul style={{ fontSize: 13, color: '#475569', lineHeight: 1.8, paddingLeft: 18, marginTop: 8 }}>
            <li>You draw <strong>{TARGET} gestures</strong>. It takes a couple of minutes.</li>
            <li>We store <strong>statistics of the movement</strong> — speed variation, pauses,
                rhythm, corrections. The drawing itself and its coordinates are
                discarded and never leave your browser.</li>
            <li>Your gestures are grouped under a <strong>pseudonym you invent</strong>. Pick
                something unrelated to you — it is a grouping key, not a name.</li>
            <li>This is a <strong>separate research dataset</strong>. It is not the ordinary
                verification flow and is not linked to any account or DID.</li>
            <li>Nothing is recorded until you press the button below.</li>
          </ul>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155', marginTop: 16 }}>
            Study code
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="given to you with the invitation"
              style={{ width: '100%', marginTop: 5, padding: '9px 11px', borderRadius: 9, border: '1px solid #e2e8f0', fontSize: 13, background: '#f8fafc', color: '#0f172a' }}
            />
          </label>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155', marginTop: 12 }}>
            Your pseudonym
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. blue-otter"
              style={{ width: '100%', marginTop: 5, padding: '9px 11px', borderRadius: 9, border: '1px solid #e2e8f0', fontSize: 13, background: '#f8fafc', color: '#0f172a' }}
            />
            {label && !labelOk && (
              <span style={{ fontSize: 11, color: '#b91c1c', display: 'block', marginTop: 4 }}>
                2–32 characters: letters, digits, - or _
              </span>
            )}
          </label>

          <button
            disabled={!labelOk || !code.trim()}
            onClick={() => setPhase('drawing')}
            style={{
              width: '100%', marginTop: 18, padding: '12px 18px', borderRadius: 11, border: 'none',
              background: (!labelOk || !code.trim()) ? '#cbd5e1' : 'linear-gradient(135deg,#7c3aed,#2563eb)',
              color: '#fff', fontWeight: 800, fontSize: 14,
              cursor: (!labelOk || !code.trim()) ? 'not-allowed' : 'pointer',
            }}
          >
            I understand — start drawing
          </button>
        </div>
      )}

      {phase === 'drawing' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              Gesture {Math.min(done + 1, TARGET)} of {TARGET}
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>as <code>{label}</code></span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
            {Array.from({ length: TARGET }).map((_, i) => (
              <div key={i} style={{ height: 6, flex: 1, borderRadius: 99, background: i < done ? '#22c55e' : '#e2e8f0' }} />
            ))}
          </div>

          <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginTop: 0 }}>
            Draw naturally — the same way each time, whatever feels normal to you.
            Pausing or lifting your finger is fine.
          </p>

          <GestureCanvas key={attempt} onComplete={onGesture} disabled={busy} labels={DEFAULT_LABELS} />

          {busy && <p style={{ fontSize: 12, color: '#7c3aed', marginTop: 10 }}>Saving…</p>}
          {error && (
            <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 10, padding: '8px 11px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 9 }}>
              {error}
            </p>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>✓</div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', margin: '8px 0' }}>
            All {TARGET} recorded — thank you
          </h2>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, margin: 0 }}>
            Your gestures are stored as movement statistics under
            {' '}<code>{label}</code>{' '}and nothing else. You can close this page.
          </p>
        </div>
      )}
    </div>
  )
}
