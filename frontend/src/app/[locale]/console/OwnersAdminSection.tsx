'use client'
import { useState } from 'react'
import {
  suspendOwner, unsuspendOwner, editOwner, deleteOwner, messageOwner, type OwnerRow,
} from '@/lib/consoleApi'

/**
 * Super-admin only. Full list of site-owner accounts with moderation: message the
 * owner (email), edit (email + internal note), suspend/unsuspend, delete. The
 * parent mounts this only when /api/admin/owners returned 200 (caller is a
 * super_admin), so a plain owner never sees it.
 */
type MsgKind = 'message' | 'warning' | 'proposal'

export default function OwnersAdminSection({ owners, onRefresh }: {
  owners: OwnerRow[]
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Message composer state
  const [msgTo, setMsgTo] = useState<OwnerRow | null>(null)
  const [kind, setKind] = useState<MsgKind>('message')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  async function run(did: string, fn: () => Promise<unknown>, failMsg: string) {
    setBusy(did); setErr(null)
    try { await fn(); onRefresh() }
    catch { setErr(failMsg) }
    finally { setBusy(null) }
  }

  const doSuspend = (did: string) => {
    const reason = window.prompt('Reason for suspension (shown to the owner):', '')
    if (reason === null) return
    run(did, () => suspendOwner(did, reason), 'Could not suspend that account.')
  }
  const doUnsuspend = (did: string) => run(did, () => unsuspendOwner(did), 'Could not lift the suspension.')

  function doEdit(o: OwnerRow) {
    const email = window.prompt('Email (leave unchanged to keep):', o.email || '')
    if (email === null) return
    const note = window.prompt('Internal note (only super-admins see this):', o.admin_note || '')
    if (note === null) return
    const patch: { email?: string; admin_note?: string } = { admin_note: note }
    if (email && email !== o.email) patch.email = email
    run(o.did, () => editOwner(o.did, patch), 'Could not save changes.')
  }

  function doDelete(o: OwnerRow) {
    if (!window.confirm(`Delete account ${o.email || o.did.slice(-12)}? This deactivates all its keys. The owner can re-register later.`)) return
    run(o.did, () => deleteOwner(o.did), 'Could not delete that account.')
  }

  function openMsg(o: OwnerRow) {
    setMsgTo(o); setKind('message'); setSubject(''); setBody(''); setSendResult(null)
  }
  async function send() {
    if (!msgTo || !body.trim()) return
    setSending(true); setSendResult(null)
    try {
      const r = await messageOwner(msgTo.did, kind, subject.trim(), body)
      setSendResult(r.sent ? 'Sent ✓' : 'Saved, but email delivery is not configured.')
      if (r.sent) setTimeout(() => setMsgTo(null), 900)
    } catch {
      setSendResult('Could not send the message.')
    } finally {
      setSending(false)
    }
  }

  // Icon-only action button — the label lives in `title` (tooltip on hover).
  const iconBtn = (border: string): React.CSSProperties => ({
    width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 15, lineHeight: 1, background: '#fff', border: `1px solid ${border}`,
    borderRadius: 7, cursor: 'pointer', padding: 0,
  })

  return (
    <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#111827' }}>🛡️ Site accounts — super-admin</h2>
        <span style={{ background: '#ede9fe', color: '#7c3aed', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
          {owners.length} owners
        </span>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>
        Message, edit, suspend, or delete site-owner accounts. Suspending blocks all a
        owner's keys immediately (captcha stops on their sites) and locks the console.
      </p>
      {err && <p style={{ margin: '0 0 12px', fontSize: 13, color: '#dc2626' }}>{err}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              {['Email', 'Label', 'Site(s)', 'DID', 'Keys', 'Usage', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'start', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {owners.map(o => (
              <tr key={o.did} style={{ borderBottom: '1px solid #f1f5f9', background: o.suspended ? '#fef2f2' : '#fff' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>
                  {o.email || <span style={{ color: '#9ca3af' }}>— no email</span>}
                  {o.email && !o.email_verified && <span style={{ marginInlineStart: 6, fontSize: 11, color: '#d97706' }}>(unverified)</span>}
                  {o.admin_note && <div title={o.admin_note} style={{ fontSize: 11, color: '#9ca3af', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 {o.admin_note}</div>}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151', maxWidth: 180 }}>
                  {o.labels.length
                    ? o.labels.map(l => <div key={l} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</div>)
                    : <span style={{ color: '#9ca3af' }}>—</span>}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151', maxWidth: 240 }}>
                  {o.origins.length
                    ? o.origins.map(u => (
                        <div key={u} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <a href={u} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>{u.replace(/^https?:\/\//, '')}</a>
                        </div>
                      ))
                    : <span style={{ color: '#9ca3af' }}>— none</span>}
                </td>
                <td style={{ padding: '10px 12px' }}><code style={{ fontSize: 11, color: '#6b7280' }}>…{o.did.slice(-12)}</code></td>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>{o.key_count}</td>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>{o.usage_this_month.toLocaleString()}</td>
                <td style={{ padding: '10px 12px' }}>
                  {o.suspended
                    ? <span title={o.suspended_reason || ''} style={{ background: '#fee2e2', color: '#dc2626', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>Suspended</span>
                    : <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>Active</span>}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {o.email && <button disabled={busy === o.did} onClick={() => openMsg(o)} title="Message" style={iconBtn('#bfdbfe')}>✉️</button>}
                    <button disabled={busy === o.did} onClick={() => doEdit(o)} title="Edit" style={iconBtn('#d1d5db')}>✏️</button>
                    {o.email && (o.suspended
                      ? <button disabled={busy === o.did} onClick={() => doUnsuspend(o.did)} title="Unsuspend" style={iconBtn('#86efac')}>▶️</button>
                      : <button disabled={busy === o.did} onClick={() => doSuspend(o.did)} title="Suspend" style={iconBtn('#fcd34d')}>⏸️</button>)}
                    <button disabled={busy === o.did} onClick={() => doDelete(o)} title="Delete" style={iconBtn('#fca5a5')}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Message composer modal */}
      {msgTo && (
        <div onClick={() => !sending && setMsgTo(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: '#111827' }}>Message site owner</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>To <b>{msgTo.email}</b> — sent by email.</p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {(['message', 'warning', 'proposal'] as MsgKind[]).map(k => (
                <button key={k} onClick={() => setKind(k)}
                  style={{ flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                    textTransform: 'capitalize',
                    border: kind === k ? '2px solid #7c3aed' : '1px solid #d1d5db',
                    background: kind === k ? '#f5f3ff' : '#fff', color: kind === k ? '#7c3aed' : '#374151' }}>
                  {k}
                </button>
              ))}
            </div>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }} />
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Your message…" rows={5}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />

            {sendResult && <p style={{ margin: '10px 0 0', fontSize: 13, color: sendResult.startsWith('Sent') ? '#16a34a' : '#d97706' }}>{sendResult}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setMsgTo(null)} disabled={sending}
                style={{ padding: '9px 18px', fontSize: 14, fontWeight: 600, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
              <button onClick={send} disabled={sending || !body.trim()}
                style={{ padding: '9px 18px', fontSize: 14, fontWeight: 700, color: '#fff', background: '#7c3aed', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: sending || !body.trim() ? 0.6 : 1 }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
