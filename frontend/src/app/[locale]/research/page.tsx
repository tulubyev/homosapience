'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import {
  ATTACK_CLASSES, CAPABILITIES, COMPETITORS, DISCLAIMER, type Cell,
} from './data'
import { submitDataRequest } from '@/lib/researchApi'

interface Totals {
  sessions: number; humans: number; bots: number
  ai_agents: number; suspicious: number; blocked: number
}
interface Summary { available: boolean; period_days?: number; totals?: Totals }

const CELL: Record<Cell, { sym: string; color: string }> = {
  yes:     { sym: '✓', color: '#16a34a' },
  partial: { sym: '~', color: '#d97706' },
  no:      { sym: '✗', color: '#dc2626' },
  na:      { sym: '—', color: '#9ca3af' },
}

// For columns where "no" is the good outcome (biometrics_stored, docs_required)
const CELL_INVERTED: Record<Cell, { sym: string; color: string }> = {
  yes:     { sym: '✓', color: '#dc2626' },
  partial: { sym: '~', color: '#d97706' },
  no:      { sym: '✗', color: '#16a34a' },
  na:      { sym: '—', color: '#9ca3af' },
}

const INVERTED_COLS = new Set(['biometrics_stored', 'docs_required'])

export default function ResearchPage() {
  const [data, setData] = useState<Summary | null>(null)
  useEffect(() => {
    fetch('/api/research/summary?days=90')
      .then(r => (r.ok ? r.json() : { available: false }))
      .then(setData)
      .catch(() => setData({ available: false }))
  }, [])

  const [did, setDid] = useState<string | null>(null)
  useEffect(() => { setDid(localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did')) }, [])
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '' })
  const [reqState, setReqState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  async function submitReq() {
    if (!form.name.trim() || !form.company.trim() || !form.email.trim()) return
    setReqState('sending')
    try { await submitDataRequest(form); setReqState('done') }
    catch { setReqState('error') }
  }

  const wrap = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#f8fafc', width: '100%' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px', boxSizing: 'border-box' }}>
        <h1 style={{ fontSize: 30, fontWeight: 900, color: '#7c3aed', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
          🔬 Research &amp; Benchmark
        </h1>
        {children}
      </div>
    </div>
  )

  if (!data) return wrap(<p style={{ color: '#9ca3af' }}>Loading…</p>)

  if (!data.available) {
    return wrap(
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 32, textAlign: 'center', color: '#6b7280', marginTop: 16 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔬</div>
        <p style={{ margin: 0, fontSize: 15 }}>Research page — coming soon.</p>
      </div>
    )
  }

  const t = data.totals
  const sessions = t?.sessions ?? 0
  const botPct = t && sessions > 0
    ? Math.round(((t.bots + t.ai_agents) / sessions) * 100)
    : 0

  const sectionTitle = (s: string) => (
    <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1e1e2e', margin: '36px 0 14px' }}>{s}</h2>
  )

  return wrap(
    <>
      <p style={{ color: '#6b7280', fontSize: 15, lineHeight: 1.6, margin: '0 0 8px' }}>
        How APTOGON verifies a unique human and detects bots — and how that compares,
        methodologically, to other approaches.
      </p>
      <p style={{ color: '#9ca3af', fontSize: 12, lineHeight: 1.5, margin: '0 0 8px' }}>
        {DISCLAIMER}
      </p>

      {/* The Problem */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', borderRadius: 16, padding: '28px 28px 24px', margin: '24px 0' }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 6 }}>
          The internet has a bot problem.
        </div>
        <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24, lineHeight: 1.5 }}>
          Bots are getting smarter. CAPTCHA is broken. KYC is invasive and expensive.
          The only real solution: verify the human at the source.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[
            { stat: '40%', label: 'of internet traffic is bots', src: 'Imperva Bot Report' },
            { stat: '$600B+', label: 'lost to online fraud yearly', src: 'Cybersecurity Ventures' },
            { stat: '20–30%', label: 'survey budgets lost to duplicates', src: 'Industry estimates' },
            { stat: '~10 sec', label: 'APTOGON verification time', src: 'Our own data' },
          ].map(({ stat, label, src }) => (
            <div key={stat} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#a78bfa', marginBottom: 4 }}>{stat}</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{src}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology / bot detection */}
      {sectionTitle('Methodology — attack classes & detection')}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
        {ATTACK_CLASSES.map(a => (
          <div key={a.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, color: '#1e1e2e', marginBottom: 6 }}>{a.name}</div>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px', lineHeight: 1.5 }}>{a.what}</p>
            <p style={{ fontSize: 13, color: '#374151', margin: 0, lineHeight: 1.5 }}>
              <strong style={{ color: '#7c3aed' }}>APTOGON:</strong> {a.aptogon}
            </p>
          </div>
        ))}
      </div>

      {/* Comparison table — providers as columns, capabilities as rows */}
      {sectionTitle('Capability comparison')}
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '10px 14px', textAlign: 'start', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', minWidth: 160, background: '#f8fafc' }}>
                Capability
              </th>
              {COMPETITORS.map(prov => (
                <th key={prov.name} style={{
                  padding: '10px 12px', textAlign: 'center', fontSize: 11, fontWeight: 800,
                  color: prov.name === 'APTOGON' ? '#7c3aed' : '#374151',
                  background: prov.name === 'APTOGON' ? '#f5f3ff' : '#f8fafc',
                  whiteSpace: 'nowrap', minWidth: 100,
                }}>
                  {prov.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((cap, i) => (
              <tr key={cap.id} style={{
                borderBottom: '1px solid #f1f5f9',
                background: cap.highlight ? '#fdfcff' : i % 2 === 0 ? '#fff' : '#fafafa',
              }}>
                <td style={{
                  padding: '9px 14px', fontWeight: cap.highlight ? 700 : 500,
                  color: cap.highlight ? '#7c3aed' : '#374151', whiteSpace: 'nowrap',
                }}>
                  {cap.label}
                </td>
                {COMPETITORS.map(prov => {
                  const val = prov.values[cap.id] ?? 'na'
                  const cell = INVERTED_COLS.has(cap.id) ? CELL_INVERTED[val] : CELL[val]
                  return (
                    <td key={prov.name} style={{
                      padding: '9px 12px', textAlign: 'center', fontWeight: 800, fontSize: 15,
                      color: cell.color,
                      background: prov.name === 'APTOGON' ? '#f5f3ff' : undefined,
                    }}>
                      {cell.sym}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Provider notes */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {COMPETITORS.map(prov => prov.note ? (
          <div key={prov.name} style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
            <strong style={{ color: prov.name === 'APTOGON' ? '#7c3aed' : '#6b7280' }}>{prov.name}:</strong>{' '}{prov.note}
          </div>
        ) : null)}
      </div>

      {/* Sybil-resistance */}
      {sectionTitle('Why Sybil-resistance is the differentiator')}
      <div style={{ background: '#f5f3ff', borderRadius: 12, border: '1px solid #ddd6fe', padding: '18px 20px' }}>
        <p style={{ fontSize: 14, color: '#374151', margin: 0, lineHeight: 1.6 }}>
          Bot detectors answer one question: <em>“is this session a bot?”</em> APTOGON answers a
          stronger one: <strong>“is this a unique human — and here is portable proof.”</strong>{' '}
          The verification yields an anonymous DID and a signed, on-chain-anchored assertion the
          user can reuse across sites, without revealing identity. Per-session bot scores cannot
          provide that.
        </p>
      </div>

      {/* Live counter */}
      {sectionTitle('Live — our own data')}
      <div style={{ background: '#0f172a', borderRadius: 12, padding: '24px 26px', color: '#fff' }}>
        {sessions > 0 ? (
          <>
            <div style={{ fontSize: 30, fontWeight: 900 }}>{sessions.toLocaleString()}</div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
              sessions analyzed over the last {data.period_days} days
            </div>
            <div style={{ fontSize: 15, color: '#a5f3fc', fontWeight: 700 }}>
              {botPct}% classified bot / AI-agent
            </div>
          </>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Live stats warming up — 0 sessions analyzed yet.</div>
        )}
      </div>

      {/* Data-access request (R6.3) */}
      <div id="request" style={{ marginTop: 28, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '20px 22px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1e1e2e', margin: '0 0 6px' }}>Request data access</h2>
        {!did ? (
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
            Verify with APTOGON first, then request access from this page.{' '}
            <a href="/verify" style={{ color: '#7c3aed' }}>Verify →</a>
          </p>
        ) : reqState === 'done' ? (
          <p style={{ fontSize: 14, color: '#166534', margin: 0 }}>
            ✅ Request received — pending review. Track its status in your console.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 12px' }}>
              Verified users can request our statistical data. Access level is set from your profile and reviewed by an admin.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {([['name', 'Name *'], ['company', 'Company *'], ['email', 'Email *'], ['phone', 'Phone (optional)']] as const).map(([k, label]) => (
                <input key={k} value={form[k]} placeholder={label}
                  onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                  style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: 13 }} />
              ))}
            </div>
            <button onClick={submitReq} disabled={reqState === 'sending'}
              style={{ marginTop: 12, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, fontSize: 14, cursor: reqState === 'sending' ? 'not-allowed' : 'pointer' }}>
              {reqState === 'sending' ? 'Sending…' : 'Request access →'}
            </button>
            {reqState === 'error' && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>Submit failed — try again.</p>}
          </>
        )}
      </div>
    </>
  )
}
