'use client'
import { useState, useEffect } from 'react'
import { type ApiKey } from '@/lib/consoleApi'
import { getPlan, type OwnerPlan } from '@/lib/billingApi'
import { CONSOLE_CARD_HEIGHT } from './constants'

interface Props {
  keys: ApiKey[]
}

export default function UsageSection({ keys }: Props) {
  const activeKeys = keys.filter(k => k.active)
  const [plan, setPlan] = useState<OwnerPlan | null>(null)
  useEffect(() => {
    getPlan().then(setPlan).catch(() => setPlan(null))
  }, [])
  const capLabel = plan
    ? (plan.monthly_cap === null ? '∞' : plan.monthly_cap.toLocaleString())
    : '—'

  return (
    <section style={{
      background: '#fff',
      borderRadius: 10,
      border: '1px solid #e5e7eb',
      padding: '20px 24px',
      marginBottom: 20,
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      height: CONSOLE_CARD_HEIGHT, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px', flexShrink: 0, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e1e2e', margin: 0 }}>
          📊 Usage (this month)
        </h2>
        {plan && (
          <span style={{ background: '#ede9fe', color: '#7c3aed', padding: '2px 8px',
            borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
            {plan.label}
          </span>
        )}
        {plan && (
          <span style={{ marginInlineStart: 'auto', fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
            {plan.used_this_month.toLocaleString()} / {capLabel}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {activeKeys.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '20px 0', margin: 0 }}>
          No active keys.
        </p>
      ) : (
        <div>
          {activeKeys.map(k => {
            const pct = Math.min(100, k.monthly_cap > 0
              ? Math.round((k.usage_this_month / k.monthly_cap) * 100)
              : 0)
            const barColor = pct >= 90 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#7c3aed'

            return (
              <div key={k.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                  <span style={{ color: '#374151', fontWeight: 500 }}>{k.name}</span>
                  <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 12 }}>
                    {k.usage_this_month.toLocaleString()} / {k.monthly_cap.toLocaleString()}
                  </span>
                </div>
                <div style={{ background: '#f3f4f6', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    background: barColor,
                    height: '100%',
                    width: `${pct}%`,
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                {/* Two distinct metrics: billed server verifications (the bar/cap
                    above) vs. raw gestures drawn — the latter is the GBM training
                    volume and is not billed. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '5px 0 0', fontSize: 11, color: '#9ca3af' }}>
                  <span title="Server-side /siteverify calls — the billed count">
                    ✓ {k.usage_this_month.toLocaleString()} server verifications
                  </span>
                  <span title="Gestures drawn & classified — training data, not billed">
                    ✏️ {(k.gestures_this_month ?? 0).toLocaleString()} gestures drawn
                  </span>
                </div>
                {pct >= 90 && (
                  <p style={{ fontSize: 11, color: '#dc2626', margin: '4px 0 0' }}>
                    ⚠ Approaching monthly cap
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
      </div>
    </section>
  )
}
