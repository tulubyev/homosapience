'use client'
import { useState } from 'react'
import {
  type Alert,
  acknowledgeAlert,
  escalateAlert,
  freezeKeyAlert,
} from '@/lib/alertsApi'
import { CONSOLE_CARD_HEIGHT } from './constants'

interface Props {
  alerts: Alert[]
  onRefresh: () => Promise<void>
}

const SEVERITY_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  info:     { bg: '#dcfce7', color: '#166534', label: 'info' },
  warning:  { bg: '#fef3c7', color: '#92400e', label: 'warn' },
  critical: { bg: '#fee2e2', color: '#dc2626', label: 'crit' },
}

export default function AlertsSection({ alerts, onRefresh }: Props) {
  const [actionId, setActionId]         = useState<number | null>(null)
  const [escalateId, setEscalateId]     = useState<number | null>(null)
  const [escalateComment, setEscalateComment] = useState('')
  const [showAll, setShowAll]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const active = alerts.filter(a => a.status === 'active' || a.status === 'acknowledged')
  const displayed = showAll ? active : active.slice(0, 5)

  async function handle(id: number, action: () => Promise<void>) {
    setActionId(id)
    setError(null)
    try { await action(); await onRefresh() }
    catch { setError('Action failed — try again') }
    setActionId(null)
  }

  async function handleEscalate(id: number) {
    if (!escalateComment.trim()) return
    await handle(id, () => escalateAlert(id, escalateComment))
    setEscalateId(null)
    setEscalateComment('')
  }

  function fmtTime(ts: number) {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <section style={{
      background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
      padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      height: CONSOLE_CARD_HEIGHT, display: 'flex', flexDirection: 'column',
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e1e2e', margin: '0 0 16px', flexShrink: 0 }}>
        ⚠️ Alerts
      </h2>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
          padding: '8px 12px', marginBottom: 12, color: '#dc2626', fontSize: 13, flexShrink: 0 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {active.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '20px 0', margin: 0 }}>
          No active alerts.
        </p>
      ) : (
        <>
          <div>
            {displayed.map(a => {
              const sev = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.info
              const busy = actionId === a.id
              return (
                <div key={a.id} style={{
                  border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8,
                  overflow: 'hidden',
                }}>
                  {/* Row */}
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 14px', background: '#fafaf9',
                  }}>
                    {/* Severity chip */}
                    <span style={{
                      background: sev.bg, color: sev.color,
                      padding: '2px 8px', borderRadius: 10, fontSize: 11,
                      fontWeight: 700, flexShrink: 0, marginTop: 1,
                    }}>
                      {sev.label}
                    </span>

                    {/* Main content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e1e2e', marginBottom: 2 }}>
                        {a.event_type.replace(/_/g, ' ')}
                        {a.api_key_pk && (
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
                            {a.api_key_pk.slice(0, 14)}…
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {fmtTime(a.ts)}
                        {a.status !== 'active' && (
                          <span style={{ marginLeft: 8, background: '#f3f4f6', color: '#6b7280',
                            padding: '1px 6px', borderRadius: 6, fontSize: 10 }}>
                            {a.status}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {a.status === 'active' && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => handle(a.id, () => acknowledgeAlert(a.id))}
                          disabled={busy}
                          style={{
                            background: 'none', border: '1px solid #d1d5db',
                            borderRadius: 5, padding: '3px 10px', cursor: busy ? 'not-allowed' : 'pointer',
                            fontSize: 12, color: '#374151',
                          }}
                        >
                          {busy ? '…' : 'Ack'}
                        </button>
                        {a.api_key_pk && (
                          <button
                            onClick={() => {
                              if (confirm(`Freeze key ${a.api_key_pk?.slice(0, 14)}…?`)) {
                                handle(a.id, () => freezeKeyAlert(a.id))
                              }
                            }}
                            disabled={busy}
                            style={{
                              background: 'none', border: '1px solid #fca5a5', color: '#dc2626',
                              borderRadius: 5, padding: '3px 10px', cursor: busy ? 'not-allowed' : 'pointer',
                              fontSize: 12,
                            }}
                          >
                            Freeze key
                          </button>
                        )}
                        <button
                          onClick={() => setEscalateId(escalateId === a.id ? null : a.id)}
                          disabled={busy}
                          style={{
                            background: 'none', border: '1px solid #c4b5fd', color: '#7c3aed',
                            borderRadius: 5, padding: '3px 10px', cursor: busy ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                          }}
                        >
                          Escalate
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Escalate input panel */}
                  {escalateId === a.id && (
                    <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', background: '#fafaf9' }}>
                      <input
                        value={escalateComment}
                        onChange={e => setEscalateComment(e.target.value)}
                        placeholder="Describe why you're escalating…"
                        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 5,
                          padding: '6px 10px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleEscalate(a.id)}
                          style={{ background: '#7c3aed', color: '#fff', border: 'none',
                            borderRadius: 5, padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        >
                          Send
                        </button>
                        <button
                          onClick={() => { setEscalateId(null); setEscalateComment('') }}
                          style={{ background: 'none', border: '1px solid #d1d5db',
                            borderRadius: 5, padding: '5px 14px', fontSize: 12, cursor: 'pointer', color: '#6b7280' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {active.length > 5 && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{ background: 'none', border: 'none', color: '#7c3aed', fontSize: 13,
                cursor: 'pointer', textDecoration: 'underline', padding: 0, marginTop: 4 }}
            >
              {showAll ? 'Show fewer' : `View all (${active.length})`}
            </button>
          )}
        </>
      )}
      </div>
    </section>
  )
}
