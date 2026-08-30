'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { aptogonHeaders, autoRefreshSession } from '@/lib/sessionAuth'

const API = process.env.NEXT_PUBLIC_API_URL || ''
const MAX_RETRIES = 3

// WebSocket base — must be absolute (ws:// / wss://); derived from window.location at runtime
const getWsBase = () => {
  if (API) return API.replace(/^http/, 'ws')
  if (typeof window === 'undefined') return ''
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Candidate {
  did_hash_short: string
  reputation: number
  bond_count: number
  success_rate: number
  last_active_days: number
}

interface BondStatus {
  request_id: string
  status: string
  auto_approved: boolean
  approvals: number
  needed: number
  tx_hash?: string
}

interface IncomingBondRequest {
  type: 'bond:request'
  request_id: string
  requester: string
  confidence_badge: string
  message: string
  ts: number
}

interface BondChatMsg {
  from: 'requester' | 'guarantor'
  text: string
  ts: number
}

// ── Trust levels data (labels injected from translations inside component) ────

const TRUST_LEVELS_DATA = [
  { bonds: '0',  score: 10,  color: '#7c3aed', bg: '#faf5ff', icon: '🌱', key: 'newcomer' },
  { bonds: '3',  score: 50,  color: '#0891b2', bg: '#f0f9ff', icon: '✅', key: 'community' },
  { bonds: '7+', score: 100, color: '#059669', bg: '#f0fdf4', icon: '🏆', key: 'trusted' },
]

const HOW_STEPS_DATA = [
  { icon: '✍️', color: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff', key: 'step1' },
  { icon: '🤝', color: '#0891b2', bg: '#f0f9ff', border: '#bae6fd', key: 'step2' },
  { icon: '🏆', color: '#059669', bg: '#f0fdf4', border: '#bbf7d0', key: 'step3' },
]

const PENALTY_KEYS = [
  { delta: '−0.1', key: 'penalty1', bad: true },
  { delta: '−0.2', key: 'penalty2', bad: true },
  { delta: '+0.1', key: 'reward1',  bad: false },
  { delta: '+0.05', key: 'reward2', bad: false },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function BondPage() {
  const t = useTranslations('bond')

  const TRUST_LEVELS = TRUST_LEVELS_DATA.map(l => ({
    ...l,
    label: l.key === 'newcomer' ? t('level_newcomer') : l.key === 'community' ? t('level_community') : t('level_trusted'),
  }))

  const HOW_STEPS = HOW_STEPS_DATA.map(s => ({
    ...s,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    title: t(`${s.key}_title` as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    desc:  t(`${s.key}_desc`  as any),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PENALTY_ROWS = PENALTY_KEYS.map(r => ({ ...r, event: t(r.key as any) }))

  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [knownDids, setKnownDids] = useState<string[]>(['', '', ''])
  const [showKnownDids, setShowKnownDids] = useState(false)
  const [stage, setStage] = useState<'browse' | 'requesting' | 'waiting' | 'done' | 'failed'>('browse')
  const [approvals, setApprovals] = useState(0)
  const [txHash, setTxHash] = useState('')
  const [autoApproved, setAutoApproved] = useState(false)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [incomingRequests, setIncomingRequests] = useState<IncomingBondRequest[]>([])
  const [chatMsgs, setChatMsgs] = useState<Record<string, BondChatMsg[]>>({})
  const [chatInput, setChatInput] = useState('')
  const [activeChatReqId, setActiveChatReqId] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const requestIdRef = useRef<string>('')

  // ── WebSocket ───────────────────────────────────────────────────────────────
  const handleWsMessage = useCallback((msg: Record<string, unknown>) => {
    const type = msg.type as string
    const reqId = msg.request_id as string | undefined
    if (type === 'bond:request') {
      setIncomingRequests(prev => prev.find(r => r.request_id === reqId) ? prev : [msg as unknown as IncomingBondRequest, ...prev].slice(0, 20))
    } else if (type === 'bond:approved') {
      setApprovals(msg.approvals as number)
    } else if (type === 'bond:complete') {
      setApprovals(3)
      if (msg.tx_hash) setTxHash(msg.tx_hash as string)
      setTimeout(() => setStage('done'), 600)
    } else if (type === 'bond:retry') {
      setRetryCount(msg.retry_num as number); setApprovals(0)
    } else if (type === 'bond:failed') {
      setStage('failed')
    } else if (type === 'bond:chat' && reqId) {
      const m: BondChatMsg = { from: msg.from as 'requester' | 'guarantor', text: msg.text as string, ts: msg.ts as number }
      setChatMsgs(prev => ({ ...prev, [reqId]: [...(prev[reqId] ?? []), m] }))
    }
  }, [])

  const connectWS = useCallback((didHash: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(`${getWsBase()}/ws/${didHash}`)
    wsRef.current = ws
    ws.onmessage = e => { try { handleWsMessage(JSON.parse(e.data)) } catch { } }
    const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}') }, 25000)
    ws.onclose = () => { clearInterval(ping); setTimeout(() => connectWS(didHash), 3000) }
  }, [handleWsMessage])

  useEffect(() => {
    const did = typeof window !== 'undefined' ? localStorage.getItem('aptogon_did') : null
    if (did) {
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(did)).then(buf => {
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
        connectWS(hash)
      })
    }
    return () => { wsRef.current?.close(); if (pollRef.current) clearInterval(pollRef.current) }
  }, [connectWS])

  useEffect(() => {
    autoRefreshSession().catch(() => {})
    const did = typeof window !== 'undefined' ? (localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did') || '') : ''
    const headers = aptogonHeaders(did)

    // Реальные кандидаты из API. Пустой список на холодном старте — корректное
    // состояние (запрос всё равно уходит push'ом Gold Members). Никаких фейков.
    fetch(`${API}/api/bond/candidates`, { headers })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setCandidates(data)
        else if (data?.candidates && Array.isArray(data.candidates)) setCandidates(data.candidates)
        else setCandidates([])
      })
      .catch(() => setCandidates([]))
  }, [])

  const toggle = (hash: string) => setSelected(prev => { const n = new Set(prev); n.has(hash) ? n.delete(hash) : n.add(hash); return n })

  const sendChatMessage = (reqId: string, role: 'requester' | 'guarantor') => {
    if (!chatInput.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'bond:chat', request_id: reqId, text: chatInput.trim(), role }))
    setChatMsgs(prev => ({ ...prev, [reqId]: [...(prev[reqId] ?? []), { from: role, text: chatInput.trim(), ts: Date.now() / 1000 }] }))
    setChatInput('')
  }

  const approveIncoming = (reqId: string) => {
    const did = typeof window !== 'undefined' ? localStorage.getItem('aptogon_did') : ''
    wsRef.current?.send(JSON.stringify({ type: 'bond:approve', request_id: reqId, did }))
    setIncomingRequests(prev => prev.filter(r => r.request_id !== reqId))
  }

  const rejectIncoming = (reqId: string) => {
    const did = typeof window !== 'undefined' ? localStorage.getItem('aptogon_did') : ''
    wsRef.current?.send(JSON.stringify({ type: 'bond:reject', request_id: reqId, did: did || '' }))
    setIncomingRequests(prev => prev.filter(r => r.request_id !== reqId))
  }

  const sendRequests = async () => {
    setStage('requesting'); setError('')
    const did = typeof window !== 'undefined' ? (localStorage.getItem('aptogon_did') || '') : ''
    const credential = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('hsi_credential') || localStorage.getItem('HumanCredential') || 'null') : null
    const expressionProof = credential?.credentialSubject?.expression_proof || credential?.expression_proof || `stub_${Date.now()}`
    const confidence = credential?.credentialSubject?.confidence ?? credential?.confidence ?? 0.0
    try {
      const r = await fetch(`${API}/api/bond/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requester_did: did || `did:key:z6MkDemo${Date.now()}`, expression_proof: expressionProof, confidence, message: 'Requesting vouching from the HSI network', known_dids: knownDids.filter(d => d.trim().startsWith('did:key:z')) }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data: BondStatus = await r.json()
      requestIdRef.current = data.request_id
      if (data.status === 'approved' && data.auto_approved) {
        setStage('waiting'); setAutoApproved(true)
        if (data.tx_hash) setTxHash(data.tx_hash)
        let count = 0
        const iv = setInterval(() => { count++; setApprovals(count); if (count >= 3) { clearInterval(iv); setTimeout(() => setStage('done'), 600) } }, 500)
        return
      }
      setStage('waiting')
      pollRef.current = setInterval(async () => {
        const s = await fetch(`${API}/api/bond/status/${data.request_id}`).then(x => x.json()).catch(() => null)
        if (!s) return
        setApprovals(s.approvals)
        if (s.status === 'approved') { if (pollRef.current) clearInterval(pollRef.current); if (s.tx_hash) setTxHash(s.tx_hash); setAutoApproved(s.auto_approved); setTimeout(() => setStage('done'), 600) }
        else if (s.status === 'failed') { if (pollRef.current) clearInterval(pollRef.current); setStage('failed') }
      }, 2500)
    } catch {
      setStage('waiting')
      let count = 0
      const iv = setInterval(() => { count++; setApprovals(count); if (count >= 3) { clearInterval(iv); setTimeout(() => setStage('done'), 600) } }, 1800)
    }
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  if (stage === 'done') return (
    <div style={{ minHeight: '100vh', background: '#faf5ff', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 48 }}>🏆</div>
        <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>{t('done_title')}</h1>
        {autoApproved
          ? <p style={{ color: '#7c3aed', marginBottom: 4, fontSize: '0.95rem', fontWeight: 600 }}>{t('done_auto_msg')}</p>
          : <p style={{ color: '#059669', marginBottom: 4, fontWeight: 600 }}>{t('done_human_msg')}</p>}
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: txHash ? 12 : 28 }}>{t('done_blockchain')}</p>
        {txHash && <p style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#7c3aed', background: '#f3e8ff', padding: '8px 14px', borderRadius: 10, marginBottom: 24, wordBreak: 'break-all' }}>tx: {txHash.slice(0, 42)}…</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/chat" style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, borderRadius: 12, textDecoration: 'none' }}>{t('done_chat')}</Link>
          <Link href="/" style={{ padding: '12px 28px', background: '#fff', color: '#374151', fontWeight: 600, borderRadius: 12, border: '1.5px solid #e9d5ff', textDecoration: 'none' }}>{t('home_link')}</Link>
        </div>
      </div>
    </div>
  )

  if (stage === 'failed') return (
    <div style={{ minHeight: '100vh', background: '#faf5ff', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>😔</div>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>{t('failed_title')}</h1>
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 8 }}>{t('failed_desc_1')} {MAX_RETRIES} {t('failed_desc_2')}</p>
        <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 28 }}>{t('failed_hint')}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => { setStage('browse'); setApprovals(0); setRetryCount(0) }}
            style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, borderRadius: 12, border: 'none', cursor: 'pointer' }}>
            {t('retry_btn')}
          </button>
          <a href="https://t.me/aptogon" target="_blank" rel="noopener noreferrer"
            style={{ padding: '12px 28px', background: '#0088cc', color: '#fff', fontWeight: 700, borderRadius: 12, border: 'none', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.1 13.67 5.12 12.77c-.663-.207-.676-.663.136-.983l10.86-4.188c.549-.2 1.03.134.778.622z" fill="#fff"/>
            </svg>
            Telegram
          </a>
        </div>
      </div>
    </div>
  )

  if (stage === 'waiting' || stage === 'requesting') return (
    <div style={{ minHeight: '100vh', background: '#faf5ff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg, #2d1b69 0%, #4c1d95 100%)', padding: '48px 24px 40px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🤝</div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', marginBottom: 8 }}>
          {stage === 'requesting' ? t('waiting_sending') : autoApproved ? t('waiting_ai') : t('waiting_title')}
        </h1>
        <p style={{ color: '#c4b5fd', fontSize: '0.9rem' }}>
          {retryCount > 0 ? t('retry_label').replace('{n}', String(retryCount)) : t('requests_sent')}
        </p>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '40px 24px' }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 32 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, border: `2px solid ${approvals >= i ? '#059669' : '#e9d5ff'}`, background: approvals >= i ? '#f0fdf4' : '#fff', transition: 'all 0.5s', boxShadow: approvals >= i ? '0 4px 16px rgba(5,150,105,0.2)' : 'none' }}>
                {approvals >= i ? '✓' : '?'}
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: approvals >= i ? '#059669' : '#94a3b8' }}>
                {approvals >= i ? t('vouched') : t('awaiting')}
              </span>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e9d5ff', padding: '16px 20px', textAlign: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#7c3aed' }}>{approvals}</span>
          <span style={{ color: '#64748b', fontSize: '0.9rem' }}>{t('vouches_needed')}</span>
          {autoApproved && <p style={{ color: '#7c3aed', fontSize: '0.78rem', margin: '6px 0 0', fontWeight: 600 }}>{t('ai_auto_approve')}</p>}
        </div>

        {/* Anonymous chat */}
        {requestIdRef.current && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e9d5ff', padding: '16px 20px' }}>
            <p style={{ color: '#7c3aed', fontSize: '0.82rem', fontWeight: 700, marginBottom: 10, marginTop: 0 }}>{t('anon_chat')}</p>
            <div style={{ minHeight: 48, maxHeight: 120, overflowY: 'auto', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(chatMsgs[requestIdRef.current] ?? []).map((m, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: '#374151', background: m.from === 'guarantor' ? '#f0fdf4' : '#faf5ff', borderRadius: 8, padding: '6px 12px', border: `1px solid ${m.from === 'guarantor' ? '#bbf7d0' : '#e9d5ff'}` }}>
                  <span style={{ fontWeight: 700, color: m.from === 'guarantor' ? '#059669' : '#7c3aed' }}>{m.from === 'guarantor' ? t('you_guarantor') : t('you_requester')}: </span>{m.text}
                </div>
              ))}
              {!(chatMsgs[requestIdRef.current]?.length) && <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: 0 }}>{t('write_placeholder')}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChatMessage(requestIdRef.current!, 'requester')}
                placeholder={t('write_placeholder')}
                style={{ flex: 1, border: '1px solid #e9d5ff', borderRadius: 10, padding: '9px 14px', fontSize: '0.85rem', outline: 'none', color: '#0f172a', background: '#faf5ff' }} />
              <button onClick={() => sendChatMessage(requestIdRef.current!, 'requester')}
                style={{ padding: '9px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700 }}>→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // ── Browse / main page ───────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#faf5ff', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #2d1b69 0%, #4c1d95 100%)', padding: '72px 24px 60px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🤝</div>
        <h1 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, color: '#fff', marginBottom: 16 }}>
          {t('hero_title')}
        </h1>
        <p style={{ color: '#c4b5fd', fontSize: '1.05rem', maxWidth: 520, margin: '0 auto 24px' }}>
          {t('hero_subtitle')}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/verify" style={{ padding: '12px 28px', background: '#fff', color: '#7c3aed', fontWeight: 700, borderRadius: 12, textDecoration: 'none' }}>
            {t('cta_verify_short')}
          </Link>
          <a href="#request" style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.12)', color: '#e9d5ff', fontWeight: 600, borderRadius: 12, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.2)' }}>
            {t('cta_request')}
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '56px 24px' }}>

        {/* ── How it works ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#111827', marginBottom: 6 }}>{t('how_title')}</h2>
          <p style={{ color: '#6b7280', marginBottom: 24, fontSize: '0.9rem' }}>{t('how_subtitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {HOW_STEPS.map((s, i) => (
              <div key={i} style={{ background: s.bg, borderRadius: 20, border: `1.5px solid ${s.border}`, padding: '28px 24px' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#fff', border: `1.5px solid ${s.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>{s.icon}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 22, height: 22, background: s.color, color: '#fff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 900 }}>{i + 1}</span>
                  <span style={{ fontWeight: 800, color: '#111827', fontSize: '0.95rem' }}>{s.title}</span>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Trust Score ───────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#111827', marginBottom: 6 }}>{t('trust_algo_title')}</h2>
          <p style={{ color: '#6b7280', marginBottom: 20, fontSize: '0.9rem' }}>{t('trust_algo_subtitle')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
            {TRUST_LEVELS.map(l => (
              <div key={l.key} style={{ background: l.bg, borderRadius: 18, border: `1.5px solid ${l.color}30`, padding: '22px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 26 }}>{l.icon}</span>
                  <div>
                    <div style={{ fontWeight: 800, color: '#111827', fontSize: '0.9rem' }}>{l.label}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('after_bonds').replace('{n}', l.bonds)}</div>
                  </div>
                </div>
                <div style={{ height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ height: '100%', width: `${l.score}%`, background: `linear-gradient(90deg, ${l.color}80, ${l.color})`, borderRadius: 99 }} />
                </div>
                <div style={{ fontWeight: 900, fontSize: '1.2rem', color: l.color }}>{l.score}%</div>
              </div>
            ))}
          </div>

          {/* Risk table */}
          <div style={{ background: '#fff', borderRadius: 18, border: '1px solid #e9d5ff', padding: '22px 24px' }}>
            <div style={{ fontWeight: 800, color: '#111827', fontSize: '0.9rem', marginBottom: 14 }}>{t('risks_title')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PENALTY_ROWS.map(row => (
                <div key={row.event} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: '0.9rem', color: row.bad ? '#ef4444' : '#059669', minWidth: 52 }}>{row.delta}</span>
                  <span style={{ fontSize: '0.83rem', color: '#64748b' }}>{row.event}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 14, marginBottom: 0 }}>
              {t('risks_note')}
            </p>
          </div>
        </section>

        {/* ── Incoming requests (guarantor mode) ────────────────────────────── */}
        {incomingRequests.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#111827', marginBottom: 6 }}>
              {t('incoming_title')} <span style={{ background: '#7c3aed', color: '#fff', borderRadius: 99, padding: '2px 10px', fontSize: '0.8rem', marginInlineStart: 6 }}>{incomingRequests.length}</span>
            </h2>
            <p style={{ color: '#6b7280', marginBottom: 20, fontSize: '0.9rem' }}>{t('incoming_subtitle')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {incomingRequests.map(req => (
                <div key={req.request_id} style={{ background: '#fff', borderRadius: 18, border: '1.5px solid #e9d5ff', padding: '20px 22px', boxShadow: '0 2px 12px rgba(124,58,237,0.07)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#7c3aed', background: '#faf5ff', padding: '3px 10px', borderRadius: 8 }}>{req.requester}…</span>
                        <span style={{ fontSize: '0.75rem', background: '#f0f9ff', color: '#0891b2', padding: '2px 10px', borderRadius: 20, fontWeight: 700 }}>{req.confidence_badge}</span>
                      </div>
                      {req.message && <p style={{ color: '#64748b', fontSize: '0.82rem', margin: 0 }}>«{req.message.slice(0, 120)}»</p>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => approveIncoming(req.request_id)}
                        style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#059669,#10b981)', color: '#fff', fontWeight: 700, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
                        {t('vouch_btn')}
                      </button>
                      <button onClick={() => rejectIncoming(req.request_id)}
                        style={{ padding: '9px 14px', background: '#f8fafc', color: '#64748b', fontWeight: 600, borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.85rem' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                  {/* Mini chat */}
                  <div style={{ borderTop: '1px solid #f3e8ff', paddingTop: 12 }}>
                    <div style={{ maxHeight: 80, overflowY: 'auto', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(chatMsgs[req.request_id] ?? []).map((m, i) => (
                        <div key={i} style={{ fontSize: '0.78rem', color: '#374151', background: m.from === 'requester' ? '#faf5ff' : '#f0fdf4', borderRadius: 7, padding: '5px 10px' }}>
                          <span style={{ fontWeight: 700, color: m.from === 'requester' ? '#7c3aed' : '#059669' }}>{m.from === 'requester' ? t('requester_role') : t('you_guarantor')}: </span>{m.text}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 7 }}>
                      <input value={activeChatReqId === req.request_id ? chatInput : ''}
                        onChange={e => { setActiveChatReqId(req.request_id); setChatInput(e.target.value) }}
                        onKeyDown={e => e.key === 'Enter' && activeChatReqId === req.request_id && sendChatMessage(req.request_id, 'guarantor')}
                        placeholder={t('ask_placeholder')}
                        style={{ flex: 1, border: '1px solid #e9d5ff', borderRadius: 9, padding: '7px 12px', fontSize: '0.8rem', outline: 'none', color: '#0f172a', background: '#faf5ff' }} />
                      <button onClick={() => { setActiveChatReqId(req.request_id); sendChatMessage(req.request_id, 'guarantor') }}
                        style={{ padding: '7px 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer' }}>→</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Request vouching ──────────────────────────────────────────────── */}
        <section id="request" style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#111827', marginBottom: 6 }}>{t('request_title')}</h2>
          <p style={{ color: '#6b7280', marginBottom: 20, fontSize: '0.9rem' }}>
            {t('request_subtitle_1')} <strong style={{ color: '#111827' }}>{t('request_subtitle_2')}</strong> {t('request_subtitle_3')}
          </p>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}

          {/* Selection bar */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e9d5ff', padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', boxShadow: '0 2px 12px rgba(124,58,237,0.06)' }}>
            <div>
              <span style={{ fontWeight: 900, fontSize: '1.15rem', color: '#7c3aed' }}>{selected.size}</span>
              <span style={{ color: '#64748b', fontSize: '0.9rem' }}>{t('selected')}</span>
            </div>
            <button onClick={sendRequests} disabled={selected.size < 3}
              style={{ padding: '11px 28px', background: selected.size >= 3 ? 'linear-gradient(135deg,#7c3aed,#2563eb)' : '#f1f5f9', color: selected.size >= 3 ? '#fff' : '#94a3b8', fontWeight: 700, borderRadius: 12, border: 'none', cursor: selected.size >= 3 ? 'pointer' : 'not-allowed', fontSize: '0.9rem', transition: 'all 0.2s', boxShadow: selected.size >= 3 ? '0 4px 16px rgba(124,58,237,0.3)' : 'none' }}>
              {t('send_requests')}
            </button>
          </div>

          {/* Empty state — нет онлайн-поручителей (холодный старт сети) */}
          {candidates.length === 0 && (
            <div style={{ padding: '28px 24px', borderRadius: 16, border: '1.5px dashed #e9d5ff', background: '#faf5ff', textAlign: 'center', color: '#7c3aed' }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>🌱</div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>{t('no_candidates_title')}</div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', lineHeight: 1.5 }}>{t('no_candidates_hint')}</div>
            </div>
          )}

          {/* Candidates grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {candidates.map(c => {
              const isSel = selected.has(c.did_hash_short)
              return (
                <button key={c.did_hash_short} onClick={() => toggle(c.did_hash_short)}
                  style={{ textAlign: 'start', padding: '16px 18px', borderRadius: 16, border: `2px solid ${isSel ? '#7c3aed' : '#e9d5ff'}`, background: isSel ? '#faf5ff' : '#fff', cursor: 'pointer', transition: 'all 0.15s', boxShadow: isSel ? '0 4px 16px rgba(124,58,237,0.12)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, background: isSel ? '#7c3aed' : '#f3e8ff', color: isSel ? '#fff' : '#7c3aed' }}>
                        {c.did_hash_short.slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#94a3b8' }}>{c.did_hash_short}</span>
                    </div>
                    <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${isSel ? '#7c3aed' : '#e9d5ff'}`, background: isSel ? '#7c3aed' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#fff', transition: 'all 0.15s' }}>
                      {isSel && '✓'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: '0.8rem', flexWrap: 'wrap' }}>
                    <span style={{ color: '#d97706', fontWeight: 700 }}>⭐ {c.reputation}</span>
                    <span style={{ color: '#059669', fontWeight: 600 }}>{(c.success_rate * 100).toFixed(0)}%</span>
                    <span style={{ color: '#94a3b8' }}>{c.bond_count} bonds</span>
                    <span style={{ color: '#c4b5fd' }}>{t('days_ago').replace('{n}', String(c.last_active_days))}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* ── Known people invite ─────────────────────────────────────────── */}
          <div style={{ marginTop: 20 }}>
            <button
              onClick={() => setShowKnownDids(!showKnownDids)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: showKnownDids ? '#faf5ff' : '#fff', border: `1.5px solid ${showKnownDids ? '#c4b5fd' : '#e9d5ff'}`, borderRadius: 14, padding: '12px 20px', cursor: 'pointer', width: '100%', textAlign: 'start', transition: 'all 0.18s' }}
            >
              <span style={{ fontSize: '1rem' }}>💌</span>
              <span style={{ fontWeight: 700, color: '#7c3aed', fontSize: '0.9rem', flex: 1 }}>{t('known_dids_title')}</span>
              {knownDids.filter(d => d.trim().startsWith('did:key:z')).length > 0 && (
                <span style={{ background: '#7c3aed', color: '#fff', borderRadius: 99, padding: '1px 8px', fontSize: '0.75rem', fontWeight: 700 }}>
                  {knownDids.filter(d => d.trim().startsWith('did:key:z')).length}
                </span>
              )}
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginInlineStart: 4 }}>{showKnownDids ? '▲' : '▼'}</span>
            </button>

            {showKnownDids && (
              <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e9d5ff', padding: '20px 22px', marginTop: 8, boxShadow: '0 2px 12px rgba(124,58,237,0.05)' }}>
                <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '0 0 16px' }}>{t('known_dids_subtitle')}</p>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ marginBottom: i < 2 ? 10 : 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 24, height: 24, background: knownDids[i].trim().startsWith('did:key:z') ? '#7c3aed' : '#f3e8ff', color: knownDids[i].trim().startsWith('did:key:z') ? '#fff' : '#c4b5fd', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 900, flexShrink: 0, transition: 'all 0.15s' }}>
                      {i + 1}
                    </span>
                    <input
                      value={knownDids[i]}
                      onChange={e => { const n = [...knownDids]; n[i] = e.target.value; setKnownDids(n) }}
                      placeholder={t('known_dids_placeholder')}
                      style={{ flex: 1, border: `1.5px solid ${knownDids[i].trim().startsWith('did:key:z') ? '#c4b5fd' : '#e9d5ff'}`, borderRadius: 10, padding: '9px 14px', fontSize: '0.82rem', outline: 'none', color: '#0f172a', background: '#faf5ff', fontFamily: 'monospace', transition: 'border-color 0.15s' }}
                    />
                    {knownDids[i] && (
                      <button onClick={() => { const n = [...knownDids]; n[i] = ''; setKnownDids(n) }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '0.9rem', padding: '4px 6px', lineHeight: 1 }}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <p style={{ color: '#94a3b8', fontSize: '0.74rem', margin: '14px 0 0' }}>{t('known_dids_hint')}</p>
              </div>
            )}
          </div>
        </section>

        {/* ── Privacy note ──────────────────────────────────────────────────── */}
        <section style={{ background: 'linear-gradient(135deg, #2d1b69, #4c1d95)', borderRadius: 22, padding: '36px 32px', textAlign: 'center' }}>
          <h3 style={{ color: '#fff', fontWeight: 900, fontSize: '1.1rem', marginBottom: 10 }}>{t('privacy_title')}</h3>
          <p style={{ color: '#c4b5fd', fontSize: '0.88rem', maxWidth: 560, margin: '0 auto 24px', lineHeight: 1.7 }}>
            {t('privacy_body')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '11px 24px', background: '#fff', color: '#7c3aed', fontWeight: 700, borderRadius: 12, textDecoration: 'none', fontSize: '0.9rem' }}>
              {t('cta_verify_short')}
            </Link>
            <Link href="/manifest" style={{ padding: '11px 24px', background: 'rgba(255,255,255,0.1)', color: '#e9d5ff', fontWeight: 600, borderRadius: 12, textDecoration: 'none', fontSize: '0.9rem' }}>
              {t('manifest_link')}
            </Link>
            <Link href="/" style={{ padding: '11px 24px', background: 'rgba(255,255,255,0.06)', color: '#c4b5fd', fontWeight: 600, borderRadius: 12, textDecoration: 'none', fontSize: '0.9rem' }}>
              {t('home_link')}
            </Link>
          </div>
        </section>

      </div>
    </div>
  )
}
