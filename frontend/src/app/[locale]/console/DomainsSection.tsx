'use client'
import { useState } from 'react'
import {
  type Domain,
  type DomainMethods,
  createDomain,
  verifyDomain,
  deleteDomain,
  type ConsoleApiError,
} from '@/lib/consoleApi'
import { CONSOLE_CARD_HEIGHT } from './constants'

interface Props {
  domains: Domain[]
  onRefresh: () => Promise<void>
}

export default function DomainsSection({ domains, onRefresh }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [selectedMethods, setSelectedMethods] = useState<Record<number, 'dns_txt' | 'well_known'>>({})
  const [verifying, setVerifying] = useState<number | null>(null)
  const [verifyFailed, setVerifyFailed] = useState<Set<number>>(new Set())
  const [addInput, setAddInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Domain | null>(null)

  function getMethod(id: number): 'dns_txt' | 'well_known' {
    return selectedMethods[id] ?? 'dns_txt'
  }

  function toggleExpand(d: Domain) {
    if (!d.token) return  // can't expand without token
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(d.id)) { next.delete(d.id) } else { next.add(d.id) }
      return next
    })
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }).catch(() => {})
  }

  async function handleAdd() {
    if (!addInput.trim()) return
    setAdding(true)
    setAddError(null)
    try {
      const result = await createDomain(addInput.trim())
      setExpandedIds(prev => { const n = new Set(prev); n.add(result.id); return n })
      setAddInput('')
      await onRefresh()
    } catch (e) {
      const code = (e as ConsoleApiError).code
      if (code === 'invalid_origin') {
        setAddError('Invalid origin — must start with https://')
      } else {
        setAddError('Failed to add domain')
      }
    } finally {
      setAdding(false)
    }
  }

  async function handleVerify(d: Domain) {
    const method = getMethod(d.id)
    setVerifying(d.id)
    setVerifyFailed(prev => { const n = new Set(prev); n.delete(d.id); return n })
    try {
      const result = await verifyDomain(d.id, method)
      if (result.status === 'verified') {
        setExpandedIds(prev => { const n = new Set(prev); n.delete(d.id); return n })
        await onRefresh()
      } else {
        setVerifyFailed(prev => { const n = new Set(prev); n.add(d.id); return n })
      }
    } catch {
      setVerifyFailed(prev => { const n = new Set(prev); n.add(d.id); return n })
    } finally {
      setVerifying(null)
    }
  }

  function requestDelete(d: Domain, e: React.MouseEvent) {
    e.stopPropagation()  // don't toggle the expand panel
    setConfirmDelete(d)  // open in-page confirmation modal
  }

  async function confirmDeleteNow() {
    const d = confirmDelete
    if (!d) return
    setDeletingId(d.id)
    try {
      await deleteDomain(d.id)
      await onRefresh()
    } catch {
      /* ignore — row stays */
    } finally {
      setDeletingId(null)
      setConfirmDelete(null)
    }
  }

  function renderMethods(d: Domain, methods: DomainMethods) {
    const method = getMethod(d.id)

    return (
      <div style={{ padding: '14px 16px', background: '#fafaf9', borderTop: '1px solid #e5e7eb' }}>
        {/* Method selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['dns_txt', 'well_known'] as const).map(m => (
            <button
              key={m}
              onClick={() => setSelectedMethods(prev => ({ ...prev, [d.id]: m }))}
              style={{
                background: method === m ? '#7c3aed' : '#f3f4f6',
                color: method === m ? '#fff' : '#374151',
                border: 'none', borderRadius: 5, padding: '5px 12px',
                cursor: 'pointer', fontSize: 13,
                fontWeight: method === m ? 600 : 400,
              }}
            >
              {m === 'dns_txt' ? 'DNS-TXT (recommended)' : 'Well-known file'}
            </button>
          ))}
        </div>

        {method === 'dns_txt' && (
          <div style={{ background: '#f5f3ff', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
            {[
              { label: 'Record name', value: methods.dns_txt.name, copyKey: `dns-name-${d.id}` },
              { label: 'Record value', value: methods.dns_txt.value, copyKey: `dns-val-${d.id}` },
            ].map(({ label, value, copyKey }) => (
              <div key={copyKey} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ flex: 1, background: '#1e1e2e', color: '#a5f3fc', padding: '3px 8px', borderRadius: 4, fontSize: 11, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {value}
                  </code>
                  <button
                    onClick={() => copy(value, copyKey)}
                    style={{ background: 'none', border: '1px solid #c4b5fd', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                  >
                    {copiedKey === copyKey ? '✓' : '📋'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {method === 'well_known' && (
          <div style={{ background: '#f5f3ff', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
            {[
              { label: 'Upload file to:', value: methods.well_known.url, copyKey: `wk-url-${d.id}` },
              { label: 'File content:', value: methods.well_known.content, copyKey: `wk-cnt-${d.id}` },
            ].map(({ label, value, copyKey }) => (
              <div key={copyKey} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ flex: 1, background: '#1e1e2e', color: '#a5f3fc', padding: '3px 8px', borderRadius: 4, fontSize: 11, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {value}
                  </code>
                  <button
                    onClick={() => copy(value, copyKey)}
                    style={{ background: 'none', border: '1px solid #c4b5fd', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                  >
                    {copiedKey === copyKey ? '✓' : '📋'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {verifyFailed.has(d.id) && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 10, color: '#dc2626', fontSize: 13 }}>
            Record not found. DNS propagation may take a few minutes — try again shortly.
          </div>
        )}

        <button
          onClick={() => handleVerify(d)}
          disabled={verifying === d.id}
          style={{
            background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6,
            padding: '8px 18px', cursor: verifying === d.id ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 600,
          }}
        >
          {verifying === d.id ? 'Checking…' : method === 'dns_txt' ? 'Verify DNS' : 'Verify file'}
        </button>
      </div>
    )
  }

  return (
    <section style={{
      background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
      padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      height: CONSOLE_CARD_HEIGHT, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header row: title + add-domain input + button, all inline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: addError ? 8 : 16, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e1e2e', margin: 0, whiteSpace: 'nowrap' }}>
          🌐 Domains
        </h2>
        <input
          value={addInput}
          onChange={e => setAddInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !adding && handleAdd()}
          placeholder="https://example.com"
          style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 6, padding: '7px 12px', fontSize: 13 }}
        />
        <button
          onClick={handleAdd}
          disabled={adding}
          style={{
            background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6,
            padding: '7px 16px', cursor: adding ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 600,
          }}
        >
          {adding ? '…' : '+ Add'}
        </button>
      </div>
      {addError && (
        <p style={{ color: '#dc2626', fontSize: 13, margin: '0 0 12px', flexShrink: 0 }}>{addError}</p>
      )}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {domains.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '20px 0', margin: 0 }}>
          No domains yet. Add a domain above to start verification.
        </p>
      ) : (
        <div>
          {domains.map(d => {
            const isExpanded = expandedIds.has(d.id)
            const isVerified = d.status === 'verified'
            const canExpand = !isVerified && !!d.token

            return (
              <div key={d.id} style={{
                border: isExpanded ? '1px solid #a78bfa' : '1px solid #e5e7eb',
                borderRadius: 8,
                marginBottom: 8,
                overflow: 'hidden',
              }}>
                {/* Row header */}
                <div
                  onClick={() => canExpand && toggleExpand(d)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: isVerified ? '#f0fdf4' : d.status === 'failed' ? '#fef2f2' : '#fffbeb',
                    cursor: canExpand ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#1e1e2e' }}>
                    {d.origin}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      background: isVerified ? '#dcfce7' : d.status === 'failed' ? '#fee2e2' : '#fef3c7',
                      color: isVerified ? '#166534' : d.status === 'failed' ? '#dc2626' : '#92400e',
                      padding: '2px 8px', borderRadius: 10, fontSize: 12,
                    }}>
                      {isVerified ? `✓ ${d.method}` : d.status === 'failed' ? '✗ failed' : '⏳ pending'}
                    </span>
                    {canExpand && (
                      <span style={{ fontSize: 12, color: '#7c3aed' }}>
                        {isExpanded ? '▲' : '▼ Verify'}
                      </span>
                    )}
                    <button
                      onClick={e => requestDelete(d, e)}
                      disabled={deletingId === d.id}
                      title="Удалить домен"
                      style={{
                        background: 'none', border: '1px solid #fca5a5', color: '#dc2626',
                        borderRadius: 5, padding: '2px 8px', fontSize: 12,
                        cursor: deletingId === d.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {deletingId === d.id ? '…' : '🗑'}
                    </button>
                  </div>
                </div>

                {/* Expanded panel */}
                {isExpanded && d.methods && renderMethods(d, d.methods)}
              </div>
            )
          })}
        </div>
      )}
      </div>

      {/* In-page delete confirmation (replaces native confirm) */}
      {confirmDelete && (
        <div
          onClick={() => deletingId === null && setConfirmDelete(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, border: '1px solid #fca5a5',
              padding: '24px 28px', width: '100%', maxWidth: 420,
              boxShadow: '0 8px 32px rgba(220,38,38,0.15)',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗑</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1e1e2e', margin: '0 0 8px' }}>
              Удалить домен?
            </h3>
            <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 6px', lineHeight: 1.5 }}>
              <code style={{ fontFamily: 'monospace', color: '#dc2626' }}>{confirmDelete.origin}</code>
            </p>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 20px', lineHeight: 1.5 }}>
              Запись верификации будет удалена. При необходимости домен можно добавить и проверить заново.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={confirmDeleteNow}
                disabled={deletingId !== null}
                style={{
                  flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7,
                  padding: '10px', cursor: deletingId !== null ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 600,
                }}
              >
                {deletingId !== null ? 'Удаляю…' : 'Удалить'}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId !== null}
                style={{
                  flex: 1, background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb',
                  borderRadius: 7, padding: '10px', cursor: deletingId !== null ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
