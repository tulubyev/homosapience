'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { aptogonHeaders, getSessionToken } from '@/lib/sessionAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PendingRequest {
  id:              string
  requester_did:   string
  confidence:      number
  message:         string | null
  created_at:      number
  approvals_count: number
  needed:          number
}

type WsStatus = 'connecting' | 'connected' | 'disconnected'

// ── Ed25519 signing (Web Crypto API) ─────────────────────────────────────────

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad.padEnd(pad.length + (4 - pad.length % 4) % 4, '='))
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function b64urlEncode(buf: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function signBondApproval(
  privateKeyB64: string,
  requestId: string,
  requesterDid: string,
  timestamp: number,
): Promise<string> {
  const msg = `aptogon-bond-approval:v1:${requestId}:${requesterDid}:${timestamp}`
  const keyBytes = b64urlDecode(privateKeyB64)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes.buffer as ArrayBuffer,
    { name: 'Ed25519' } as AlgorithmIdentifier,
    false, ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    cryptoKey,
    new TextEncoder().encode(msg),
  )
  return b64urlEncode(new Uint8Array(sig))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtTime = (ts: number) => {
  const d = new Date(ts * 1000)
  return d.toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const fmtAge = (ts: number) => {
  const mins = Math.floor((Date.now() / 1000 - ts) / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`
}

const confColor = (c: number) =>
  c >= 0.9 ? '#059669' : c >= 0.7 ? '#0891b2' : '#f97316'

const confLabel = (c: number) =>
  c >= 0.9 ? '🟢 High' : c >= 0.7 ? '🔵 Medium' : '🟠 Low'

const getWsBase = () => {
  if (typeof window === 'undefined') return ''
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BondPanel() {
  const [myDid, setMyDid]           = useState('')
  const [myKey, setMyKey]           = useState('')
  const [isGold, setIsGold]         = useState<boolean | null>(null)
  const [requests, setRequests]     = useState<PendingRequest[]>([])
  const [loading, setLoading]       = useState(true)
  const [wsStatus, setWsStatus]     = useState<WsStatus>('disconnected')
  const [processing, setProcessing] = useState<Set<string>>(new Set())
  const [done, setDone]             = useState<Set<string>>(new Set())
  const [alerts, setAlerts]         = useState<{ id: string; ok: boolean; msg: string }[]>([])
  const [canSign, setCanSign]       = useState(true)

  const wsRef        = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const doneRef      = useRef<Set<string>>(done)

  // Keep doneRef in sync
  useEffect(() => { doneRef.current = done }, [done])

  // Check Ed25519 support
  useEffect(() => {
    crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign'])
      .catch(() => setCanSign(false))
  }, [])

  // Load identity + check gold member status
  useEffect(() => {
    const did = localStorage.getItem('hsi_did') || ''
    const key = localStorage.getItem('aptogon_key') || ''
    setMyDid(did)
    setMyKey(key)
    if (!did) { setIsGold(false); setLoading(false); return }
    // Refresh session token if we have a key, then check admin status
    const init = async () => {
      if (key) await getSessionToken(did, key).catch(() => {})
      fetch('/api/admin/me', { headers: aptogonHeaders(did) })
        .then(r => r.json())
        .then(d => setIsGold(d.role === 'gold_member' || d.role === 'admin'))
        .catch(() => setIsGold(false))
    }
    init()
  }, [])

  // ── Manual refresh (HTTP fallback) ─────────────────────────────────────────
  const load = useCallback(async (did: string) => {
    if (!did) return
    try {
      const r = await fetch('/api/bond/pending-for-guarantor', {
        headers: { ...aptogonHeaders(did), 'X-Approver-DID': did },
      })
      const data = await r.json()
      setRequests((data.requests ?? []).filter((req: PendingRequest) => !doneRef.current.has(req.id)))
    } catch {}
    setLoading(false)
  }, [])

  // ── WebSocket connection ────────────────────────────────────────────────────
  const connectWs = useCallback((did: string) => {
    if (!did) return
    const base = getWsBase()
    if (!base) return

    setWsStatus('connecting')
    const ws = new WebSocket(`${base}/ws/gold-panel`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', did }))
      // Heartbeat every 25s to keep connection alive through proxies
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}')
      }, 25_000)
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)

        if (msg.type === 'auth_ok') {
          setWsStatus('connected')
          setLoading(false)
          return
        }

        // Queued requests delivered on connect
        if (msg.type === 'bond:queue') {
          const fresh = (msg.requests as PendingRequest[]).filter(r => !doneRef.current.has(r.id))
          setRequests(fresh)
          setLoading(false)
          return
        }

        // New request pushed in real time
        if (msg.type === 'bond:request') {
          const req: PendingRequest = msg.request
          if (!req || doneRef.current.has(req.id)) return
          setRequests(prev => {
            if (prev.find(x => x.id === req.id)) return prev
            return [req, ...prev]
          })
          addAlert(`new_${req.id}`, true,
            `🔔 New bond request · ${confLabel(req.confidence)} · …${req.requester_did.slice(-8)}`
          )
          return
        }

        if (msg.type === 'pong') return
        if (msg.type === 'error') {
          addAlert(`ws_err_${Date.now()}`, false, `WS: ${msg.message}`)
        }
      } catch {}
    }

    ws.onerror = () => {
      setWsStatus('disconnected')
    }

    ws.onclose = () => {
      setWsStatus('disconnected')
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null }
      // Auto-reconnect after 6 seconds
      reconnectRef.current = setTimeout(() => connectWs(did), 6_000)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Start WS after gold status confirmed
  useEffect(() => {
    if (!isGold || !myDid) return
    connectWs(myDid)
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (pingRef.current)      clearInterval(pingRef.current)
      wsRef.current?.close()
    }
  }, [isGold, myDid, connectWs])

  const addAlert = (id: string, ok: boolean, msg: string) => {
    setAlerts(a => [...a, { id, ok, msg }])
    setTimeout(() => setAlerts(a => a.filter(x => x.id !== id)), 5000)
  }

  const approve = async (req: PendingRequest) => {
    if (!myKey) { addAlert(req.id, false, 'Private key not found in localStorage'); return }
    setProcessing(p => new Set(p).add(req.id))
    try {
      const timestamp = Math.floor(Date.now() / 1000)
      const signature = await signBondApproval(myKey, req.id, req.requester_did, timestamp)
      const r = await fetch('/api/bond/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aptogonHeaders(myDid) },
        body: JSON.stringify({
          request_id:   req.id,
          approver_did: myDid,
          timestamp,
          signature,
        }),
      })
      const data = await r.json()
      if (r.ok) {
        setDone(d => new Set(d).add(req.id))
        setRequests(rs => rs.filter(x => x.id !== req.id))
        const msg = data.status === 'credential_issued'
          ? `✅ Credential issued! tx: ${(data.tx_hash as string)?.slice(0, 14)}…`
          : `✅ Vouched (${data.approvals}/${data.approvals + data.needed} total)`
        addAlert(req.id + '_ok', true, msg)
      } else {
        addAlert(req.id, false, data.detail?.message ?? data.detail ?? 'Approve failed')
      }
    } catch (e: unknown) {
      addAlert(req.id, false, `Error: ${e instanceof Error ? e.message : String(e)}`)
    }
    setProcessing(p => { const n = new Set(p); n.delete(req.id); return n })
  }

  const reject = async (req: PendingRequest) => {
    setProcessing(p => new Set(p).add(req.id))
    try {
      const r = await fetch(
        `/api/bond/reject?request_id=${req.id}&rejecter_did=${encodeURIComponent(myDid)}`,
        { method: 'POST', headers: aptogonHeaders(myDid) },
      )
      if (r.ok) {
        setDone(d => new Set(d).add(req.id))
        setRequests(rs => rs.filter(x => x.id !== req.id))
        addAlert(req.id + '_rej', false, `Rejected request from …${req.requester_did.slice(-8)}`)
      }
    } catch {}
    setProcessing(p => { const n = new Set(p); n.delete(req.id); return n })
  }

  // ── Access denied screens ─────────────────────────────────────────────────

  if (!myDid) return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🔒</div>
        <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>Verification required</h2>
        <p style={{ color: '#64748b', marginBottom: 24 }}>You need to verify your identity first.</p>
        <Link href="/verify" style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', borderRadius: 14, fontWeight: 700, textDecoration: 'none' }}>🔑 Verify</Link>
      </div>
    </div>
  )

  if (isGold === false) return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>👑</div>
        <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>Gold Member access required</h2>
        <p style={{ color: '#64748b', marginBottom: 8, fontSize: 14 }}>This panel is for verified Gold Members of the HSI network.</p>
        <code style={{ fontSize: 12, color: '#94a3b8' }}>…{myDid.slice(-8)}</code>
        <div style={{ marginTop: 24 }}>
          <Link href="/chat" style={{ color: '#7c3aed', fontWeight: 600, textDecoration: 'none' }}>← Back to chat</Link>
        </div>
      </div>
    </div>
  )

  // ── Main panel ────────────────────────────────────────────────────────────

  const myShort = myDid.slice(-8)
  const wsIndicator =
    wsStatus === 'connected'     ? { dot: '#22c55e', label: 'Live' } :
    wsStatus === 'connecting'    ? { dot: '#f59e0b', label: 'Connecting…' } :
                                   { dot: '#ef4444', label: 'Offline' }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui', padding: '28px 20px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#0f172a' }}>
              👑 Bond Panel
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
              Gold Member · <code style={{ fontFamily: 'monospace' }}>{myShort}</code>
              {!myKey    && <span style={{ marginLeft: 8, color: '#ef4444', fontWeight: 600 }}>⚠️ Private key not found</span>}
              {!canSign  && <span style={{ marginLeft: 8, color: '#f97316', fontWeight: 600 }}>⚠️ Ed25519 not supported</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* WS status dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: wsIndicator.dot, display: 'inline-block', boxShadow: wsStatus === 'connected' ? `0 0 6px ${wsIndicator.dot}` : 'none' }} />
              {wsIndicator.label}
            </div>
            <button
              onClick={() => load(myDid)}
              title="Manual refresh (HTTP)"
              style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', fontSize: 12, color: '#64748b', cursor: 'pointer' }}
            >↻</button>
            <Link href="/chat" style={{ color: '#7c3aed', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>← Chat</Link>
          </div>
        </div>

        {/* Alerts */}
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 50, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map(a => (
            <div key={a.id} style={{ background: a.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${a.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 12, padding: '10px 16px', fontSize: 13, color: a.ok ? '#16a34a' : '#dc2626', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxWidth: 320 }}>
              {a.msg}
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div style={{ background: 'linear-gradient(135deg,#7c3aed,#2563eb)', borderRadius: 16, padding: '16px 22px', marginBottom: 22, color: '#fff', display: 'flex', alignItems: 'center', gap: 24 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{loading ? '…' : requests.length}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>pending requests</div>
          </div>
          <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.2)' }} />
          <div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{done.size}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>processed today</div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: wsIndicator.dot, display: 'inline-block' }} />
            {wsStatus === 'connected' ? 'Push updates active' : wsStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </div>
        </div>

        {/* No private key warning */}
        {!myKey && (
          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: 13, color: '#92400e' }}>
            ⚠️ <strong>Private key not found.</strong> To approve requests, your private key must be in localStorage (<code>aptogon_key</code>). Verify on this device or restore from backup.
          </div>
        )}

        {/* Queue */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontSize: 14 }}>
            {wsStatus === 'connecting' ? 'Connecting to server…' : 'Loading pending requests…'}
          </div>
        ) : requests.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 18, border: '1.5px solid #e2e8f0', padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h3 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: 18, fontWeight: 800 }}>All clear</h3>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
              No pending bond requests. New requests will appear here automatically.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {requests.map(req => {
              const busy    = processing.has(req.id)
              const ageMin  = Math.floor((Date.now() / 1000 - req.created_at) / 60)
              const isOld   = ageMin > 60   // waiting >1h — show warning

              return (
                <div key={req.id} style={{ background: '#fff', borderRadius: 18, border: `1.5px solid ${isOld ? '#fde68a' : '#e2e8f0'}`, padding: '20px 22px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>

                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                        <code style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                          …{req.requester_did.slice(-12)}
                        </code>
                        <span style={{ fontSize: 11, fontWeight: 700, color: confColor(req.confidence), background: `${confColor(req.confidence)}15`, padding: '2px 8px', borderRadius: 99 }}>
                          {confLabel(req.confidence)} · {Math.round(req.confidence * 100)}%
                        </span>
                        <span style={{ fontSize: 11, color: isOld ? '#b45309' : '#94a3b8' }} title={fmtTime(req.created_at)}>
                          {isOld ? `⏰ ${fmtAge(req.created_at)}` : fmtAge(req.created_at)}
                        </span>
                      </div>

                      {/* Progress dots */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {[1, 2, 3].map(i => (
                            <div key={i} style={{ width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, background: i <= req.approvals_count ? '#f0fdf4' : '#f8fafc', border: `1.5px solid ${i <= req.approvals_count ? '#86efac' : '#e2e8f0'}`, color: i <= req.approvals_count ? '#16a34a' : '#94a3b8' }}>
                              {i <= req.approvals_count ? '✓' : i}
                            </div>
                          ))}
                        </div>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          {req.approvals_count}/3 vouches · need {req.needed} more
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => approve(req)}
                        disabled={busy || !myKey || !canSign}
                        style={{ padding: '9px 20px', background: busy || !myKey || !canSign ? '#e2e8f0' : 'linear-gradient(135deg,#059669,#10b981)', color: busy || !myKey || !canSign ? '#94a3b8' : '#fff', fontWeight: 700, fontSize: 13, border: 'none', borderRadius: 10, cursor: busy || !myKey || !canSign ? 'default' : 'pointer', transition: 'all 0.15s' }}
                      >
                        {busy ? '⏳' : '✓ Vouch'}
                      </button>
                      <button
                        onClick={() => reject(req)}
                        disabled={busy}
                        style={{ padding: '9px 14px', background: '#fff', color: '#ef4444', fontWeight: 600, fontSize: 13, border: '1.5px solid #fecaca', borderRadius: 10, cursor: busy ? 'default' : 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Message */}
                  {req.message && (
                    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#475569', borderLeft: '3px solid #c4b5fd', fontStyle: 'italic' }}>
                      &ldquo;{req.message.slice(0, 200)}{req.message.length > 200 ? '…' : ''}&rdquo;
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
