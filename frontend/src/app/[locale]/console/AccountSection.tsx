'use client'
import { useState } from 'react'
import { registerEmail, type OwnerAccount, type ConsoleApiError } from '@/lib/consoleApi'

/**
 * Owner email verification. The DID proves "a human"; a verified email proves "a
 * real, contactable person" — required before self-serve key creation. Shows the
 * current state (none / pending / verified) and lets the owner (re)send the
 * magic-link. `verifiedFlag` is the ?email_verified=1|0 the magic-link redirect
 * appends, so we can show a one-time confirmation banner.
 */
export default function AccountSection({
  account, onRefresh, verifiedFlag,
}: {
  account: OwnerAccount | null
  onRefresh: () => void
  verifiedFlag: '1' | '0' | null
}) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const verified = account?.email_verified
  const pending = account?.email && !account.email_verified

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setMsg(null)
    try {
      const target = (account?.email || email).trim()
      const res = await registerEmail(target)
      setMsg(res.sent
        ? `Confirmation link sent to ${res.email}. Check your inbox.`
        : `Registered ${res.email}. (Email delivery is not configured yet — ask the admin.)`)
      onRefresh()
    } catch (e2) {
      const code = (e2 as ConsoleApiError).code
      setErr(code === 'email_taken' ? 'That email is already used by another account.'
        : code === 'invalid_email' ? 'That does not look like a valid email.'
        : 'Could not register the email. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#111827' }}>📧 Account email</h2>
        {verified && (
          <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>✓ Verified</span>
        )}
        {pending && (
          <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>Pending</span>
        )}
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>
        Confirm a real email to unlock API-key creation. Your gesture proves you are human;
        the email proves you are a reachable person we can contact about your keys.
      </p>

      {verifiedFlag === '1' && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534', marginBottom: 12 }}>
          ✓ Email confirmed — you can now create API keys.
        </div>
      )}
      {verifiedFlag === '0' && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 }}>
          That confirmation link is invalid or expired. Send a new one below.
        </div>
      )}

      {verified ? (
        <div style={{ fontSize: 14, color: '#374151' }}>
          <code style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: 6 }}>{account?.email}</code>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {pending ? (
            <span style={{ fontSize: 14, color: '#374151' }}>
              Sent to <code style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: 6 }}>{account?.email}</code> — not confirmed yet.
            </span>
          ) : (
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              style={{ flex: 1, minWidth: 220, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
            />
          )}
          <button type="submit" disabled={busy}
            style={{ padding: '9px 18px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? '…' : pending ? 'Resend link' : 'Send confirmation'}
          </button>
        </form>
      )}

      {msg && <p style={{ margin: '10px 0 0', fontSize: 13, color: '#16a34a' }}>{msg}</p>}
      {err && <p style={{ margin: '10px 0 0', fontSize: 13, color: '#dc2626' }}>{err}</p>}
    </section>
  )
}
