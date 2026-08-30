'use client'
import { useState, useEffect } from 'react'

interface Founder {
  name: string
  role: string
  roles?: string[]
  avatar: string | null
  dids: { short: string; browser: string | null }[]
  device_count: number
  joined: number | null
  online: boolean
  vouches: number
}

const fmtDate = (ts: number | null) =>
  ts ? new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '—'

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')

export default function FoundersClient() {
  const [founders, setFounders] = useState<Founder[] | null>(null)

  useEffect(() => {
    fetch('/api/founders')
      .then(r => r.json())
      .then(d => setFounders(d.founders ?? []))
      .catch(() => setFounders([]))
  }, [])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px', width: '100%', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, color: '#f8fafc', margin: '0 0 6px', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
        🏛 Founders &amp; Council
      </h1>
      <p style={{ color: '#94a3b8', fontSize: 15, margin: '0 0 28px', maxWidth: 640, lineHeight: 1.6 }}>
        The named humans who back the network. Unlike regular verified users — who stay anonymous —
        founders and Gold members are public by choice, vouching for newcomers with their own reputation.
      </p>

      {founders === null ? (
        <p style={{ color: '#cbd5e1' }}>Loading…</p>
      ) : founders.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: 32, textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🏛</div>
          <p style={{ margin: 0, fontSize: 15 }}>No founders listed yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {founders.map((f, i) => {
            const isAdmin = f.role === 'admin'
            return (
              <div key={i} style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: '18px 18px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {f.avatar ? (
                    <img src={f.avatar} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 17, color: '#fff', background: isAdmin ? 'linear-gradient(135deg,#7c3aed,#2563eb)' : 'linear-gradient(135deg,#d97706,#f59e0b)' }}>
                      {initials(f.name)}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>{f.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      {(f.roles && f.roles.length ? f.roles : [f.role]).map(role => {
                        const adm = role === 'admin'
                        return (
                          <span key={role} style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 99, color: adm ? '#5b21b6' : '#b45309', background: adm ? '#ede9fe' : '#fef9c3' }}>
                            {adm ? '⚙️ Admin' : '👑 Gold'}
                          </span>
                        )
                      })}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: f.online ? '#16a34a' : '#94a3b8' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.online ? '#22c55e' : '#cbd5e1', display: 'inline-block' }} />
                        {f.online ? 'online' : 'offline'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 18, paddingTop: 4 }}>
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 900, color: '#0891b2' }}>{f.vouches.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>vouches given</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 900, color: '#0f172a' }}>{f.device_count}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>device{f.device_count > 1 ? 's' : ''}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 4 }}>{fmtDate(f.joined)}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>since</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                  {f.dids.map((d, j) => (
                    <code key={j} title={d.browser || undefined} style={{ fontSize: 11, fontFamily: 'monospace', background: '#f1f5f9', color: '#475569', padding: '2px 7px', borderRadius: 5, letterSpacing: '0.04em' }}>
                      …{d.short}
                    </code>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
