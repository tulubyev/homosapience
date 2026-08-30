'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { QRCodeSVG } from 'qrcode.react'
import HumanBadge, { badgeStateFromCredential, type BadgeState } from '@/components/HumanBadge'
import { aptogonHeaders, autoRefreshSession } from '@/lib/sessionAuth'

const CHAT_STYLES = `
  .chat-sidebar-left  { width: 220px; flex-shrink: 0; }
  .chat-sidebar-right { width: 210px; flex-shrink: 0; }
  /* mobile sidebar opens below global site header (56px) + chat header (~56px) */
  .chat-sidebar-left.mobile-open  { display: flex !important; position: fixed; top: 112px; left: 0; bottom: 0; z-index: 40; }
  @media (max-width: 767px) {
    .chat-sidebar-left  { display: none; }
    .chat-sidebar-right { display: none; }
    .chat-mobile-toggle { display: flex !important; }
  }
`

// ── Types ────────────────────────────────────────────────────────────────────

interface ReplyPreview { id: string; sender_short: string; content: string }

interface Message {
  id: string; sender_short: string; content: string; room: string
  timestamp: number; trust_label?: string; trust_score?: number
  reactions?: Record<string, string[]>; reply_to?: ReplyPreview
  is_system?: boolean; is_creator?: boolean; is_gold?: boolean
  display_name?: string; avatar_url?: string
}

interface Room {
  id: string; icon: string; label: string; desc: string
  access_level?: string; created_by?: string; custom?: boolean
}

interface Credential { did: string; trust_score: number; trust_label: string }

interface DmPartner { short: string; dm_room: string; last_ts: number; preview: string }

// ── Config ───────────────────────────────────────────────────────────────────

const ADMIN_SHORTS_BOOTSTRAP = ['bn57fN6G', 'sFMiySoP', 'zNRSNbbh']
const REACTIONS = ['❤️', '👍', '🤔', '✅', '🚀', '😮']
// Basic emoji palette for the composer.
const EMOJIS = [
  '😀', '😄', '😁', '😅', '😂', '🙂', '😉', '😍',
  '😘', '😎', '🤔', '😐', '😴', '😢', '😭', '😡',
  '👍', '👎', '👏', '🙏', '🔥', '✨', '🎉', '❤️',
  '💯', '🚀', '✅', '❌', '👀', '💪', '🤝', '🎯',
]
const TRUST_COLORS: Record<string, string> = {
  trusted: '#059669', community_verified: '#0891b2', newcomer: '#7c3aed',
}
const TRUST_BADGE_STATE: Record<string, BadgeState> = {
  trusted: 'verified', community_verified: 'verified', newcomer: 'verified',
  revoked: 'revoked', pending: 'pending',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
const fmtDateTime = (ts: number) => {
  const d = new Date(ts * 1000)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm} ${hh}:${min}`
}

// ── Web Push helpers ──────────────────────────────────────────────────────────

function urlBase64ToUint8Array(b64: string): ArrayBuffer {
  const pad = '='.repeat((4 - b64.length % 4) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

async function registerWebPush(myShort: string, apiBase: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

  try {
    // 1. Get VAPID public key
    const keyRes = await fetch(`${apiBase}/api/chat/push/vapid-key`)
    if (!keyRes.ok) return  // push not configured on this server
    const { public_key } = await keyRes.json()

    // 2. Register service worker
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready

    // 3. Check existing subscription first (avoid re-asking permission)
    let sub = await reg.pushManager.getSubscription()

    if (!sub) {
      // 4. Request permission once
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return

      // 5. Subscribe
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      })
    }

    // 6. Save subscription to backend
    await fetch(`${apiBase}/api/chat/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_short: myShort, subscription: sub.toJSON() }),
    })
  } catch { /* silent — push is optional */ }
}

const fmtBytes = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

const FILE_PREFIX = '__APTOGON_FILE__:'

interface FileMeta { url: string; name: string; size: number; type: string; expires_at?: number }

function parseFileMeta(content: string | null | undefined): FileMeta | null {
  if (!content || !content.startsWith(FILE_PREFIX)) return null
  try { return JSON.parse(content.slice(FILE_PREFIX.length)) } catch { return null }
}

const FILE_LIFETIME_S = 5 * 24 * 3600  // 5 days

function FileMessage({ meta, isMine, msgTs }: { meta: FileMeta; isMine: boolean; msgTs: number }) {
  const isImage = meta.type.startsWith('image/')
  const base = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || window.location.origin)
    : (process.env.NEXT_PUBLIC_API_URL || '')
  const fullUrl = meta.url.startsWith('http') ? meta.url : `${base}${meta.url}`

  // Expiry badge — use expires_at from meta if present, else derive from message timestamp
  const expiresAt = meta.expires_at ?? (msgTs + FILE_LIFETIME_S)
  const nowS = Date.now() / 1000
  const secsLeft = expiresAt - nowS
  const isExpired = secsLeft <= 0
  const isWarning = secsLeft > 0 && secsLeft < 24 * 3600

  const ExpiryBadge = () => {
    if (isExpired) return (
      <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, marginTop: 4 }}>⚠️ файл удалён</div>
    )
    if (isWarning) {
      const h = Math.max(1, Math.round(secsLeft / 3600))
      return (
        <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginTop: 4 }}>⏳ удалится через ~{h} ч</div>
      )
    }
    const daysLeft = Math.ceil(secsLeft / 86400)
    return (
      <div style={{ fontSize: 10, color: isMine ? 'rgba(255,255,255,0.45)' : '#94a3b8', marginTop: 4 }}>
        🗓 хранится ещё {daysLeft} д
      </div>
    )
  }

  if (isImage && !isExpired) {
    return (
      <div>
        <a href={fullUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fullUrl} alt={meta.name}
            style={{ maxWidth: 260, maxHeight: 200, borderRadius: 10, objectFit: 'cover', display: 'block', border: isMine ? '1.5px solid rgba(255,255,255,0.25)' : '1.5px solid #e9d5ff' }} />
        </a>
        <div style={{ fontSize: 10, color: isMine ? 'rgba(255,255,255,0.55)' : '#94a3b8', marginTop: 4 }}>{meta.name} · {fmtBytes(meta.size)}</div>
        <ExpiryBadge />
      </div>
    )
  }

  const FILE_ICONS: Record<string, string> = {
    'application/pdf': '📄',
    'application/zip': '🗜️',
    'application/x-zip-compressed': '🗜️',
    'text/plain': '📝',
    'application/msword': '📝',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  }
  const icon = isExpired ? '🗑️' : (FILE_ICONS[meta.type] || '📎')

  return (
    <div>
      <a href={isExpired ? undefined : fullUrl} download={isExpired ? undefined : meta.name}
        target="_blank" rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
          background: isMine ? 'rgba(255,255,255,0.12)' : '#f5f3ff',
          border: `1px solid ${isMine ? 'rgba(255,255,255,0.2)' : '#e9d5ff'}`,
          borderRadius: 12, padding: '10px 14px', maxWidth: 260,
          opacity: isExpired ? 0.55 : 1, cursor: isExpired ? 'default' : 'pointer' }}>
        <span style={{ fontSize: 28, flexShrink: 0 }}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: isMine ? '#fff' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.name}</div>
          <div style={{ fontSize: 11, color: isMine ? 'rgba(255,255,255,0.55)' : '#94a3b8', marginTop: 2 }}>{fmtBytes(meta.size)}</div>
        </div>
        {!isExpired && <span style={{ fontSize: 16, color: isMine ? 'rgba(255,255,255,0.7)' : '#7c3aed', flexShrink: 0 }}>⬇</span>}
      </a>
      <ExpiryBadge />
    </div>
  )
}

