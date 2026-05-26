'use client'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { GestureCanvas, TouchEventData, ChallengeResult } from '@/components/GestureCanvas'
import { runEmbedAssert } from '@/lib/embedSigner'

type Stage = 'loading' | 'gesture' | 'signing' | 'done' | 'error'

function post(result: Record<string, unknown>, origin: string) {
  if (window.opener) {
    window.opener.postMessage({ type: 'aptogon:result', ...result }, origin)
  }
}

function SignerInner() {
  const params = useSearchParams()
  const pk = params.get('pk') || ''
  const origin = params.get('origin') || ''
  const [stage, setStage] = useState<Stage>('loading')
  const [msg, setMsg] = useState('Checking your credential…')
  const startedRef = useRef(false)

  // Silent path: credential present → sign immediately.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (!pk || !origin) {
      setStage('error'); setMsg('Missing pk or origin'); post({ error: 'invalid_request' }, origin || '*')
      return
    }
    const did = localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did')
    const key = localStorage.getItem('aptogon_key')
    if (did && key) {
      setStage('signing'); setMsg('Signing…')
      runEmbedAssert(pk, origin, did, key)
        .then(res => {
          if (res.token) { post({ token: res.token, trust_band: res.trust_band }, origin); setStage('done'); setMsg('Verified — you can close this window.'); setTimeout(() => window.close(), 600) }
          else { setStage('gesture'); setMsg('') } // credential invalid/expired → gesture
        })
        .catch(() => { setStage('gesture'); setMsg('') })
    } else {
      setStage('gesture'); setMsg('')
    }
  }, [pk, origin])

  // New-user path: gesture → credential → sign.
  const onGesture = async (events: TouchEventData[], challenges: ChallengeResult[]) => {
    setStage('signing'); setMsg('Verifying you are human…')
    try {
      const vr = await fetch('/api/verify/expression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events,
          session_id: crypto.randomUUID(),
          challenges: challenges.length ? challenges.map(c => ({
            dot_x: c.dot_x, dot_y: c.dot_y, shown_at_ms: c.shown_at_ms,
            reaction_ms: c.reaction_ms, tap_x: c.tap_x, tap_y: c.tap_y, color: c.color,
          })) : null,
        }),
      })
      const data = await vr.json()
      if (!vr.ok || !data.passed || !data.did) {
        setStage('error'); setMsg('Verification failed. Please try again.'); post({ error: 'verification_failed' }, origin)
        return
      }
      localStorage.setItem('aptogon_did', data.did)
      localStorage.setItem('hsi_did', data.did)
      if (data.private_key_b64) localStorage.setItem('aptogon_key', data.private_key_b64)
      const res = await runEmbedAssert(pk, origin, data.did, data.private_key_b64)
      if (res.token) { post({ token: res.token, trust_band: res.trust_band }, origin); setStage('done'); setMsg('Verified — you can close this window.'); setTimeout(() => window.close(), 600) }
      else { setStage('error'); setMsg('Could not issue token.'); post({ error: 'assert_failed' }, origin) }
    } catch {
      setStage('error'); setMsg('Network error.'); post({ error: 'network' }, origin)
    }
  }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: 20, maxWidth: 440, margin: '0 auto', textAlign: 'center' }}>
      <h2 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>APTOGON — Prove you're human</h2>
      {stage === 'gesture'
        ? <>
            <p style={{ fontSize: 13, color: '#64748b' }}>Draw any gesture for ~8 seconds. Tap the coloured dot when it appears.</p>
            <GestureCanvas onComplete={onGesture} />
          </>
        : <p style={{ fontSize: 14, color: stage === 'error' ? '#dc2626' : '#475569', marginTop: 40 }}>{msg}</p>}
    </div>
  )
}

export default function SignerPage() {
  return (
    <Suspense fallback={<p style={{ padding: 20 }}>Loading…</p>}>
      <SignerInner />
    </Suspense>
  )
}
