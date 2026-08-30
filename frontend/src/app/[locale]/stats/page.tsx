'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

interface Totals {
  sessions: number
  humans: number
  bots: number
  ai_agents: number
  suspicious: number
  blocked: number
}

interface DayRow extends Totals {
  day: string
}

interface Community {
  requests_total: number
  requests_approved: number
  requests_pending: number
  requests_failed: number
  approvals_total: number
  rejections_total: number
  gold_total: number
  gold_online: number
  gold_cap?: number
  test?: boolean
}

interface StatsResponse {
  available: boolean
  message?: string
  period_days?: number
  totals?: Totals
  by_day?: DayRow[]
  community?: Community
  generated_at?: number
}

export default function StatsPage() {
  const t = useTranslations('stats')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/risk/stats?days=${days}`)
      setData(r.ok ? await r.json() : { available: false, message: t('service_down') })
    } catch {
      setData({ available: false, message: t('net_error') })
    }
    setLoading(false)
  }, [days, t])

  useEffect(() => { load() }, [load])

  // Page sits on the global dark body (--hsi-dark #0a0e1a): the heading and
  // subtitle use light colors so they stay readable; the data cards have their
  // own white background, so their numbers keep dark accent colors.
  const wrap = (children: React.ReactNode) => (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 20px', width: '100%', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: '#f8fafc', margin: '0 0 6px', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
        🛡 {t('title')}
      </h1>
      <p style={{ color: '#94a3b8', fontSize: 15, margin: '0 0 24px' }}>
        {t('subtitle')}
      </p>
      {children}
    </div>
  )

  if (loading) return wrap(<p style={{ color: '#cbd5e1' }}>{t('loading')}</p>)

  if (!data?.available) {
    return wrap(
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '32px', textAlign: 'center', color: '#6b7280' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
        <p style={{ margin: 0, fontSize: 15 }}>{data?.message ?? t('unavailable')}</p>
      </div>
    )
  }

  const tot = data.totals!
  const pct = (n: number) => (tot.sessions > 0 ? Math.round((n / tot.sessions) * 100) : 0)
  const cards = [
    { label: t('card_sessions'),   value: tot.sessions,   color: '#1e1e2e', isSessions: true },
    { label: t('card_humans'),     value: tot.humans,     color: '#16a34a' },
    { label: t('card_bots'),       value: tot.bots,       color: '#dc2626' },
    { label: t('card_ai'),         value: tot.ai_agents,  color: '#7c3aed', accent: true },
    { label: t('card_suspicious'), value: tot.suspicious, color: '#f59e0b' },
    { label: t('card_blocked'),    value: tot.blocked,    color: '#dc2626' },
  ]

  const byDay = (data.by_day ?? []).slice().reverse()
  const maxDay = Math.max(1, ...byDay.map(d => d.sessions))

  return wrap(
    <>
      {/* Period selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              background: days === d ? '#7c3aed' : '#f3f4f6',
              color: days === d ? '#fff' : '#374151',
              border: 'none', borderRadius: 6, padding: '6px 14px',
              cursor: 'pointer', fontSize: 13, fontWeight: days === d ? 600 : 400,
            }}
          >
            {d} {t('day_unit')}
          </button>
        ))}
      </div>

      {/* Totals grid — 6 columns on desktop, 3 on mobile */}
      <style>{`.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px}@media(min-width:600px){.stats-grid{grid-template-columns:repeat(6,1fr)}}`}</style>
      <div className="stats-grid">
        {cards.map(({ label, value, color, accent, isSessions }) => (
          <div key={label} style={{
            background: '#fff', borderRadius: 10,
            border: accent ? '2px solid #7c3aed' : '1px solid #e5e7eb',
            padding: '11px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color }}>{value.toLocaleString()}</div>
            {!isSessions && (
              <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 1 }}>{pct(value)}%</div>
            )}
          </div>
        ))}
      </div>

      {/* By-day chart */}
      {byDay.length > 0 && (() => {
        // Show date labels every N bars so max ~7 labels appear
        const labelEvery = Math.ceil(byDay.length / 7)
        const fmtDay = (iso: string) => {
          const [, m, d] = iso.split('-')
          return `${d}.${m}`
        }
        return (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              {t('chart_title', { count: byDay.length })}
            </div>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
              {byDay.map(d => (
                <div key={d.day} title={`${d.day}: ${d.sessions} total · ${d.bots + d.ai_agents} ${t('legend_bots')}`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ background: '#dc2626', height: `${((d.bots + d.ai_agents) / maxDay) * 100}%`, borderRadius: '2px 2px 0 0' }} />
                  <div style={{ background: '#7c3aed', opacity: 0.6, height: `${(d.humans / maxDay) * 100}%` }} />
                </div>
              ))}
            </div>
            {/* X-axis date labels */}
            <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
              {byDay.map((d, i) => (
                <div key={d.day} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: '#94a3b8', overflow: 'hidden' }}>
                  {i % labelEvery === 0 ? fmtDay(d.day) : ''}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: '#6b7280' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#dc2626', borderRadius: 2, marginInlineEnd: 4 }} />{t('legend_bots')}</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#7c3aed', opacity: 0.6, borderRadius: 2, marginInlineEnd: 4 }} />{t('legend_humans')}</span>
            </div>
          </div>
        )
      })()}

      {/* ── Vouching (HSI Bond) + Gold Members ── */}
      {data.community && (() => {
        const c = data.community!
        // Sub-card: a small labelled number used to break a card's value down.
        const sub = (label: string, value: number, color: string) => (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 900, color }}>{value.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{label}</div>
          </div>
        )
        return (
          <div style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc', margin: '0 0 14px', textShadow: '0 1px 2px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              🤝 {t('community_title')}
              {c.test && (
                <span title={t('test_note')} style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)',
                  borderRadius: 999, padding: '2px 10px', textShadow: 'none',
                }}>
                  🧪 {t('test_badge')}
                </span>
              )}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>

              {/* Vouching requests + outcomes */}
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                  {t('vouch_requests')}
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#1e1e2e', marginBottom: 14 }}>{c.requests_total.toLocaleString()}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                  {sub(t('vouch_approved'), c.requests_approved, '#16a34a')}
                  {sub(t('vouch_pending'),  c.requests_pending,  '#f59e0b')}
                  {sub(t('vouch_failed'),   c.requests_failed,   '#dc2626')}
                </div>
              </div>

              {/* Individual vouches given / declined */}
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                  🗳 {t('vouches_given')}
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#16a34a', marginBottom: 14 }}>{c.approvals_total.toLocaleString()}</div>
                <div style={{ paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                  {sub(t('vouches_declined'), c.rejections_total, '#dc2626')}
                </div>
              </div>

              {/* Gold Members + online */}
              <div style={{ background: 'linear-gradient(135deg,#fffbeb,#fef9c3)', borderRadius: 12, border: '2px solid #facc15', padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#a16207', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                  ⭐ {t('gold_members')}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#b45309' }}>
                    {c.gold_total.toLocaleString()}{c.gold_cap ? <span style={{ fontSize: 15, fontWeight: 700, color: '#a16207' }}> / {c.gold_cap}</span> : null}
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: c.gold_online > 0 ? '#16a34a' : '#94a3b8' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.gold_online > 0 ? '#22c55e' : '#cbd5e1', display: 'inline-block' }} />
                    {c.gold_online} {t('gold_online')}
                  </span>
                </div>
              </div>

            </div>
          </div>
        )
      })()}
    </>
  )
}