const shortDID = (did: string) => did.slice(-8)

const dmRoomId = (a: string, b: string) =>
  'dm_' + [a, b].sort().join('_')

const getProto = () =>
  typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
const getHost = () =>
  typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const getPort = () =>
  getHost() === 'localhost' ? ':8000' : ''
const wsUrl = (path: string) =>
  `${getProto()}://${getHost()}${getPort()}${path}`

// Render content with @mention highlighting
function renderContent(
  text: string,
  onMentionClick: (short: string) => void,
  myShort: string,
): React.ReactNode {
  if (!text.includes('@')) return text
  const parts = text.split(/(@[A-Za-z0-9]{8})/g)
  return (
    <>
      {parts.map((part, i) => {
        if (/^@[A-Za-z0-9]{8}$/.test(part)) {
          const short = part.slice(1)
          const isMe = short === myShort
          return (
            <span
              key={i}
              onClick={() => !isMe && onMentionClick(short)}
              style={{
                color: isMe ? '#dc2626' : '#7c3aed', fontWeight: 700,
                background: isMe ? '#fef2f2' : '#f3e8ff',
                borderRadius: 4, padding: '0 3px',
                cursor: isMe ? 'default' : 'pointer',
              }}
            >
              {part}
            </span>
          )
        }
        return part
      })}
    </>
  )
}

// ── Demo messages (offline fallback) ─────────────────────────────────────────
const now = Math.floor(Date.now() / 1000)
const DEMO_USER_MSGS: Message[] = [
  { id: 'd1', sender_short: 'a3f8b2c9', content: 'Hello! Happy to be here — this is the first chat where I know for sure I\'m talking to real humans 🙂', room: 'agora', timestamp: now - 300, trust_label: 'community_verified', trust_score: 0.5, reactions: { '❤️': ['e5f6a7b8', 'i9j0k1l2'], '👍': ['m3n4o5p6'] } },
  { id: 'd2', sender_short: 'e5f6a7b8', content: 'Aptos recorded my credential 10 minutes ago. Verification took ~30 seconds.', room: 'agora', timestamp: now - 240, trust_label: 'newcomer', trust_score: 0.1, reactions: { '✅': ['a3f8b2c9'] } },
  { id: 'd3', sender_short: 'i9j0k1l2', content: 'SapiX correctly recognized my gesture, even with a slightly shaky hand.', room: 'agora', timestamp: now - 180, trust_label: 'newcomer', trust_score: 0.2 },
  { id: 'd4', sender_short: 'm3n4o5p6', content: 'Curious how governance will work — voting weighted by trust score?', room: 'agora', timestamp: now - 60, trust_label: 'trusted', trust_score: 1.0, reactions: { '🤔': ['a3f8b2c9', 'e5f6a7b8'] } },
  { id: 't1', sender_short: 'a3f8b2c9', content: 'Looked at the Aptos Move source for HumanCredential — very clean code.', room: 'tech', timestamp: now - 120, trust_label: 'community_verified', trust_score: 0.5 },
]

