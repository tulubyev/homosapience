'use client'
import { useState } from 'react'
import {
  type ApiKey,
  createKey,
  deactivateKey,
  reactivateKey,
  type ConsoleApiError,
} from '@/lib/consoleApi'
import { CONSOLE_CARD_HEIGHT } from './constants'

interface Props {
  keys: ApiKey[]
  onRefresh: () => Promise<void>
}

type ModalState =
  | { step: 'closed' }
  | { step: 'form' }
  | { step: 'reveal'; pk: string; sk: string; name: string }

export default function ApiKeysSection({ keys, onRefresh }: Props) {
  const [modal, setModal] = useState<ModalState>({ step: 'closed' })
  const [formName, setFormName] = useState('')
  const [formOrigin, setFormOrigin] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [skCopied, setSkCopied] = useState(false)
  const [actionKey, setActionKey] = useState<number | null>(null)

  function openModal() {
    setFormName('')
    setFormOrigin('')
    setCreateError(null)
    setModal({ step: 'form' })
  }

  async function handleCreate() {
    if (!formName.trim()) { setCreateError('Label is required'); return }
    if (!formOrigin.trim()) { setCreateError('Origin is required'); return }
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createKey(formName.trim(), formOrigin.trim())
      setSkCopied(false)
      setModal({ step: 'reveal', pk: result.publishable_key, sk: result.secret_key, name: result.name })
    } catch (e) {
      const code = (e as ConsoleApiError).code
      const status = (e as ConsoleApiError).status
      if (code === 'email_verification_required') {
        setCreateError('Confirm your account email first (Account email panel above) — then you can create keys.')
      } else if (code === 'key_limit_reached') {
        setCreateError('Key limit reached (max 5 active keys)')
      } else if (code === 'admin_required') {
        setCreateError('Admin access required — self-serve keys are not yet enabled on this server')
      } else if (code === 'invalid_origin') {
        setCreateError('Invalid origin — must be a full URL starting with https://')
      } else {
        setCreateError(`Failed to create key (${code ?? status ?? 'unknown error'})`)
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleClose() {
    setModal({ step: 'closed' })
    await onRefresh()
  }

  async function handleDeactivate(id: number) {
    setActionKey(id)
    try { await deactivateKey(id); await onRefresh() } catch { /* ignore */ }
    setActionKey(null)
  }

  async function handleReactivate(id: number) {
    setActionKey(id)
    try { await reactivateKey(id); await onRefresh() } catch { /* ignore */ }
    setActionKey(null)
  }

  function copy(text: string, onCopied: () => void) {
    navigator.clipboard.writeText(text).then(onCopied).catch(() => {})
  }

  return (
    <section style={{
      background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
      padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      height: CONSOLE_CARD_HEIGHT, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e1e2e', margin: 0 }}>🔑 API Keys</h2>
        <button onClick={openModal} style={{
          background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6,
          padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        }}>
          + Create
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {keys.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '20px 0', margin: 0 }}>
          No keys yet. Create your first API key.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f3f4f6', color: '#6b7280', textAlign: 'start' }}>
                {['Label', 'Origin', 'Status', 'Usage', ' '].map(h => (
                  <th key={h} style={{ padding: '6px 8px', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                  <td style={{ padding: '8px', color: '#374151' }}>{k.name}</td>
                  <td style={{ padding: '8px', color: '#6b7280', fontSize: 12 }}>
                    {k.allowed_origins[0] ?? '—'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <span style={{
                      background: k.active ? '#dcfce7' : '#f3f4f6',
                      color: k.active ? '#166534' : '#6b7280',
                      padding: '2px 8px', borderRadius: 10, fontSize: 11,
                    }}>
                      {k.active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '8px', color: '#374151', fontSize: 12 }}>
                    {k.usage_this_month.toLocaleString()} / {k.monthly_cap.toLocaleString()}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'end' }}>
                    {k.active ? (
                      <button
                        onClick={() => handleDeactivate(k.id)}
                        disabled={actionKey === k.id}
                        style={{
                          background: 'none', border: '1px solid #fca5a5', color: '#dc2626',
                          borderRadius: 5, padding: '3px 10px', cursor: actionKey === k.id ? 'not-allowed' : 'pointer', fontSize: 12,
                        }}
                      >
                        {actionKey === k.id ? '…' : 'Deactivate'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReactivate(k.id)}
                        disabled={actionKey === k.id}
                        style={{
                          background: 'none', border: '1px solid #a78bfa', color: '#7c3aed',
                          borderRadius: 5, padding: '3px 10px', cursor: actionKey === k.id ? 'not-allowed' : 'pointer', fontSize: 12,
                        }}
                      >
                        {actionKey === k.id ? '…' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>

      {/* Modal overlay */}
      {modal.step !== 'closed' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, border: '1px solid #a78bfa',
            padding: '28px 32px', width: '100%', maxWidth: 440,
            boxShadow: '0 8px 32px rgba(124,58,237,0.15)',
          }}>

            {modal.step === 'form' && (
              <>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: '#1e1e2e', margin: '0 0 20px' }}>
                  New API Key
                </h3>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4, fontWeight: 500 }}>
                    Label
                  </label>
                  <input
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="My site"
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4, fontWeight: 500 }}>
                    Origin
                  </label>
                  <input
                    value={formOrigin}
                    onChange={e => setFormOrigin(e.target.value)}
                    placeholder="https://example.com"
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
                {createError && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
                    {createError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    style={{ flex: 1, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '10px', cursor: creating ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}
                  >
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    onClick={handleClose}
                    style={{ flex: 1, background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 7, padding: '10px', cursor: 'pointer', fontSize: 14 }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {modal.step === 'reveal' && (
              <>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#166534', margin: '0 0 16px' }}>
                  Key created: {modal.name}
                </h3>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    Public key (pk) — use in aptogon.js
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ flex: 1, background: '#1e1e2e', color: '#a5f3fc', padding: '6px 10px', borderRadius: 5, fontSize: 11, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                      {modal.pk}
                    </code>
                    <button
                      onClick={() => copy(modal.pk, () => {})}
                      style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                    >
                      📋
                    </button>
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    Secret key (sk) —{' '}
                    <strong style={{ color: '#dc2626' }}>shown once only</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ flex: 1, background: '#1e1e2e', color: '#fcd34d', padding: '6px 10px', borderRadius: 5, fontSize: 11, wordBreak: 'break-all', fontFamily: 'monospace', border: '1px solid #f59e0b' }}>
                      {modal.sk}
                    </code>
                    <button
                      onClick={() => copy(modal.sk, () => setSkCopied(true))}
                      style={{ background: '#7c3aed', border: 'none', color: '#fff', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                    >
                      {skCopied ? '✓' : '📋'}
                    </button>
                  </div>
                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
                    ⚠ Save sk now — it cannot be shown again
                  </p>
                </div>
                <button
                  onClick={handleClose}
                  style={{ width: '100%', background: '#f0fdf4', color: '#166534', border: '1px solid #86efac', borderRadius: 7, padding: '10px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
                >
                  I&apos;ve saved it / Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
