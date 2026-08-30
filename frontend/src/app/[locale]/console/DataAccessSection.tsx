'use client'
import { useEffect, useState } from 'react'
import { getDataAccess, type DataAccessState } from '@/lib/researchApi'

export default function DataAccessSection() {
  const [state, setState] = useState<DataAccessState | null>(null)
  useEffect(() => { getDataAccess().then(setState).catch(() => setState(null)) }, [])

  if (!state || !state.available) return null

  const card = (children: React.ReactNode) => (
    <section style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e1e2e', margin: '0 0 12px' }}>📈 Data Access</h2>
      {children}
    </section>
  )

  const req = state.request
  if (!req) {
    return card(
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
        No data-access request yet. Request access on the{' '}
        <a href="/research#request" style={{ color: '#7c3aed' }}>Research page</a>.
      </p>
    )
  }
  if (req.status === 'pending') {
    return card(<p style={{ color: '#92400e', fontSize: 14, margin: 0 }}>⏳ Pending review (suggested level: {req.suggested_level}).</p>)
  }
  if (req.status === 'denied') {
    return card(<p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>Request denied.{req.reason ? ` — ${req.reason}` : ''}</p>)
  }
  // approved
  const pkg = state.package
  const t = pkg?.totals
  return card(
    <>
      <div style={{ marginBottom: 12 }}>
        <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
          ✅ Approved — level: {req.granted_level}
        </span>
      </div>
      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
          {([['Sessions', t.sessions], ['Humans', t.humans], ['Bots', t.bots], ['AI-agents', t.ai_agents], ['Blocked', t.blocked]] as const).map(([label, v]) => (
            <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#1e1e2e' }}>{v.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      {pkg?.signals && pkg.signals.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Top attack signals ({pkg.period_days}d)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pkg.signals.map(s => (
              <span key={s.signal} style={{ background: '#ede9fe', color: '#7c3aed', padding: '3px 9px', borderRadius: 8, fontSize: 12 }}>
                {s.signal} · {s.count}
              </span>
            ))}
          </div>
        </div>
      )}
      <p style={{ fontSize: 11, color: '#9ca3af', margin: '12px 0 0' }}>Window: {pkg?.period_days} days.</p>
    </>
  )
}