// ── Component ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const t = useTranslations('chat')

  const SYSTEM_ROOMS: Room[] = [
    { id: 'agora',      icon: '🌍', label: t('room_agora_label'),  desc: t('room_agora_desc')  },
    { id: 'tech',       icon: '⚡', label: t('room_tech_label'),   desc: t('room_tech_desc')   },
    { id: 'governance', icon: '🗳️', label: t('room_gov_label'),    desc: t('room_gov_desc')    },
    { id: 'philosophy', icon: '🧠', label: t('room_phil_label'),   desc: t('room_phil_desc')   },
  ]

  const DEMO: Message[] = [
    { id: 'd0', sender_short: 'system', content: t('welcome_msg'), room: 'agora', timestamp: now - 600, is_system: true },
    ...DEMO_USER_MSGS,
    { id: 'tsys1', sender_short: 'system', content: t('tech_welcome'), room: 'tech', timestamp: now - 700, is_system: true },
  ]

  // ── Core state ──────────────────────────────────────────────────────────────
  const [credential, setCredential]     = useState<Credential | null>(null)
  const [currentRoom, setCurrentRoom]   = useState('agora')
  const [messages, setMessages]         = useState<Message[]>([])
  const [apiConnected, setApiConnected] = useState<boolean | null>(null)
  const [input, setInput]               = useState('')
  const [sending, setSending]           = useState(false)
  const [showEmoji, setShowEmoji]       = useState(false)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})  // roomId → unread
  const lastReadRef = useRef<Record<string, number>>({})
  const baselineRef = useRef<number>(0)
  const [replyTo, setReplyTo]           = useState<ReplyPreview | null>(null)
  const [hoveredMsg, setHoveredMsg]     = useState<string | null>(null)
  const [reactPicker, setReactPicker]   = useState<string | null>(null)
  const [onlineCount, setOnlineCount]   = useState(12)
  const [adminShorts, setAdminShorts]   = useState<string[]>(ADMIN_SHORTS_BOOTSTRAP)
  const [goldShorts, setGoldShorts]     = useState<string[]>([])
  const [adminDisplay, setAdminDisplay] = useState<Record<string, {name:string|null,avatar:string|null}>>({})
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translating, setTranslating]   = useState<string | null>(null)

  // ── DM state ────────────────────────────────────────────────────────────────
  const [dmPartner, setDmPartner]   = useState<string | null>(null) // active DM partner
  const [dmList, setDmList]         = useState<DmPartner[]>([])    // sidebar list
  const [dmSearchOpen, setDmSearchOpen] = useState(false)
  const [dmSearch, setDmSearch]     = useState('')

  // ── @mention state ──────────────────────────────────────────────────────────
  const [mentionOpen, setMentionOpen]   = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [notifications, setNotifications] = useState<{id:string;type:string;from:string;preview:string;ts:number}[]>([])

  // ── Room management state ───────────────────────────────────────────────────
  const [customRooms, setCustomRooms]   = useState<Room[]>([])
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const [newRoom, setNewRoom]           = useState({ name: '', icon: '💬', desc: '', access: 'public' })
  const [creatingRoom, setCreatingRoom] = useState(false)

  // ── Device pairing ──────────────────────────────────────────────────────────
  const [pairModal, setPairModal] = useState<{link_code:string;verify_url:string;expires_at:number;status:'pending'|'claimed'|'expired'}|null>(null)
  const pairPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [uploading, setUploading] = useState(false)

  // ── Refs ────────────────────────────────────────────────────────────────────
  const bottomRef   = useRef<HTMLDivElement>(null)
  const wsRef       = useRef<WebSocket | null>(null)
  const notifyWsRef = useRef<WebSocket | null>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const dmSearchRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Derived ─────────────────────────────────────────────────────────────────
  const isVerified       = !!credential
  const myShort          = credential ? shortDID(credential.did) : ''
  const isAdmin          = !!myShort && adminShorts.includes(myShort)
  const adminInfo        = myShort ? adminDisplay[myShort] : null
  const displayName      = isAdmin ? (adminInfo?.name ?? 'Alexander Tulubyev') : myShort
  const displayAvatar    = isAdmin ? (adminInfo?.avatar ?? '/avatar-alex.jpg') : null
  const displayTrustLabel = isAdmin ? 'administrator' : (credential?.trust_label ?? 'newcomer')
  const displayTrustScore = isAdmin ? 1.0 : (credential?.trust_score ?? 0.1)
  const displayTrustColor = isAdmin ? '#059669' : (TRUST_COLORS[credential?.trust_label ?? 'newcomer'] ?? '#7c3aed')

  const allRooms: Room[] = [...SYSTEM_ROOMS, ...customRooms]
  const activeRoomId = dmPartner ? dmRoomId(myShort, dmPartner) : currentRoom
  const roomMsgs     = messages.filter(m => m.room === activeRoomId)

  // Recent senders in current room (for @mention autocomplete)
  const recentSenders = useMemo(() => {
    const seen = new Set<string>()
    messages
      .filter(m => m.room === currentRoom && !m.is_system && m.sender_short !== myShort)
      .slice(-80)
      .forEach(m => seen.add(m.sender_short))
    return Array.from(seen).slice(0, 12)
  }, [messages, currentRoom, myShort])

  const mentionSuggestions = mentionQuery
    ? recentSenders.filter(s => s.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : recentSenders.slice(0, 6)

  // ── Session auth: refresh on tab load ──────────────────────────────────────
  useEffect(() => { autoRefreshSession().catch(() => {}) }, [])

  // ── Load admin data ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/admin/dids/public')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.admin_shorts) setAdminShorts([...data.admin_shorts, ...(data.gold_shorts ?? [])])
        if (data?.gold_shorts) setGoldShorts(data.gold_shorts)
        if (data?.admin_display) setAdminDisplay(data.admin_display)
      })
      .catch(() => {})
  }, [])

  // ── Unread message counts (channel badges + header icon source) ──────────────
  useEffect(() => {
    try { lastReadRef.current = JSON.parse(localStorage.getItem('chat_last_read') || '{}') } catch {}
    let b = Number(localStorage.getItem('chat_unread_baseline') || 0)
    if (!b) { b = Math.floor(Date.now() / 1000); localStorage.setItem('chat_unread_baseline', String(b)) }
    baselineRef.current = b
  }, [])

  const pollUnread = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/unread', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: lastReadRef.current, default_since: baselineRef.current, me: myShort || undefined }),
      })
      if (r.ok) setUnreadCounts((await r.json()).counts || {})
    } catch {}
  }, [myShort])

  useEffect(() => {
    pollUnread()
    const iv = setInterval(pollUnread, 60000)
    return () => clearInterval(iv)
  }, [pollUnread])

  // Opening a room marks it read; new messages in the open room keep it read.
  const markRead = useCallback((room: string) => {
    lastReadRef.current = { ...lastReadRef.current, [room]: Math.floor(Date.now() / 1000) }
    try { localStorage.setItem('chat_last_read', JSON.stringify(lastReadRef.current)) } catch {}
    setUnreadCounts(prev => ({ ...prev, [room]: 0 }))
  }, [])

  useEffect(() => {
    if (!dmPartner && currentRoom) markRead(currentRoom)
  }, [currentRoom, dmPartner, messages.length, markRead])

  // ── Load credential ─────────────────────────────────────────────────────────
  useEffect(() => {
    const loadCred = async () => {
      try {
        const did = localStorage.getItem('hsi_did')
        if (!did) return
        // Always fetch real trust values from backend — never trust localStorage
        const headers = aptogonHeaders(did)
        const res = await fetch(`/api/verify/status?did=${encodeURIComponent(did)}`, { headers })
        if (res.ok) {
          const data = await res.json()
          if (data.did) {
            setCredential({
              did: data.did,
              trust_score: data.trust_score ?? 0.1,
              trust_label: data.trust_label ?? 'newcomer',
            })
            return
          }
        }
        // Fallback to localStorage only if backend unreachable
        const raw = localStorage.getItem('hsi_credential')
        if (raw) {
          const p = JSON.parse(raw)
          const sub = p.credentialSubject ?? {}
          setCredential({ did: did || sub.id || 'unknown', trust_score: 0.1, trust_label: 'newcomer' })
        }
      } catch {}
    }
    loadCred()
    setOnlineCount(Math.floor(Math.random() * 18) + 8)

    // Register Web Push after credential is ready
    const onVerified = () => {
      try {
        const did = localStorage.getItem('hsi_did') || ''
        const short = did.slice(-8)
        if (short) registerWebPush(short, process.env.NEXT_PUBLIC_API_URL || '')
      } catch {}
    }
    // Try immediately (credential may already be in localStorage)
    setTimeout(onVerified, 500)
    window.addEventListener('hsi:verified', onVerified)
    return () => window.removeEventListener('hsi:verified', onVerified)
  }, [])

  // ── Load custom rooms ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/chat/rooms')
      .then(r => r.ok ? r.json() : [])
      .then((data: Room[]) => setCustomRooms(data.filter((r: Room) => r.custom)))
      .catch(() => {})
  }, [])

  // ── Load DM partners ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!myShort) return
    fetch(`/api/chat/dm/partners?me=${myShort}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setDmList(data))
      .catch(() => {})
  }, [myShort])

  // ── Notify WS (mentions + DM alerts) ──────────────────────────────────────
  useEffect(() => {
    if (!myShort) return
    const connectNotify = () => {
      try {
        const ws = new WebSocket(wsUrl(`/api/chat/ws/notify_${myShort}`))
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'mention' || msg.type === 'dm_notification') {
              const notif = { id: String(Date.now()), type: msg.type, from: msg.from, preview: msg.preview || '', ts: Date.now() }
              setNotifications(prev => [notif, ...prev].slice(0, 20))
              // If DM notification and we're not already in that DM, flash the partner in sidebar
              if (msg.type === 'dm_notification') {
                setDmList(prev => {
                  const exists = prev.find(d => d.short === msg.from)
                  if (exists) return prev.map(d => d.short === msg.from ? { ...d, preview: msg.preview } : d)
                  return [{ short: msg.from, dm_room: msg.dm_room, last_ts: Date.now() / 1000, preview: msg.preview }, ...prev]
                })
              }
            }
          } catch {}
        }
        ws.onclose = () => setTimeout(connectNotify, 8000)
        notifyWsRef.current = ws
      } catch {}
    }
    connectNotify()
    return () => { notifyWsRef.current?.close() }
  }, [myShort])

  // ── Load messages + chat WS ─────────────────────────────────────────────────
  useEffect(() => {
    setMessages([])
    const room = activeRoomId
    fetch(`/api/chat/messages?room=${room}&limit=50`)
      .then(r => { if (!r.ok) throw new Error('api error'); return r.json() })
      .then(data => { setApiConnected(true); setMessages(Array.isArray(data) ? data : []) })
      .catch(() => {
        setApiConnected(false)
        if (!dmPartner) setMessages(DEMO.filter(m => m.room === room))
      })

    try {
      const ws = new WebSocket(wsUrl(`/api/chat/ws/${room}`))
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'reaction') {
            setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, reactions: data.reactions } : m))
          } else if (data.type === 'room_created') {
            setCustomRooms(prev => prev.find(r => r.id === data.room?.id) ? prev : [...prev, data.room])
          } else if (data.type === 'room_deleted') {
            setCustomRooms(prev => prev.filter(r => r.id !== data.room_id))
            if (currentRoom === data.room_id) setCurrentRoom('agora')
          } else {
            setMessages(prev =>
              prev.find(m => m.id === data.id)
                ? prev.map(m => m.id === data.id ? data : m)          // replace if exists (e.g. optimistic)
                : [...prev.filter(m => !m.id.startsWith('opt_')), data] // else append
            )
          }
        } catch {}
      }
      wsRef.current = ws
      return () => { ws.close(); wsRef.current = null }
    } catch {}
  }, [activeRoomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to bottom ────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeRoomId])

  // ── @mention input handler ──────────────────────────────────────────────────
  const handleInputChange = (val: string) => {
    setInput(val)
    const m = val.match(/@([A-Za-z0-9]{0,8})$/)
    if (m !== null) {
      setMentionQuery(m[1])
      setMentionOpen(true)
    } else {
      setMentionOpen(false)
      setMentionQuery('')
    }
  }

  const insertMention = (short: string) => {
    const newVal = input.replace(/@[A-Za-z0-9]{0,8}$/, `@${short} `)
    setInput(newVal)
    setMentionOpen(false)
    inputRef.current?.focus()
  }

  // ── Open DM ─────────────────────────────────────────────────────────────────
  const openDM = useCallback((partnerShort: string) => {
    if (!myShort || partnerShort === myShort) return
    setDmPartner(partnerShort)
    // add to dmList if not present
    setDmList(prev => {
      if (prev.find(d => d.short === partnerShort)) return prev
      return [{ short: partnerShort, dm_room: dmRoomId(myShort, partnerShort), last_ts: Date.now()/1000, preview: '' }, ...prev]
    })
  }, [myShort])

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || sending || !credential) return
    setSending(true)
    const content = input.trim()
    setInput(''); setReplyTo(null); setMentionOpen(false)

    const optimistic: Message = {
      id: `opt_${Date.now()}`, sender_short: myShort, content,
      room: activeRoomId, timestamp: Math.floor(Date.now() / 1000),
      trust_label: credential.trust_label, trust_score: credential.trust_score,
      reply_to: replyTo ?? undefined,
    }
    setMessages(prev => [...prev, optimistic])

    try {
      const endpoint = dmPartner ? '/api/chat/dm' : '/api/chat/messages'
      const body = dmPartner
        ? { to_short: dmPartner, sender_short: myShort, content, trust_label: credential.trust_label, trust_score: credential.trust_score }
        : { content, room: currentRoom, sender_short: myShort, trust_label: credential.trust_label, trust_score: credential.trust_score, reply_to: replyTo }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const real = await res.json()
        setMessages(prev => prev.map(m => m.id === optimistic.id ? real : m))
        // Update DM list preview
        if (dmPartner) {
          setDmList(prev => prev.map(d =>
            d.short === dmPartner ? { ...d, preview: content, last_ts: Date.now()/1000 } : d
          ))
        }
      }
    } catch {}
    setSending(false)
  }

  const sendFile = async (file: File) => {
    if (!credential) return
    if (file.size > 10 * 1024 * 1024) { alert('File too large — max 10 MB'); return }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('room', dmPartner ? dmRoomId(myShort, dmPartner) : currentRoom)
      form.append('sender_short', myShort)
      const up = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/chat/upload`, { method: 'POST', body: form })
      if (!up.ok) throw new Error('upload failed')
      const meta = await up.json()

      const content = `${FILE_PREFIX}${JSON.stringify({ url: meta.url, name: meta.name, size: meta.size, type: meta.type })}`
      const endpoint = dmPartner ? '/api/chat/dm' : '/api/chat/messages'
      const body = dmPartner
        ? { to_short: dmPartner, sender_short: myShort, content, trust_label: credential.trust_label, trust_score: credential.trust_score }
        : { content, room: currentRoom, sender_short: myShort, trust_label: credential.trust_label, trust_score: credential.trust_score }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (res.ok) {
        const real = await res.json()
        // Don't manually append — WebSocket broadcast will deliver it.
        // Only update DM list preview here.
        if (dmPartner) setDmList(prev => prev.map(d => d.short === dmPartner ? { ...d, preview: '📎 ' + meta.name, last_ts: Date.now() / 1000 } : d))
        // Fallback: if WS is disconnected, add manually (dedup handled below)
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          setMessages(prev => prev.find(m => m.id === real.id) ? prev : [...prev, real])
        }
      }
    } catch { /* silent */ }
    setUploading(false)
  }

  const addReaction = async (msgId: string, emoji: string) => {
    setReactPicker(null)
    const short = credential ? shortDID(credential.did) : 'guest'
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m
      const recs: Record<string, string[]> = { ...(m.reactions ?? {}) }
      const arr = [...(recs[emoji] ?? [])]
      const idx = arr.indexOf(short)
      if (idx >= 0) arr.splice(idx, 1); else arr.push(short)
      recs[emoji] = arr
      return { ...m, reactions: recs }
    }))
    try {
      await fetch('/api/chat/react', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: msgId, emoji, sender_short: short }),
      })
    } catch {}
  }

  const translateMessage = async (msg: Message) => {
    if (translating === msg.id) return
    if (translations[msg.id]) { setTranslations(prev => { const n={...prev}; delete n[msg.id]; return n }); return }
    setTranslating(msg.id)
    try {
      const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'en'
      const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg.content, target_lang: lang }) })
      if (res.ok) { const d = await res.json(); if (d.translated && d.translated !== msg.content) setTranslations(prev => ({ ...prev, [msg.id]: d.translated })) }
    } catch {}
    setTranslating(null)
  }

  // ── Create room ──────────────────────────────────────────────────────────────
  const createRoom = async () => {
    if (!newRoom.name.trim() || !myShort) return
    setCreatingRoom(true)
    try {
      const res = await fetch('/api/chat/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoom.name, icon: newRoom.icon, description: newRoom.desc, access_level: newRoom.access, sender_short: myShort }),
      })
      if (res.ok) {
        const room = await res.json()
        // Deduplicate: WS room_created may have already added it
        setCustomRooms(prev => prev.find(r => r.id === room.id) ? prev : [...prev, room])
        setCurrentRoom(room.id)
        setDmPartner(null)
        setCreateRoomOpen(false)
        setNewRoom({ name: '', icon: '💬', desc: '', access: 'public' })
      }
    } catch {}
    setCreatingRoom(false)
  }

  const deleteRoom = async (roomId: string) => {
    if (!confirm('Delete this room?')) return
    try {
      await fetch(`/api/chat/rooms/${roomId}?sender_short=${myShort}`, { method: 'DELETE' })
      setCustomRooms(prev => prev.filter(r => r.id !== roomId))
      if (currentRoom === roomId) setCurrentRoom('agora')
    } catch {}
  }

  // ── Device pairing ──────────────────────────────────────────────────────────
  const openPairModal = async () => {
    const did = credential?.did || localStorage.getItem('hsi_did') || ''
    if (!did) return
    try {
      const r = await fetch('/api/pair/create', {
        method: 'POST',
        headers: { ...aptogonHeaders(did), 'X-APTOGON-DID': did },
      })
      if (!r.ok) return
      const data = await r.json()
      setPairModal({ ...data, status: 'pending' })
      if (pairPollRef.current) clearInterval(pairPollRef.current)
      pairPollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`/api/pair/status/${data.link_code}`)
          const sd = await sr.json()
          if (sd.status === 'claimed') { setPairModal(m => m ? { ...m, status: 'claimed' } : null); clearInterval(pairPollRef.current!) }
          else if (sd.status === 'expired') { setPairModal(m => m ? { ...m, status: 'expired' } : null); clearInterval(pairPollRef.current!) }
        } catch {}
      }, 3000)
    } catch {}
  }
  const closePairModal = () => { setPairModal(null); if (pairPollRef.current) { clearInterval(pairPollRef.current); pairPollRef.current = null } }

  const activeRoomObj = dmPartner ? null : allRooms.find(r => r.id === currentRoom)

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#faf5ff', fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden' }}>
      <style>{CHAT_STYLES}</style>

      {/* ── HEADER ── */}
      <header style={{ background: 'linear-gradient(135deg, #2d1b69, #4c1d95)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, zIndex: 10, boxShadow: '0 2px 12px rgba(45,27,105,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 20 }}>←</Link>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>💬 APTOGON Chat</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
              🟢 {onlineCount} {t('online_count')} ·{' '}
              {dmPartner ? `💬 DM …${dmPartner}` : `#${activeRoomObj?.label ?? currentRoom}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Notification bell */}
          {notifications.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setNotifications([])}
                title="Clear notifications"
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 99, padding: '5px 10px', color: '#fff', fontSize: 14, cursor: 'pointer', position: 'relative' }}
              >
                🔔
                <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 99, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
                  {notifications.length}
                </span>
              </button>
            </div>
          )}
          {credential ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 99, padding: '5px 12px' }}>
                {displayAvatar ? (
                  <img src={displayAvatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid #a78bfa' }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: displayTrustColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>
                    {myShort.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{displayName}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{displayTrustLabel}</div>
                </div>
              </div>
              <button onClick={openPairModal} title="Link a new device" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 99, padding: '5px 12px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>🔗</button>
            </>
          ) : (
            <Link href="/verify" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', padding: '7px 16px', borderRadius: 99, fontSize: 12, fontWeight: 700, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.25)' }}>🔑 {t('verify_link')}</Link>
          )}
        </div>
      </header>

      {/* ── NOTIFICATION TOASTS ── */}
      {notifications.slice(0, 3).map(n => (
        <div key={n.id} style={{ position: 'fixed', top: 70, right: 16, zIndex: 200, background: n.type === 'mention' ? '#f3e8ff' : '#eff6ff', border: `1px solid ${n.type === 'mention' ? '#c4b5fd' : '#bfdbfe'}`, borderRadius: 12, padding: '10px 14px', fontSize: 13, maxWidth: 300, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', cursor: 'pointer', marginBottom: 4 }}
          onClick={() => { n.type === 'dm_notification' ? openDM(n.from) : undefined; setNotifications(prev => prev.filter(x => x.id !== n.id)) }}>
          <span style={{ fontWeight: 700, color: n.type === 'mention' ? '#7c3aed' : '#1d4ed8' }}>
            {n.type === 'mention' ? `@mention from …${n.from}` : `💬 DM from …${n.from}`}
          </span>
          <div style={{ color: '#475569', marginTop: 2, fontSize: 12 }}>{n.preview}</div>
        </div>
      ))}

      {/* ── PAIR MODAL ── */}
      {pairModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) closePairModal() }}>
          <div style={{ background: '#fff', borderRadius: 24, padding: 32, maxWidth: 380, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            {pairModal.status === 'claimed' ? (<>
              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 52, marginBottom: 12 }}>🎉</div><h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 900, color: '#059669' }}>Device linked!</h3></div>
              <button onClick={closePairModal} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg,#059669,#10b981)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 12, cursor: 'pointer' }}>Done</button>
            </>) : pairModal.status === 'expired' ? (<>
              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 52, marginBottom: 12 }}>⏰</div><h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 900, color: '#dc2626' }}>Code expired</h3></div>
              <button onClick={() => { closePairModal(); openPairModal() }} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 12, cursor: 'pointer' }}>↻ New code</button>
            </>) : (<>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0f172a' }}>🔗 Link new device</h3>
                <button onClick={closePairModal} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ display: 'inline-block', padding: 8, borderRadius: 12, border: '2px solid #e2e8f0', background: '#ffffff' }}>
                  <QRCodeSVG value={pairModal.verify_url} size={184} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                </div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 12, padding: '12px 16px', textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Or enter this code on new device</div>
                <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'monospace', color: '#0f172a', letterSpacing: '0.15em' }}>{pairModal.link_code}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Expires in {Math.max(0, Math.round((pairModal.expires_at - Date.now() / 1000) / 60))} min</div>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* ── CREATE ROOM MODAL ── */}
      {createRoomOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setCreateRoomOpen(false) }}>
          <div style={{ background: '#fff', borderRadius: 24, padding: 28, maxWidth: 380, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0f172a' }}>✨ Create room</h3>
              <button onClick={() => setCreateRoomOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 52 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Icon</label>
                <input value={newRoom.icon} onChange={e => setNewRoom(r => ({ ...r, icon: e.target.value }))} maxLength={4} style={{ width: '100%', padding: '9px 6px', border: '1.5px solid #e2e8f0', borderRadius: 9, fontSize: 20, textAlign: 'center', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Name *</label>
                <input value={newRoom.name} onChange={e => setNewRoom(r => ({ ...r, name: e.target.value }))} maxLength={40} placeholder="My room" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 9, fontSize: 14, boxSizing: 'border-box' }} autoFocus />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Description</label>
              <input value={newRoom.desc} onChange={e => setNewRoom(r => ({ ...r, desc: e.target.value }))} maxLength={200} placeholder="What this room is about" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 9, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Access</label>
              <select value={newRoom.access} onChange={e => setNewRoom(r => ({ ...r, access: e.target.value }))} style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 9, fontSize: 13 }}>
                <option value="public">🌍 Public — everyone can read</option>
                <option value="verified">✅ Verified only — needs human credential</option>
                <option value="gold_only">👑 Gold Members only</option>
              </select>
            </div>
            <button onClick={createRoom} disabled={!newRoom.name.trim() || creatingRoom}
              style={{ width: '100%', padding: 12, background: !newRoom.name.trim() || creatingRoom ? '#e2e8f0' : 'linear-gradient(135deg,#7c3aed,#2563eb)', color: !newRoom.name.trim() || creatingRoom ? '#94a3b8' : '#fff', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 12, cursor: !newRoom.name.trim() || creatingRoom ? 'default' : 'pointer' }}>
              {creatingRoom ? '⏳ Creating…' : '✨ Create room'}
            </button>
          </div>
        </div>
      )}

      {/* ── BODY ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT SIDEBAR ── */}
        <aside className="chat-sidebar-left" style={{ background: '#f3f0ff', borderRight: '1px solid #e9d5ff', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>

          {/* Channels */}
          <div style={{ padding: '14px 12px 4px', fontSize: 10, fontWeight: 800, color: '#7c3aed', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            {t('channels')}
          </div>
          {allRooms.map(room => {
            const active = !dmPartner && currentRoom === room.id
            const unreadN = (!dmPartner && room.id === currentRoom) ? 0 : (unreadCounts[room.id] || 0)
            const canDelete = room.custom && (isAdmin || room.created_by === myShort)
            return (
              <div key={room.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                onMouseEnter={e => { const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement | null; if (btn) btn.style.display = 'flex' }}
                onMouseLeave={e => { const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement | null; if (btn) btn.style.display = 'none' }}>
                <button
                  onClick={() => { setCurrentRoom(room.id); setDmPartner(null) }}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: active ? 'rgba(124,58,237,0.14)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'start', borderLeft: active ? '3px solid #7c3aed' : '3px solid transparent', transition: 'background 0.15s' }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.06)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  <span style={{ fontSize: 17, lineHeight: 1 }}>{room.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? '#4c1d95' : '#374151', display: 'flex', alignItems: 'center', gap: 5 }}>
                      #{room.label}
                      {unreadN > 0 && (
                        <span style={{ marginInlineStart: 'auto', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 99, background: '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {unreadN > 99 ? '99+' : unreadN}
                        </span>
                      )}
                      {room.access_level === 'verified' && <span style={{ fontSize: 8, color: '#059669', fontWeight: 700 }}>✅</span>}
                      {room.access_level === 'gold_only' && <span style={{ fontSize: 8, color: '#d97706', fontWeight: 700 }}>👑</span>}
                    </div>
                    <div style={{ fontSize: 9, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.desc}</div>
                  </div>
                </button>
                {canDelete && (
                  <button className="del-btn" onClick={() => deleteRoom(room.id)}
                    style={{ display: 'none', position: 'absolute', right: 4, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', background: '#fee2e2', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10, color: '#ef4444' }}>✕</button>
                )}
              </div>
            )
          })}

          {/* Create room button */}
          {isVerified && (
            <button onClick={() => setCreateRoomOpen(true)}
              style={{ margin: '4px 8px', padding: '7px 10px', background: 'none', border: '1px dashed #c4b5fd', borderRadius: 8, cursor: 'pointer', fontSize: 11, color: '#7c3aed', fontWeight: 600, textAlign: 'start' }}>
              ＋ Create room
            </button>
          )}

          {/* Direct Messages */}
          <div style={{ padding: '12px 12px 4px', marginTop: 8, borderTop: '1px solid #e9d5ff', fontSize: 10, fontWeight: 800, color: '#7c3aed', letterSpacing: '0.15em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Direct</span>
            {isVerified && (
              <button onClick={() => { setDmSearchOpen(s => !s); setTimeout(() => dmSearchRef.current?.focus(), 50) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#7c3aed', padding: '0 2px', lineHeight: 1 }}>＋</button>
            )}
          </div>

          {/* DM search input */}
          {dmSearchOpen && (
            <div style={{ padding: '4px 8px 8px' }}>
              <input
                ref={dmSearchRef}
                value={dmSearch}
                onChange={e => setDmSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && dmSearch.length === 8) { openDM(dmSearch); setDmSearch(''); setDmSearchOpen(false) } if (e.key === 'Escape') setDmSearchOpen(false) }}
                placeholder="Paste 8-char DID…"
                maxLength={8}
                style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #c4b5fd', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, paddingInlineStart: 2 }}>Press Enter to open DM</div>
            </div>
          )}

          {/* DM list */}
          {dmList.map(dm => {
            const activeDM = dmPartner === dm.short
            const hasNotif = notifications.some(n => n.type === 'dm_notification' && n.from === dm.short)
            return (
              <button
                key={dm.short}
                onClick={() => { setDmPartner(dm.short); setNotifications(prev => prev.filter(n => !(n.type === 'dm_notification' && n.from === dm.short))) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: activeDM ? 'rgba(124,58,237,0.14)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'start', borderLeft: activeDM ? '3px solid #7c3aed' : '3px solid transparent', width: '100%' }}
              >
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: TRUST_COLORS.newcomer, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0, position: 'relative' }}>
                  {dm.short.slice(0, 2).toUpperCase()}
                  {hasNotif && <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: '#ef4444', borderRadius: '50%', border: '1.5px solid #f3f0ff' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: activeDM ? '#4c1d95' : '#374151', fontFamily: 'monospace' }}>{dm.short}</div>
                  {dm.preview && <div style={{ fontSize: 10, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dm.preview}</div>}
                </div>
              </button>
            )
          })}

          <div style={{ flex: 1 }} />

          {/* Bottom: user info */}
          {credential ? (
            <div style={{ padding: 12, borderTop: '1px solid #e9d5ff', background: '#ede9fe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {displayAvatar
                  ? <img src={displayAvatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid #7c3aed', flexShrink: 0 }} />
                  : <div style={{ width: 32, height: 32, borderRadius: '50%', background: displayTrustColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{myShort.slice(0, 2).toUpperCase()}</div>
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e1b4b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
                  <div style={{ fontSize: 10, color: displayTrustColor }}>trust {displayTrustScore.toFixed(1)} · {displayTrustLabel}</div>
                  <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'monospace', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={credential.did}>
                    {credential.did.length > 24 ? `…${credential.did.slice(-20)}` : credential.did}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: 12, borderTop: '1px solid #e9d5ff' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>👁️ {t('read_mode')}</div>
              <Link href="/verify" style={{ display: 'block', textAlign: 'center', background: 'linear-gradient(135deg, #7c3aed, #2563eb)', color: '#fff', padding: '8px', borderRadius: 10, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>{t('verify_link')}</Link>
            </div>
          )}
        </aside>

        {/* ── MAIN CHAT ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* DM header bar */}
          {dmPartner && (
            <div style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <button onClick={() => setDmPartner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 14, fontWeight: 700 }}>←</button>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>{dmPartner.slice(0, 2).toUpperCase()}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', fontFamily: 'monospace' }}>💬 …{dmPartner}</div>
                <div style={{ fontSize: 10, color: '#60a5fa' }}>Direct message · private</div>
              </div>
            </div>
          )}

          {/* Offline / read-only banners */}
          {apiConnected === false && (
            <div style={{ background: '#fef9c3', borderBottom: '1px solid #fde047', padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 14 }}>🔌</span>
              <span style={{ fontSize: 12, color: '#713f12', fontWeight: 600 }}>{t('offline_demo')}</span>
            </div>
          )}
          {!isVerified && (
            <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '9px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 13, color: '#92400e', fontWeight: 600 }}>👁️ {t('read_mode_banner')}</span>
              <Link href="/verify" style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', textDecoration: 'none' }}>{t('verify_link')} →</Link>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'scroll', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
            {apiConnected === null && roomMsgs.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>
                <span>⏳ {t('loading_msgs')}</span>
              </div>
            )}
            {apiConnected === true && roomMsgs.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#9ca3af' }}>
                <div style={{ fontSize: 48 }}>{dmPartner ? '💬' : '💬'}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>
                  {dmPartner ? `Start a conversation with …${dmPartner}` : t('empty_room')}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>{dmPartner ? 'Messages are private between you two.' : t('empty_room_hint')}</div>
              </div>
            )}

            {roomMsgs.map((msg, idx, arr) => {
              const isMine  = msg.sender_short === myShort
              const isSys   = msg.is_system
              const prev    = idx > 0 ? arr[idx - 1] : null
              const grouped = !isSys && prev && !prev.is_system && prev.sender_short === msg.sender_short && (msg.timestamp - prev.timestamp) < 60

              if (isSys) {
                return (
                  <div key={msg.id} style={{ textAlign: 'center', padding: '10px 0', marginTop: idx > 0 ? 8 : 0 }}>
                    <span style={{ background: '#f3f0ff', color: '#7c3aed', fontSize: 11, padding: '5px 14px', borderRadius: 99, border: '1px solid #ddd6fe' }}>{msg.content}</span>
                  </div>
                )
              }

              return (
                <div key={msg.id}
                  style={{ display: 'flex', flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, marginTop: grouped ? 2 : 14, position: 'relative' }}
                  onMouseEnter={() => setHoveredMsg(msg.id)}
                  onMouseLeave={() => { setHoveredMsg(null); setReactPicker(null) }}
                >
                  {/* Avatar */}
                  {!isMine && !grouped ? (
                    msg.is_creator && msg.avatar_url ? (
                      <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'flex-end' }}>
                        <img src={msg.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid #7c3aed', display: 'block' }} />
                        <div style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: '50%', background: '#7c3aed', border: '1.5px solid #0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: '#fff' }}>👑</div>
                      </div>
                    ) : (
                      <div
                        style={{ width: 32, height: 32, borderRadius: '50%', background: TRUST_COLORS[msg.trust_label ?? 'newcomer'], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0, alignSelf: 'flex-end', cursor: isVerified ? 'pointer' : 'default' }}
                        onClick={() => isVerified && openDM(msg.sender_short)}
                        title={isVerified ? `DM …${msg.sender_short}` : undefined}
                      >
                        {msg.sender_short.slice(0, 2).toUpperCase()}
                      </div>
                    )
                  ) : !isMine ? <div style={{ width: 32, flexShrink: 0 }} /> : null}

                  {/* Bubble */}
                  <div style={{ maxWidth: '62%' }}>
                    {!isMine && !grouped && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, paddingInlineStart: 4 }}>
                        {msg.is_creator ? (
                          <>
                            <span style={{ fontSize: 12, fontWeight: 800, color: '#a78bfa' }}>{msg.display_name ?? 'Admin'}</span>
                            <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>({msg.sender_short})</span>
                            <span style={{ fontSize: 10, background: 'linear-gradient(135deg,#7c3aed,#0891b2)', color: '#fff', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>⚙️ admin</span>
                            {(msg.is_gold || goldShorts.includes(msg.sender_short)) && (
                              <span style={{ fontSize: 10, background: 'linear-gradient(135deg,#d97706,#f59e0b)', color: '#fff', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>👑 Gold</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span
                              style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: TRUST_COLORS[msg.trust_label ?? 'newcomer'], cursor: isVerified ? 'pointer' : 'default' }}
                              onClick={() => isVerified && openDM(msg.sender_short)}
                              title={isVerified ? `DM …${msg.sender_short}` : undefined}
                            >
                              {msg.sender_short}
                            </span>
                            <HumanBadge state={TRUST_BADGE_STATE[msg.trust_label ?? 'newcomer'] ?? 'verified'} size={16} style={{ verticalAlign: 'middle', flexShrink: 0 }} />
                            {(msg.is_gold || goldShorts.includes(msg.sender_short)) ? (
                              <span style={{ fontSize: 10, background: 'linear-gradient(135deg,#d97706,#f59e0b)', color: '#fff', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>👑 Gold</span>
                            ) : adminShorts.includes(msg.sender_short) ? (
                              <span style={{ fontSize: 10, background: 'linear-gradient(135deg,#7c3aed,#0891b2)', color: '#fff', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>⚙️ admin</span>
                            ) : null}
                          </>
                        )}
                        <span style={{ fontSize: 10, color: '#d1d5db' }}>{fmtDateTime(msg.timestamp)}</span>
                      </div>
                    )}

                    {msg.reply_to && (
                      <div style={{ background: 'rgba(124,58,237,0.08)', borderLeft: '3px solid #7c3aed', padding: '4px 10px', borderRadius: '8px 8px 0 0', fontSize: 11, color: '#6b7280', marginBottom: -6, paddingBottom: 10 }}>
                        <span style={{ fontWeight: 700, color: '#7c3aed', fontFamily: 'monospace' }}>{msg.reply_to.sender_short}</span>
                        {': '}{(() => {
                          const rc = msg.reply_to.content ?? ''
                          const fm = parseFileMeta(rc)
                          if (fm) return `📄 ${fm.name}`
                          return rc.length > 60 ? rc.slice(0, 60) + '…' : rc
                        })()}
                      </div>
                    )}

                    <div style={{ background: isMine ? 'linear-gradient(135deg, #7c3aed, #2563eb)' : '#fff', color: isMine ? '#fff' : '#111827', padding: parseFileMeta(msg.content) ? '8px 10px' : '10px 14px', borderRadius: isMine ? (msg.reply_to ? '4px 18px 4px 18px' : '18px 18px 4px 18px') : (msg.reply_to ? '18px 4px 18px 4px' : '18px 18px 18px 4px'), fontSize: 14, lineHeight: 1.55, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', wordBreak: 'break-word', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                      {parseFileMeta(msg.content ?? '')
                        ? <FileMessage meta={parseFileMeta(msg.content ?? '')!} isMine={isMine} msgTs={msg.timestamp} />
                        : <><span style={{ flex: 1 }}>{renderContent(msg.content ?? '', openDM, myShort)}</span>
                          {isMine && <span style={{ fontSize: 10, opacity: 0.65, flexShrink: 0 }}>{fmtDateTime(msg.timestamp)}</span>}</>
                      }
                    </div>

                    {msg.reactions && Object.entries(msg.reactions).some(([, u]) => u.length > 0) && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
                        {Object.entries(msg.reactions).filter(([, users]) => users.length > 0).map(([emoji, users]) => (
                          <button key={emoji} onClick={() => addReaction(msg.id, emoji)} style={{ background: users.includes(myShort) ? '#ede9fe' : '#f9fafb', border: `1px solid ${users.includes(myShort) ? '#c4b5fd' : '#e5e7eb'}`, borderRadius: 99, padding: '2px 8px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600 }}>
                            {emoji} {users.length}
                          </button>
                        ))}
                      </div>
                    )}

                    {translations[msg.id] && (
                      <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginTop: 4, textAlign: isMine ? 'right' : 'left', paddingInlineStart: isMine ? 0 : 4 }}>
                        🌐 {translations[msg.id]}
                      </div>
                    )}
                  </div>

                  {/* Hover actions */}
                  {hoveredMsg === msg.id && (
                    <div style={{ position: 'absolute', [isMine ? 'left' : 'right']: 44, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 2, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '3px 6px', boxShadow: '0 2px 10px rgba(0,0,0,0.12)', zIndex: 10 }}>
                      <button onClick={() => setReactPicker(reactPicker === msg.id ? null : msg.id)} title={t('reaction')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '2px 4px', borderRadius: 6 }} onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>😊</button>
                      {isVerified && !dmPartner && (
                        <button onClick={() => { setReplyTo({ id: msg.id, sender_short: msg.sender_short, content: msg.content }); inputRef.current?.focus() }} title={t('reply')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '2px 4px', borderRadius: 6 }} onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>↩️</button>
                      )}
                      {isVerified && !isMine && !msg.is_creator && (
                        <button onClick={() => openDM(msg.sender_short)} title={`DM …${msg.sender_short}`} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '2px 4px', borderRadius: 6 }} onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>💬</button>
                      )}
                      {!msg.is_system && (
                        <button onClick={() => translateMessage(msg)} title="Translate" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '2px 4px', borderRadius: 6, opacity: translating === msg.id ? 0.5 : 1 }} onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                          {translating === msg.id ? '⏳' : translations[msg.id] ? '🌐✓' : '🌐'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Reaction picker */}
                  {reactPicker === msg.id && (
                    <div style={{ position: 'absolute', [isMine ? 'left' : 'right']: 44, top: -52, zIndex: 20, display: 'flex', gap: 4, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, padding: '6px 10px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
                      {REACTIONS.map(e => (
                        <button key={e} onClick={() => addReaction(msg.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 2, borderRadius: 6 }} onMouseEnter={ev => (ev.currentTarget.style.background = '#f3f4f6')} onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}>{e}</button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* Reply bar */}
          {replyTo && !dmPartner && (
            <div style={{ background: '#f3f0ff', borderTop: '2px solid #ddd6fe', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ↩️ <span style={{ fontWeight: 700, color: '#7c3aed', fontFamily: 'monospace' }}>{replyTo.sender_short}</span>{': '}{(() => { const rc = replyTo.content ?? ''; const fm = parseFileMeta(rc); return fm ? `📄 ${fm.name}` : (rc.length > 80 ? rc.slice(0, 80) + '…' : rc) })()}
              </div>
              <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, marginInlineStart: 12, flexShrink: 0 }}>✕</button>
            </div>
          )}

          {/* Input */}
          <div style={{ borderTop: '1px solid #e9d5ff', padding: '10px 20px', background: '#fff', flexShrink: 0, position: 'relative' }}>

            {/* @mention autocomplete */}
            {mentionOpen && mentionSuggestions.length > 0 && (
              <div style={{ position: 'absolute', bottom: '100%', left: 20, right: 20, background: '#fff', border: '1.5px solid #c4b5fd', borderRadius: 12, boxShadow: '0 -4px 20px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 30 }}>
                <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid #f1f5f9' }}>Mention</div>
                {mentionSuggestions.map(short => (
                  <button key={short} onClick={() => insertMention(short)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff' }}>{short.slice(0, 2).toUpperCase()}</div>
                    <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: '#374151' }}>@{short}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Hidden file input — always rendered so ref is stable */}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }}
            />

            {!isVerified ? (
              <div style={{ textAlign: 'center', padding: '10px', color: '#9ca3af', fontSize: 13 }}>
                👁️ {t('verified_only')} · <Link href="/verify" style={{ color: '#7c3aed', fontWeight: 700, textDecoration: 'none' }}>{t('verify_link')}</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
                {/* Emoji palette popup */}
                {showEmoji && (
                  <>
                    <div onClick={() => setShowEmoji(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.15)', padding: 10, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, width: 296 }}>
                      {EMOJIS.map(e => (
                        <button key={e} type="button"
                          onClick={() => { setInput(prev => prev + e); inputRef.current?.focus() }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 4, borderRadius: 8, lineHeight: 1 }}
                          onMouseEnter={ev => (ev.currentTarget.style.background = '#f5f3ff')}
                          onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* Text input bubble with 📎 inside on the left */}
                <div style={{ flex: 1, background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 22, padding: '6px 12px 6px 6px', display: 'flex', alignItems: 'center', gap: 6, transition: 'border-color 0.15s' }}>
                  {/* Attach button — inside the bubble, left side */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Прикрепить файл (макс. 10 МБ)"
                    style={{
                      width: 34, height: 34, borderRadius: '50%',
                      background: uploading ? '#e5e7eb' : 'rgba(124,58,237,0.1)',
                      border: 'none',
                      cursor: uploading ? 'default' : 'pointer',
                      color: uploading ? '#94a3b8' : '#7c3aed',
                      fontSize: 17,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'background 0.15s',
                    }}
                  >
                    {uploading ? '⏳' : '📎'}
                  </button>
                  {/* Emoji button — toggles the palette above */}
                  <button
                    type="button"
                    onClick={() => setShowEmoji(v => !v)}
                    title="Эмодзи"
                    style={{ width: 34, height: 34, borderRadius: '50%', background: showEmoji ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.1)', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    😊
                  </button>
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={e => handleInputChange(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setMentionOpen(false); return }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                    }}
                    onFocus={e => { (e.currentTarget.parentElement!.style.borderColor = '#a78bfa') }}
                    onBlur={e => { (e.currentTarget.parentElement!.style.borderColor = '#e5e7eb'); setTimeout(() => setMentionOpen(false), 150) }}
                    placeholder={dmPartner ? `Message …${dmPartner}` : t('placeholder').replace('{{room}}', allRooms.find(r => r.id === currentRoom)?.label ?? currentRoom)}
                    style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 14, color: '#111827', fontFamily: 'inherit' }}
                  />
                  {!dmPartner && (
                    <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0 }} title="Type @ to mention">@</span>
                  )}
                </div>
                {/* Send button */}
                <button onClick={sendMessage} disabled={!input.trim() || sending}
                  style={{ width: 44, height: 44, borderRadius: '50%', background: input.trim() ? 'linear-gradient(135deg, #7c3aed, #2563eb)' : '#e5e7eb', border: 'none', cursor: input.trim() ? 'pointer' : 'default', color: '#fff', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s', flexShrink: 0 }}>
                  ↑
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <aside className="chat-sidebar-right" style={{ background: '#fff', borderLeft: '1px solid #e9d5ff', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '16px 14px', gap: 20, flexShrink: 0 }}>

          {dmPartner ? (
            /* DM info panel */
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 10 }}>Direct Message</div>
              <div style={{ background: '#eff6ff', borderRadius: 12, padding: '12px', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff', margin: '0 auto 8px' }}>{dmPartner.slice(0, 2).toUpperCase()}</div>
                <div style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}>…{dmPartner}</div>
                <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 4 }}>HSI Verified Human</div>
                <button onClick={() => setDmPartner(null)} style={{ marginTop: 12, padding: '6px 16px', background: 'none', border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: '#2563eb', fontWeight: 600 }}>← Back to rooms</button>
              </div>
            </div>
          ) : (
            <>
              {/* Room info for custom rooms */}
              {activeRoomObj?.custom && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#7c3aed', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8 }}>Room info</div>
                  <div style={{ background: '#f5f3ff', borderRadius: 12, padding: '10px 12px', border: '1px solid #ddd6fe' }}>
                    <div style={{ fontSize: 16, marginBottom: 6 }}>{activeRoomObj.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#4c1d95' }}>{activeRoomObj.label}</div>
                    {activeRoomObj.desc && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{activeRoomObj.desc}</div>}
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
                      {activeRoomObj.access_level === 'gold_only' ? '👑 Gold only' : activeRoomObj.access_level === 'verified' ? '✅ Verified' : '🌍 Public'}
                      {activeRoomObj.created_by && ` · by …${activeRoomObj.created_by}`}
                    </div>
                  </div>
                </div>
              )}

              {/* AI Moderation */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#7c3aed', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 10 }}>{t('ai_moderator')}</div>
                <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '10px 12px', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 6 }}>{t('ai_active')}</div>
                  {[t('filter_spam'), t('filter_toxic'), t('filter_flood'), t('filter_did')].map(r => (
                    <div key={r} style={{ fontSize: 11, color: '#16a34a', lineHeight: 1.9 }}>✓ {r}</div>
                  ))}
                </div>
              </div>

              {/* Rules */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#7c3aed', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 10 }}>{t('rules')}</div>
                {([['✓','#16a34a',t('rule_respect')],['✓','#16a34a',t('rule_humans')],['✗','#dc2626',t('rule_no_spam')],['✗','#dc2626',t('rule_no_toxic')],['✗','#dc2626',t('rule_no_bots')]] as [string,string,string][]).map(([icon,color,text]) => (
                  <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                    <span style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>{text}</span>
                  </div>
                ))}
              </div>

              {/* Trust levels */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#7c3aed', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 10 }}>{t('trust_levels')}</div>
                {[{label:'trusted',color:'#059669',desc:t('trust_trusted_desc')},{label:'community_verified',color:'#0891b2',desc:t('trust_community_desc')},{label:'newcomer',color:'#7c3aed',desc:t('trust_newcomer_desc')}].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                    <div><div style={{ fontSize: 11, fontWeight: 700, color: l.color }}>{l.label}</div><div style={{ fontSize: 10, color: '#9ca3af' }}>{l.desc}</div></div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ background: '#faf5ff', borderRadius: 12, padding: '10px 12px', border: '1px solid #e9d5ff' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4c1d95', marginBottom: 6 }}>{t('privacy_title')}</div>
            <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>{t('privacy_desc')}</div>
          </div>
        </aside>
      </div>
    </div>
  )
}
