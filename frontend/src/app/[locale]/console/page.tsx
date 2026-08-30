'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useCallback } from 'react'
import { clearSession, autoRefreshSession } from '@/lib/sessionAuth'
import { listKeys, listDomains, getAccount, listOwners, type ApiKey, type Domain, type OwnerAccount, type OwnerRow } from '@/lib/consoleApi'
import ApiKeysSection from './ApiKeysSection'
import DomainsSection from './DomainsSection'
import UsageSection from './UsageSection'
import AlertsSection from './AlertsSection'
import DataAccessSection from './DataAccessSection'
import CaptchaSetupSection from './CaptchaSetupSection'
import AccountSection from './AccountSection'
import OwnersAdminSection from './OwnersAdminSection'
import { listAlerts, type Alert } from '@/lib/alertsApi'

export default function ConsolePage() {
  const [did, setDid] = useState<string | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [account, setAccount] = useState<OwnerAccount | null>(null)
  const [owners, setOwners] = useState<OwnerRow[] | null>(null)   // non-null only for super_admin
  const [verifiedFlag, setVerifiedFlag] = useState<'1' | '0' | null>(null)
  const [didCopied, setDidCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [keysResult, domainsResult, alertsResult, accountResult, ownersResult] = await Promise.allSettled([
      listKeys(), listDomains(), listAlerts(), getAccount(), listOwners(),
    ])
    if (keysResult.status === 'fulfilled') setKeys(keysResult.value)
    else setError(keysResult.reason instanceof Error ? keysResult.reason.message : 'Failed to load keys')
    if (domainsResult.status === 'fulfilled') setDomains(domainsResult.value)
    else if (keysResult.status === 'fulfilled') setError(domainsResult.reason instanceof Error ? domainsResult.reason.message : 'Failed to load domains')
    if (alertsResult.status === 'fulfilled') setAlerts(alertsResult.value)
    if (accountResult.status === 'fulfilled') setAccount(accountResult.value)
    // owners is super-admin only: 403 for everyone else → leave it null (panel hidden).
    setOwners(ownersResult.status === 'fulfilled' ? ownersResult.value : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    // Magic-link redirect lands here as ?email_verified=1|0 — surface it once.
    const flag = new URLSearchParams(window.location.search).get('email_verified')
    if (flag === '1' || flag === '0') setVerifiedFlag(flag)

    const stored = localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did') || ''
    if (!stored) {
      setLoading(false)
      return
    }
    setDid(stored)
    // Attempt to refresh JWT session before loading data
    const key = localStorage.getItem('aptogon_key') || ''
    const init = async () => {
      if (key) await autoRefreshSession()
      await loadData()
    }
    init()
  }, [loadData])

  function copyDid() {
    if (!did) return
    navigator.clipboard.writeText(did).then(() => {
      setDidCopied(true)
      setTimeout(() => setDidCopied(false), 2000)
    }).catch(() => {})
  }

  function handleDisconnect() {
    clearSession()
    localStorage.removeItem('aptogon_did')
    localStorage.removeItem('hsi_did')
    localStorage.removeItem('aptogon_key')
    setDid(null)
    setKeys([])
    setDomains([])
    setAlerts([])
  }

  // ── Not verified ────────────────────────────────────────────────────────────
  if (!loading && !did) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', padding: '32px', textAlign: 'center', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>🔑</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#1e1e2e' }}>
          APTOGON Console
        </h2>
        <p style={{ color: '#6b7280', marginBottom: 24, fontSize: 15, lineHeight: 1.6 }}>
          Please verify with APTOGON first. Your DID is stored locally by the browser extension or signer popup after verification.
        </p>
        <a
          href="/"
          style={{ background: '#7c3aed', color: '#fff', padding: '10px 24px', borderRadius: 6, textDecoration: 'none', fontWeight: 600, fontSize: 15 }}
        >
          Go to verification →
        </a>
      </div>
    )
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: '#9ca3af' }}>
        Loading console…
      </div>
    )
  }

  // ── Console ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', maxWidth: 1140, margin: '0 auto', padding: '32px 20px', boxSizing: 'border-box' }}>

      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, padding: '14px 20px',
        background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: '#1e1e2e', flexShrink: 0 }}>APTOGON Console</span>
          {did && (
            <button
              onClick={copyDid}
              title="Скопировать DID"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
                background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 6,
                padding: '3px 8px', cursor: 'pointer', maxWidth: '100%',
              }}
            >
              <code style={{ color: '#7c3aed', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'start' }}>
                {did}
              </code>
              <span style={{ fontSize: 11, color: didCopied ? '#16a34a' : '#7c3aed', flexShrink: 0 }}>
                {didCopied ? '✓ Copied' : '📋'}
              </span>
            </button>
          )}
        </div>
        <button
          onClick={handleDisconnect}
          style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', color: '#6b7280', fontSize: 13 }}
        >
          Disconnect
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
          {error}{' '}
          <button
            onClick={loadData}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', textDecoration: 'underline', fontSize: 14 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Email verification — the first onboarding step, gates key creation */}
      <AccountSection account={account} onRefresh={loadData} verifiedFlag={verifiedFlag} />

      {account?.email_required ? (
        /* Strict onboarding: until the email is confirmed, the email panel is the
           ONLY thing shown — no keys, domains, usage, or setup. */
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '16px 18px', fontSize: 14, color: '#92400e', lineHeight: 1.6 }}>
          Confirm your email above to unlock the rest of the console — API keys,
          domains, usage, and the embed snippet appear once your email is verified.
        </div>
      ) : (
        <>
          {/* Two-up responsive grid: 2 blocks per row on wide screens, 1 on narrow */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
            gap: '0 20px',
            alignItems: 'start',
          }}>
            <ApiKeysSection keys={keys} onRefresh={loadData} />
            <DomainsSection domains={domains} onRefresh={loadData} />
            <UsageSection keys={keys} />
            <AlertsSection alerts={alerts} onRefresh={loadData} />
          </div>

          <CaptchaSetupSection keys={keys} />

          <DataAccessSection />
        </>
      )}

      {/* Super-admin only: owners is non-null just for super_admin (others get 403 → null) */}
      {owners && <OwnersAdminSection owners={owners} onRefresh={loadData} />}
    </div>
  )
}
