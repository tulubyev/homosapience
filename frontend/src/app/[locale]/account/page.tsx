'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { QRCodeSVG } from 'qrcode.react'
import {
  listDevices, unlinkDevice, createPairing,
  type AccountSummary, type DeviceEntry, type PairingCreate,
} from '@/lib/pairApi'
import { autoRefreshSession } from '@/lib/sessionAuth'

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortDid(did: string): string {
  // Show last 12 chars: "…xYzaBcDeFgH"
  return did.length > 16 ? `…${did.slice(-12)}` : did
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── Unlink confirm modal ───────────────────────────────────────────────────────

function UnlinkModal({
  device, onConfirm, onCancel, busy,
}: {
  device: DeviceEntry
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: 28, maxWidth: 400, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>🔓</div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 900, color: '#0f172a', textAlign: 'center' }}>
          Unlink this device?
        </h3>
        <p style={{ margin: '0 0 6px', fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 1.5 }}>
          This device will lose access to the shared account.{' '}
          {device.is_primary ? (
            <strong style={{ color: '#dc2626' }}>This is the primary device — other devices remain linked.</strong>
          ) : 'You can re-link it later by scanning a new QR code.'}
        </p>
        <div style={{ background: '#f8fafc', borderRadius: 12, padding: '10px 14px', marginBottom: 20, fontSize: 12, fontFamily: 'monospace', color: '#475569', wordBreak: 'break-all' }}>
          {device.did}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{ flex: 1, padding: '12px 0', background: '#f1f5f9', border: 'none', borderRadius: 12, cursor: busy ? 'default' : 'pointer', fontSize: 14, fontWeight: 600, color: '#475569' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{ flex: 1, padding: '12px 0', background: busy ? '#fca5a5' : 'linear-gradient(135deg,#dc2626,#ef4444)', border: 'none', borderRadius: 12, cursor: busy ? 'default' : 'pointer', fontSize: 14, fontWeight: 700, color: '#fff' }}
          >
            {busy ? '⏳ Unlinking…' : '🔓 Unlink'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Link-new-device QR modal ──────────────────────────────────────────────────

function QRModal({ pairing, onClose }: { pairing: PairingCreate; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const secsLeft = Math.max(0, pairing.expires_at - Math.floor(Date.now() / 1000))

  const copyCode = () => {
    navigator.clipboard.writeText(pairing.link_code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, padding: 28, maxWidth: 380, width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.3)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📱</div>
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 900, color: '#0f172a' }}>Link a new device</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
          On the new device, open the QR scanner or go to<br />
          <strong>homosapience.org/verify</strong> and enter the code.
        </p>

        {/* QR */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <QRCodeSVG
            value={pairing.verify_url}
            size={200}
            bgColor="#ffffff"
            fgColor="#0f172a"
            style={{ borderRadius: 12, border: '1.5px solid #e2e8f0', padding: 8 }}
          />
        </div>

        {/* Code */}
        <div style={{ background: '#f8fafc', borderRadius: 12, padding: '10px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 900, letterSpacing: '0.15em', color: '#0f172a' }}>
            {pairing.link_code}
          </span>
          <button
            onClick={copyCode}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: copied ? '#059669' : '#e2e8f0', color: copied ? '#fff' : '#334155', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
        </div>

        <p style={{ margin: '0 0 18px', fontSize: 11, color: '#94a3b8' }}>
          Expires in ~{Math.ceil(secsLeft / 60)} min · Code valid for one use
        </p>

        <button
          onClick={onClose}
          style={{ width: '100%', padding: '12px 0', background: '#f1f5f9', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#475569' }}
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ── Copy DID button (inline, self-contained state) ────────────────────────────

function CopyDidButton({ did, label = '📋 Copy DID', fullWidth = false }: { did: string; label?: string; fullWidth?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(did).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      style={{
        padding: '10px 14px', borderRadius: 10,
        border: copied ? '1.5px solid rgba(5,150,105,0.5)' : '1.5px solid #7c3aed',
        background: copied ? '#f0fdf4' : '#ede9fe',
        color: copied ? '#059669' : '#5b21b6',
        fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
        width: fullWidth ? '100%' : undefined,
        textAlign: 'center',
      }}
    >
      {copied ? '✓ Copied!' : label}
    </button>
  )
}

// ── Device card ───────────────────────────────────────────────────────────────

function DeviceCard({
  device, isThis, onUnlink,
}: {
  device: DeviceEntry
  isThis: boolean
  onUnlink: (d: DeviceEntry) => void
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 18, padding: '16px 20px',
      border: isThis ? '2px solid rgba(124,58,237,0.35)' : '1.5px solid #e2e8f0',
      boxShadow: isThis ? '0 4px 20px rgba(124,58,237,0.1)' : '0 1px 8px rgba(0,0,0,0.04)',
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 14, flexShrink: 0,
        background: isThis ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#f1f5f9',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
      }}>
        {isThis ? '📱' : '💻'}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>
            {device.label || shortDid(device.did)}
          </span>
          {isThis && (
            <span style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
              This device
            </span>
          )}
          {device.is_primary && (
            <span style={{ background: 'rgba(5,150,105,0.1)', color: '#059669', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
              Primary
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.did}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          Linked {relativeTime(device.linked_at)}
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        {isThis && (
          <CopyDidButton did={device.did} />
        )}
        {!isThis && (
          <button
            onClick={() => onUnlink(device)}
            style={{
              padding: '7px 14px', borderRadius: 10, border: '1.5px solid rgba(220,38,38,0.3)',
              background: 'rgba(220,38,38,0.06)', color: '#dc2626',
              fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Unlink
          </button>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const locale = useLocale()
  const [summary, setSummary]           = useState<AccountSummary | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [confirmDevice, setConfirmDevice] = useState<DeviceEntry | null>(null)
  const [unlinking, setUnlinking]       = useState(false)
  const [unlinkError, setUnlinkError]   = useState<string | null>(null)
  const [pairing, setPairing]           = useState<PairingCreate | null>(null)
  const [creatingQR, setCreatingQR]     = useState(false)
  const [thisDid, setThisDid]           = useState<string>('')

  // Load current DID from localStorage
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      setThisDid(localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did') || '')
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    await autoRefreshSession()
    const data = await listDevices()
    if (!data) {
      setError('Could not load account — make sure you are verified and the device accounts feature is enabled.')
    } else {
      setSummary(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleUnlink = async () => {
    if (!confirmDevice) return
    setUnlinking(true); setUnlinkError(null)
    try {
      await unlinkDevice(confirmDevice.did)
      setConfirmDevice(null)
      await load()
    } catch (e) {
      setUnlinkError(e instanceof Error ? e.message : 'Unlink failed')
    } finally {
      setUnlinking(false)
    }
  }

  const handleCreateQR = async () => {
    setCreatingQR(true)
    try {
      const p = await createPairing()
      setPairing(p)
    } catch {
      setError('Could not create pairing code — your credential may have expired.')
    } finally {
      setCreatingQR(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Modals */}
      {confirmDevice && (
        <UnlinkModal
          device={confirmDevice}
          onConfirm={handleUnlink}
          onCancel={() => { setConfirmDevice(null); setUnlinkError(null) }}
          busy={unlinking}
        />
      )}
      {pairing && <QRModal pairing={pairing} onClose={() => setPairing(null)} />}

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #ede9fe 0%, #f0f9ff 60%, #fdf4ff 100%)',
        padding: '40px 24px 32px',
        borderBottom: '1px solid rgba(124,58,237,0.1)',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <Link href={`/${locale}/verify`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#7c3aed', textDecoration: 'none', marginBottom: 16, opacity: 0.8 }}>
            ← Back to verify
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
              🔐
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#0f172a' }}>My Devices</h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#7c3aed', fontWeight: 600 }}>
                One identity · multiple verified devices
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 24px 64px' }}>

        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 15 }}>
            Loading…
          </div>
        )}

        {error && !loading && (
          <div style={{ background: '#fef2f2', borderRadius: 16, padding: '16px 20px', border: '1.5px solid rgba(220,38,38,0.2)', color: '#dc2626', fontSize: 13, marginBottom: 20 }}>
            ⚠️ {error}
          </div>
        )}

        {unlinkError && (
          <div style={{ background: '#fef2f2', borderRadius: 16, padding: '14px 18px', border: '1.5px solid rgba(220,38,38,0.2)', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
            ⚠️ {unlinkError}
          </div>
        )}

        {/* DID identity card — shown whenever a local key is present */}
        {thisDid && !loading && (
          <div style={{
            background: '#fff', borderRadius: 18, padding: '16px 20px',
            border: '1.5px solid rgba(124,58,237,0.2)', marginBottom: 20,
            boxShadow: '0 2px 12px rgba(124,58,237,0.06)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              🪪 Your Decentralized ID
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: 11, color: '#374151',
              wordBreak: 'break-all', lineHeight: 1.6,
              background: '#f8fafc', borderRadius: 10, padding: '10px 12px',
              border: '1px solid #e2e8f0', marginBottom: 12,
            }}>
              {thisDid}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <CopyDidButton did={thisDid} label='📋 Copy full DID' fullWidth />
              <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                Share with an administrator to receive Gold Member access.
              </span>
            </div>
          </div>
        )}

        {summary && !loading && (
          <>
            {/* Account summary chip */}
            <div style={{
              background: '#fff', borderRadius: 18, padding: '14px 20px',
              border: '1.5px solid rgba(124,58,237,0.15)', marginBottom: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
            }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Devices</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#7c3aed' }}>{summary.device_count}</div>
                </div>
                {summary.max_trust_label && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Best Trust</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#059669' }}>
                      {Math.round(summary.max_trust_score * 100)}%
                      <span style={{ marginInlineStart: 6, fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{summary.max_trust_label}</span>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleCreateQR}
                disabled={creatingQR}
                style={{
                  padding: '10px 18px', borderRadius: 12, border: 'none',
                  background: creatingQR ? '#e2e8f0' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
                  color: creatingQR ? '#94a3b8' : '#fff',
                  fontWeight: 700, fontSize: 13, cursor: creatingQR ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                }}
              >
                {creatingQR ? '⏳ Creating…' : '📱 Link new device'}
              </button>
            </div>

            {/* Device list */}
            <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
              Linked devices
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {summary.devices.map(d => (
                <DeviceCard
                  key={d.did}
                  device={d}
                  isThis={!!thisDid && d.did === thisDid}
                  onUnlink={setConfirmDevice}
                />
              ))}
            </div>

            {/* Security note */}
            <div style={{ background: '#fff', borderRadius: 16, padding: '14px 18px', border: '1.5px solid #e2e8f0', fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              <strong style={{ color: '#0f172a', display: 'block', marginBottom: 4 }}>🔐 How device accounts work</strong>
              Each device keeps its own private key — nothing is ever copied or shared.
              Devices are linked server-side into one identity. Unlinking a device revokes
              its access without affecting others. To remove <em>this</em> device, log in on
              another linked device and unlink it from there.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
