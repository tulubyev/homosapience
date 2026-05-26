'use client'
import { useState, useEffect, useCallback } from 'react'

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

interface StatsResponse {
  available: boolean
  message?: string
  period_days?: number
  totals?: Totals
  by_day?: DayRow[]
  generated_at?: number
}

const CARD = (label: string, value: number, color: string, accent = false) => ({ label, value, color, accent })

export default function StatsPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/risk/stats?days=${days}`)
      setData(r.ok ? await r.json() : { available: false, message: 'Сервис недоступен' })
    } catch {
      setData({ available: false, message: 'Ошибка сети' })
    }
    setLoading(false)
  }, [days])

  useEffect(() => { load() }, [load])

  const wrap = (children: React.ReactNode) => (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 20px', width: '100%', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1e1e2e', margin: '0 0 6px' }}>
        🛡 Статистика атак
      </h1>
      <p style={{ color: '#6b7280', fontSize: 15, margin: '0 0 24px' }}>
        Пассивная статистика верификаций: люди, боты и агентные ИИ-браузеры.
      </p>
      {children}
    </div>
  )

  if (loading) return wrap(<p style={{ color: '#9ca3af' }}>Загрузка…</p>)

  if (!data?.available) {
    return wrap(
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '32px', textAlign: 'center', color: '#6b7280' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
        <p style={{ margin: 0, fontSize: 15 }}>{data?.message ?? 'Статистика пока недоступна.'}</p>
      </div>
    )
  }

  const t = data.totals!
  const pct = (n: number) => (t.sessions > 0 ? Math.round((n / t.sessions) * 100) : 0)
  const cards = [
    CARD('Сессий всего', t.sessions, '#1e1e2e'),
    CARD('Люди', t.humans, '#16a34a'),
    CARD('Боты', t.bots, '#dc2626'),
    CARD('ИИ-агенты', t.ai_agents, '#7c3aed', true),
    CARD('Подозрительные', t.suspicious, '#f59e0b'),
    CARD('Заблокировано', t.blocked, '#dc2626'),
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
            {d} дн.
          </button>
        ))}
      </div>

      {/* Totals grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 28 }}>
        {cards.map(({ label, value, color, accent }) => (
          <div key={label} style={{
            background: '#fff', borderRadius: 12,
            border: accent ? '2px solid #7c3aed' : '1px solid #e5e7eb',
            padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              {label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color }}>{value.toLocaleString()}</div>
            {label !== 'Сессий всего' && (
              <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{pct(value)}% сессий</div>
            )}
          </div>
        ))}
      </div>

      {/* By-day chart */}
      {byDay.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            По дням ({byDay.length})
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80 }}>
            {byDay.map(d => (
              <div key={d.day} title={`${d.day}: ${d.sessions} сессий, ${d.bots + d.ai_agents} бот/ИИ`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ background: '#dc2626', height: `${((d.bots + d.ai_agents) / maxDay) * 100}%`, borderRadius: '3px 3px 0 0' }} />
                <div style={{ background: '#7c3aed', opacity: 0.6, height: `${(d.humans / maxDay) * 100}%` }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: '#6b7280' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#dc2626', borderRadius: 2, marginRight: 4 }} />боты/ИИ</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#7c3aed', opacity: 0.6, borderRadius: 2, marginRight: 4 }} />люди</span>
          </div>
        </div>
      )}
    </>
  )
}
