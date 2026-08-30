'use client'
import { useState, useRef, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { GestureCanvas, GestureLabels, TouchEventData, ChallengeResult } from '@/components/GestureCanvas'
import HumanBadge from '@/components/HumanBadge'
import { getSessionToken, revokeAllSessions, getActiveSessions, signWithKey } from '@/lib/sessionAuth'
import { RiskSignalCollector, submitRiskAssessment } from '@/lib/riskSignals'
import { collectBrowserFingerprint } from '@/lib/browserFingerprint'
import { getAccountBadge, type AccountBadge } from '@/lib/pairApi'
import { declareHandle, listHandles, deleteHandle, badgeMarkdown, type Handle } from '@/lib/handlesApi'
import { mintHumanityProof, proofLink } from '@/lib/agentApi'

const VERIFY_STYLES = `
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes pulse-ring { 0%,100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
  @keyframes pulse-hint { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
  .spinner { animation: spin 1.2s linear infinite; }
  .pulse-ring { animation: pulse-ring 1.8s ease-in-out infinite; }
`

// Map confidence_band → display value
const bandToDisplay = (band: string | undefined): { pct: number; label: string; color: string } => {
  if (band === 'high')   return { pct: 92, label: 'High',   color: '#059669' }
  if (band === 'medium') return { pct: 82, label: 'Medium', color: '#0891b2' }
  return                        { pct: 55, label: 'Low',    color: '#dc2626' }
}

type Stage = 'draw' | 'analyzing' | 'success' | 'failed' | 'bonding' | 'complete'

interface DebugPattern {
  velocity_std: number
  velocity_mean: number
  pause_entropy: number
  correction_count: number
  rhythm_irregularity: number
  total_duration_ms: number
  point_count: number
  possible_motor_difficulty: boolean
}

interface FpSignals {
  webdriver: boolean
  webgl_vendor: string | null
  webgl_renderer: string | null
  audio_hash: string | null
  hardware_concurrency: number | null
  device_memory: number | null
  touch_points: number | null
  color_depth: number | null
  pixel_ratio: number | null
  timezone_offset: number | null
  anomalies: string[]
}

interface VerifyResult {
  is_human: boolean
  confidence_band: 'low' | 'medium' | 'high'
  passed: boolean
  reasoning: string
  via_fallback?: boolean
  anomalies?: string[]
  did?: string
  private_key_b64?: string
  expression_proof?: string
  tx_hash?: string
  credential?: Record<string, unknown>
  trust_score?: number
  trust_label?: string   // newcomer | community_verified | trusted
  debug?: DebugPattern
  fp_signals?: FpSignals
}

// ── Device Fingerprint (Sybil Protection C) ────────────────────────────────
// Raw data never leaves the browser — only SHA-256 hash is sent
async function collectDeviceFingerprint(): Promise<string> {
  try {
    // 1. Canvas fingerprint
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#f60'
      ctx.fillRect(0, 0, 10, 10)
      ctx.fillStyle = '#069'
      ctx.font = '14px Arial'
      ctx.fillText('hsi', 2, 15)
    }
    const canvasData = canvas.toDataURL()

    // 2. Platform signals (not personal data)
    const platform = [
      navigator.hardwareConcurrency || 0,
      navigator.language || '',
      screen.colorDepth || 0,
      `${screen.width}x${screen.height}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    ].join('|')

    // 3. Hash locally — raw data never transmitted
    const raw = canvasData + '||' + platform
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(raw)
    )
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    // If fingerprinting fails (privacy mode, etc.), return empty — server will skip check
    return ''
  }
}

const STEP_COLORS = [
  { color: '#7c3aed', bg: 'linear-gradient(135deg, #7c3aed, #a855f7)' },
  { color: '#db2777', bg: 'linear-gradient(135deg, #db2777, #f472b6)' },
  { color: '#0891b2', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)' },
  { color: '#2563eb', bg: 'linear-gradient(135deg, #2563eb, #60a5fa)' },
]

const ProgressBar = ({ value, color = '#7c3aed' }: { value: number; color?: string }) => (
  <div style={{ background: 'rgba(0,0,0,0.08)', borderRadius: 99, height: 10, overflow: 'hidden' }}>
    <div style={{
      width: `${Math.min(100, Math.max(0, value))}%`,
      height: '100%', background: color, borderRadius: 99, transition: 'width 0.5s ease',
    }} />
  </div>
)

function FpSignalsPanel({ fp }: { fp?: FpSignals }) {
  if (!fp) return null
  const hasAnomalies = fp.anomalies.length > 0
  const rows: [string, string][] = [
    ['webdriver',     String(fp.webdriver)],
    ['webgl_vendor',  fp.webgl_vendor  ?? '—'],
    ['webgl_renderer',fp.webgl_renderer ?? '—'],
    ['audio_hash',    fp.audio_hash     ?? '—'],
    ['hw_concurrency',String(fp.hardware_concurrency ?? '—')],
    ['device_memory', fp.device_memory != null ? `${fp.device_memory} GB` : '—'],
    ['touch_points',  String(fp.touch_points  ?? '—')],
    ['color_depth',   String(fp.color_depth   ?? '—')],
    ['pixel_ratio',   String(fp.pixel_ratio   ?? '—')],
    ['tz_offset',     String(fp.timezone_offset ?? '—')],
  ]
  return (
    <details style={{ marginTop: 12, borderRadius: 16, border: `1px solid ${hasAnomalies ? '#fed7aa' : '#d1fae5'}`, background: hasAnomalies ? '#fffbf5' : '#f0fdf4', overflow: 'hidden' }}>
      <summary style={{ padding: '10px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, color: '#64748b', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>Browser fingerprint signals</span>
        {hasAnomalies
          ? <span style={{ color: '#f97316', fontWeight: 700, fontSize: 11 }}>⚠ {fp.anomalies.join(', ')}</span>
          : <span style={{ color: '#10b981', fontWeight: 700, fontSize: 11 }}>✓ clean</span>
        }
      </summary>
      <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontFamily: 'monospace', fontSize: 11 }}>
        {rows.map(([k, v]) => {
          const isNull = v === '—'
          const isBad  = fp.anomalies.some(a => a.includes(k.replace('_', ':')))
          return (
            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#94a3b8', width: 120, flexShrink: 0 }}>{k}</span>
              <span style={{ fontWeight: 700, color: isBad ? '#f97316' : isNull ? '#94a3b8' : '#374151' }}>{v}</span>
            </div>
          )
        })}
      </div>
    </details>
  )
}

export default function VerifyPage() {
  const t      = useTranslations('verify')
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [linkCode, setLinkCode] = useState<string | null>(searchParams?.get('link') ?? null)   // device pairing code (from QR ?link= or manual entry)
  const [codeInput, setCodeInput] = useState('')

  const [consented, setConsented] = useState(false)
  const [stage, setStage] = useState<Stage>('draw')
  const [didCopied, setDidCopied] = useState(false)
  const [pairResult, setPairResult] = useState<{ display_name?: string; is_admin?: boolean; role?: string } | null>(null)
  const [accountBadge, setAccountBadge] = useState<AccountBadge | null>(null)
  const [concurrentAlert, setConcurrentAlert] = useState<{ count: number } | null>(null)
  const [sessionsList, setSessionsList] = useState<Array<{ session_id: string; ip: string; ua: string; iat: number; is_current: boolean }> | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  const copyDid = (did: string) => {
    navigator.clipboard.writeText(did).then(() => {
      setDidCopied(true)
      setTimeout(() => setDidCopied(false), 2500)
    })
  }
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [bondCount, setBondCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [importError, setImportError]     = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState(false)
  const [restoreOpen, setRestoreOpen]     = useState(false)
  // Set when the server says this device already holds a credential. Rendered as
  // a recovery panel rather than a plain error: re-verifying can never succeed
  // here, so pointing the user back at the canvas is a dead end.
  const [deviceBound, setDeviceBound]     = useState(false)
  const restoreRef = useRef<HTMLDivElement>(null)
  const pairRef    = useRef<HTMLDivElement>(null)
  const [exportPwd, setExportPwd]         = useState('')
  const [exportPwdOpen, setExportPwdOpen] = useState(false)
  const [importPwd, setImportPwd]         = useState('')
  const [pendingFile, setPendingFile]     = useState<File | null>(null)
  const [handles, setHandles]           = useState<Handle[]>([])
  const [handleInputs, setHandleInputs] = useState<Record<string, string>>({})
  const [badgeCopied, setBadgeCopied]   = useState<string | null>(null)
  // Shielded Human: 'public' = reputation badges + device binding (default);
  // 'shielded' = anonymity-first — fresh DID, no fingerprint, no handles.
  const [mode, setMode] = useState<'public' | 'shielded'>('public')
  // Shielded humanity proof (HDAA token under a pseudonym, no DID exposed)
  const [pseudonym, setPseudonym] = useState('')
  const [proofUrl, setProofUrl] = useState<string | null>(null)
  const [minting, setMinting] = useState(false)
  const [proofCopied, setProofCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const analyzingRef    = useRef<HTMLDivElement>(null)
  const drawCardRef     = useRef<HTMLDivElement>(null)
  const [analyzingSec, setAnalyzingSec] = useState(0)
  const analyzingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // R2: risk signal collector — starts tracking mouse/behavior on consent
  const riskCollectorRef = useRef<RiskSignalCollector | null>(null)

  // ── AES-GCM helpers (Web Crypto — no external libs) ───────────────────────
  const _deriveKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
    const enc  = new TextEncoder()
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt'],
    )
  }
  const _b64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf); let s = ''
    bytes.forEach(b => { s += String.fromCharCode(b) }); return btoa(s)
  }
  const _fromb64 = (s: string): ArrayBuffer => {
    const bin = atob(s); const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return arr.buffer as ArrayBuffer
  }

  // ── Integrity hash ────────────────────────────────────────────────────────
  // HMAC-SHA256(key=raw_private_key_bytes, data=did+canonical_credential_json)
  // An attacker cannot compute a valid HMAC without the private key bytes,
  // even though the key is in the file — changing the credential invalidates
  // the HMAC unless they also re-sign it using the correct key bytes.
  const _computeIntegrity = async (did: string, credJson: string, rawKeyB64: string): Promise<string> => {
    const enc       = new TextEncoder()
    const keyBytes  = _fromb64(rawKeyB64)
    const hmacKey   = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const data      = enc.encode(did + '|' + credJson)
    const sig       = await crypto.subtle.sign('HMAC', hmacKey, data)
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // ── Export key — AES-GCM encrypted with user password ─────────────────────
  const exportKey = async (password: string) => {
    const did     = localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did') || ''
    const keyB64  = localStorage.getItem('aptogon_key') || ''
    const credRaw = localStorage.getItem('hsi_credential') || ''
    if (!did || !keyB64) return

    const saltArr = crypto.getRandomValues(new Uint8Array(16))
    const ivArr   = crypto.getRandomValues(new Uint8Array(12))
    const key  = await _deriveKey(password, saltArr)
    const enc  = new TextEncoder()
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivArr.buffer as ArrayBuffer }, key, enc.encode(keyB64)
    )

    const credObj      = credRaw ? JSON.parse(credRaw) : null
    const canonicalCred = JSON.stringify(credObj ?? {})
    const integrityHash = await _computeIntegrity(did, canonicalCred, keyB64)

    const warningLines: Record<string, string[]> = {
      ru: [
        '  Изменение любых полей этого файла будет',
        '  обнаружено при следующей загрузке и приведёт',
        '  к блокировке вашей верификации.',
      ],
      en: [
        '  Any modification to this file will be detected',
        '  on the next import and will result in a',
        '  verification ban of your account.',
      ],
      de: [
        '  Jede Änderung an diesem File wird beim nächsten',
        '  Import erkannt und führt zur Sperrung Ihrer',
        '  Verifizierung.',
      ],
      fr: [
        '  Toute modification de ce fichier sera détectée',
        '  au prochain import et entraînera le bannissement',
        '  de votre vérification.',
      ],
      zh: [
        '  任何对此文件的修改将在下次导入时被检测到，',
        '  并将导致您的验证账户被封禁。',
      ],
      ar: [
        '  سيتم اكتشاف أي تعديل على هذا الملف عند الاستيراد',
        '  التالي وسيؤدي إلى حظر حسابك.',
      ],
    }
    const localizedWarning = warningLines[locale] ?? warningLines['en']

    const backup = {
      '⚠️_DO_NOT_EDIT': 'DO NOT EDIT THIS FILE MANUALLY!',
      '⚠️_WARNING': [
        '════════════════════════════════════════════════════',
        ...localizedWarning,
        '════════════════════════════════════════════════════',
      ],
      version:         'aptogon-key-v2-encrypted',
      did,
      encrypted_key:   _b64(encrypted),
      salt:            _b64(saltArr.buffer as ArrayBuffer),
      iv:              _b64(ivArr.buffer as ArrayBuffer),
      created_at:      new Date().toISOString(),
      credential:      credObj,
      integrity_hash:  integrityHash,
      integrity_algo:  'HMAC-SHA256(private_key | did+credential)',
      note:            'Private key encrypted with AES-256-GCM. Password required to restore.',
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `aptogon-key-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setExportPwdOpen(false)
    setExportPwd('')
  }

  // ── Import key — handles both v1 (plain) and v2 (encrypted) ───────────────
  const importKey = async (file: File, password?: string) => {
    setImportError(null)
    try {
      const text   = await file.text()
      const backup = JSON.parse(text)

      if (!backup.did?.startsWith('did:key:')) {
        setImportError('Invalid DID format — expected did:key:...')
        return
      }

      let privateKeyB64: string

      if (backup.version === 'aptogon-key-v2-encrypted') {
        // Encrypted format
        if (!password) {
          // Ask for password
          setPendingFile(file)
          setImportError(null)
          return
        }
        try {
          const saltBuf = _fromb64(backup.salt)
          const ivBuf   = _fromb64(backup.iv)
          const saltArr = new Uint8Array(saltBuf)
          const key  = await _deriveKey(password, saltArr)
          const dec  = new TextDecoder()
          const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBuf },
            key,
            _fromb64(backup.encrypted_key),
          )
          privateKeyB64 = dec.decode(plain)
        } catch {
          setImportError('Wrong password — could not decrypt the key file.')
          return
        }
      } else if (backup.version === 'aptogon-key-v1') {
        // Legacy plain format
        if (!backup.private_key_b64) { setImportError('Missing private_key_b64'); return }
        privateKeyB64 = backup.private_key_b64
      } else {
        setImportError('Unknown backup format version.')
        return
      }

      // ── Integrity check ────────────────────────────────────────────────────
      if (backup.integrity_hash) {
        try {
          const canonicalCred = JSON.stringify(backup.credential ?? {})
          const expected = await _computeIntegrity(backup.did, canonicalCred, privateKeyB64)
          if (expected !== backup.integrity_hash) {
            setImportError(
              '🚨 ФАЙЛ БЫЛ ИЗМЕНЁН!\n' +
              'Целостность файла нарушена — поля были отредактированы после сохранения.\n' +
              'Попытка использования изменённого файла приведёт к бану аккаунта.\n\n' +
              '🚨 FILE HAS BEEN TAMPERED!\n' +
              'Integrity check failed — fields were edited after saving.\n' +
              'Using a modified key file will result in an account ban.'
            )
            return
          }
        } catch { /* if check fails to run — proceed, backend is authoritative */ }
      }

      localStorage.setItem('aptogon_did',  backup.did)
      localStorage.setItem('aptogon_key',  privateKeyB64)
      localStorage.setItem('hsi_did',      backup.did)
      if (backup.credential) {
        localStorage.setItem('hsi_credential', JSON.stringify(backup.credential))
      }
      setPendingFile(null)
      setImportPwd('')
      window.dispatchEvent(new CustomEvent('hsi:verified', { detail: { did: backup.did } }))
      setImportSuccess(true)
      // Acquire session token for imported key
      getSessionToken(backup.did, privateKeyB64).catch(() => {/* non-critical */})
    } catch {
      setImportError('Failed to read file — make sure it is a valid aptogon key backup.')
    }
  }

  // R2: start behavioral tracking as soon as user consents (observe mouse before gesture)
  useEffect(() => {
    if (consented && !riskCollectorRef.current) {
      riskCollectorRef.current = new RiskSignalCollector()
    }
  }, [consented])

  // Once the user consents, bring the drawing canvas into view just below the
  // sticky header. scroll-margin-top on the card sets the clearance; re-run on the
  // next frame so the consent→draw reflow + canvas resize can't leave it mispositioned.
  useEffect(() => {
    if (!(consented && stage === 'draw')) return
    let raf = 0
    const bring = () => drawCardRef.current?.scrollIntoView({ block: 'start' })
    const id = setTimeout(() => { bring(); raf = requestAnimationFrame(bring) }, 100)
    return () => { clearTimeout(id); cancelAnimationFrame(raf) }
  }, [consented, stage])

  // Scroll to analyzing section when stage changes
  useEffect(() => {
    if (stage === 'analyzing') {
      setTimeout(() => analyzingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    }
  }, [stage])

  // Listen for concurrent session alert from sessionAuth
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { count: number }
      setConcurrentAlert(detail)
      // Also fetch the full sessions list for display
      getActiveSessions().then(d => { if (d) setSessionsList(d.sessions) })
    }
    window.addEventListener('aptogon:concurrent_sessions', handler)
    return () => window.removeEventListener('aptogon:concurrent_sessions', handler)
  }, [])

  useEffect(() => {
    if (!result?.did) return
    listHandles().then(h => {
      setHandles(h)
      const inputs: Record<string, string> = {}
      h.forEach(({ platform, username_lc }) => { inputs[platform] = username_lc })
      setHandleInputs(inputs)
    })
  }, [result?.did])

  const steps = t.raw('steps') as Array<{ num: string; title: string; desc: string }>
  const analyzingChecks = t.raw('analyzing_checks') as string[]
  const completeCards = t.raw('complete_cards') as Array<{ emoji: string; title: string; desc: string }>
  const storedItems = t.raw('stored_items') as Array<{ icon: string; key: string; desc: string }>

  const handleGesture = async (events: TouchEventData[], challenges: ChallengeResult[]) => {
    setStage('analyzing')
    setError(null)
    setAnalyzingSec(0)
    if (analyzingTimerRef.current) clearInterval(analyzingTimerRef.current)
    const t0 = Date.now()
    analyzingTimerRef.current = setInterval(() => {
      setAnalyzingSec(Math.floor((Date.now() - t0) / 1000))
    }, 250)
    // Fresh UUID for every attempt — prevents session_replayed error on retry
    const sessionId = crypto.randomUUID()
    // Scroll immediately — don't wait for React to mount the analyzing div
    window.scrollTo({ top: window.scrollY + 200, behavior: 'smooth' })
    try {
      // R2: submit risk signals in parallel with fingerprint + browser fp collection
      const riskPromise = riskCollectorRef.current
        ? submitRiskAssessment(riskCollectorRef.current, sessionId)
        : Promise.resolve(null)

      // Collect device fingerprint (Sybil Protection C) + browser fingerprint in parallel
      const [fpHash, browserFp] = await Promise.all([
        collectDeviceFingerprint(),
        collectBrowserFingerprint(),
      ])

      // Await risk result — already mostly resolved by now (parallel)
      const riskResult = await riskPromise
      // If server says blocked (RISK_GATE=true) — show error immediately
      if (riskResult?.blocked) {
        if (analyzingTimerRef.current) { clearInterval(analyzingTimerRef.current); analyzingTimerRef.current = null }
        setError('Automated activity detected. Please use a regular browser without automation tools.')
        setStage('draw')
        return
      }

      // Renewal: if this browser still holds a DID and its key, refresh THAT
      // identity rather than minting a new one. Credentials last 30 days, and a
      // new DID would orphan everything attached to the old one — console API
      // keys, the verified email, declared handles, trust score. Best-effort:
      // any failure here just falls through to an ordinary fresh verification.
      let renewal: { renew_did: string; renew_nonce: string; renew_signature: string } | undefined
      const existingDid = localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did') || ''
      const existingKey = localStorage.getItem('aptogon_key') || ''
      if (mode !== 'shielded' && existingDid && existingKey) {
        try {
          const ch = await fetch('/api/auth/challenge')
          if (ch.ok) {
            const { nonce } = await ch.json() as { nonce: string }
            const nonceBytes = new Uint8Array((nonce.match(/../g) ?? []).map(h => parseInt(h, 16)))
            renewal = {
              renew_did: existingDid,
              renew_nonce: nonce,
              renew_signature: await signWithKey(existingKey, nonceBytes),
            }
          }
        } catch { /* fall through to a fresh verification */ }
      }

      const res = await fetch('/api/verify/expression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events,
          session_id: sessionId,
          mode,
          ...(renewal ?? {}),
          // Shielded mode never sends a device fingerprint — no fp→DID linkage.
          fp_hash: mode === 'shielded' ? undefined : (fpHash || undefined),
          browser_fp: browserFp,
          challenges: challenges.length > 0 ? challenges.map(c => ({
            challenge_token: c.challenge_token ?? undefined,
            dot_x:       c.challenge_token ? undefined : c.dot_x,
            dot_y:       c.challenge_token ? undefined : c.dot_y,
            shown_at_ms: c.shown_at_ms,
            reaction_ms: c.reaction_ms,
            tap_x:       c.tap_x,
            tap_y:       c.tap_y,
            color:       c.color,
          })) : null,
        }),
      })
      // Handle rate-limit (Sybil Protection C)
      if (analyzingTimerRef.current) { clearInterval(analyzingTimerRef.current); analyzingTimerRef.current = null }
      if (res.status === 429) {
        const detail = await res.json()
        const nextDate = detail.detail?.next_allowed_at
          ? new Date(detail.detail.next_allowed_at * 1000).toLocaleDateString()
          : ''
        setError(`Too many verifications from this device. Try again after ${nextDate}.`)
        setStage('draw')
        return
      }
      // Device already holds a credential. Drawing again can never clear this,
      // so show the two routes that actually work instead of an error.
      if (res.status === 409) {
        setDeviceBound(true)
        setError(null)
        setStage('draw')
        return
      }
      // Handle gateway timeout / server errors
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`)
        setError(`Server error ${res.status}: ${errText.slice(0, 120)}`)
        setStage('draw')
        return
      }

      const data: VerifyResult = await res.json()
      // Guard: if response is not a valid VerifyResult (e.g. proxy error body)
      if (typeof data.is_human !== 'boolean') {
        setError('Unexpected response from server. Please try again.')
        setStage('draw')
        return
      }
      setResult(data)
      if (data.passed && data.did) {
        localStorage.setItem('aptogon_did', data.did)
        if (data.private_key_b64) localStorage.setItem('aptogon_key', data.private_key_b64)
        localStorage.setItem('hsi_did', data.did)
        if (fpHash && mode !== 'shielded') localStorage.setItem('hsi_fp_hash', fpHash)
        const hsiCred = JSON.stringify({
          ...(data.credential ?? {}),
          issuanceDate: new Date().toISOString(),
          expirationDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          credentialSubject: {
            ...(data.credential?.credentialSubject ?? {}),
            id: data.did, isHuman: true,
            confidence_band: data.confidence_band,
            expressionProof: data.expression_proof,
            txHash: data.tx_hash,
            trust_score: data.trust_score ?? 0.1,
            trust_label: data.trust_label ?? 'newcomer',
          },
        })
        localStorage.setItem('hsi_credential', hsiCred)
        window.dispatchEvent(new CustomEvent('hsi:verified', { detail: { cred: hsiCred, did: data.did } }))

        // ── Acquire session token (Ed25519 proof of key ownership) ─────────
        if (data.private_key_b64) {
          getSessionToken(data.did, data.private_key_b64)
            .then(() => getAccountBadge().then(b => { if (b) setAccountBadge(b) }))
            .catch(() => {/* non-critical */})
        }

        // ── Device pairing: auto-claim if link code in URL ─────────────────
        if (linkCode && data.did) {
          try {
            const pr = await fetch('/api/pair/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ link_code: linkCode, new_did: data.did }),
            })
            if (pr.ok) setPairResult(await pr.json())
          } catch { /* pairing non-critical, ignore */ }
        }

        setStage('success')
      } else {
        setStage('failed')
      }
    } catch {
      setError(t('error_backend'))
      setStage('draw')
    }
  }

  const simulateBonds = () => {
    setStage('bonding')
    let n = 0
    const iv = setInterval(() => {
      n++; setBondCount(n)
      if (n >= 3) { clearInterval(iv); setTimeout(() => setStage('complete'), 800) }
    }, 1400)
  }

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{VERIFY_STYLES}</style>

      {/* ── CONCURRENT SESSIONS ALERT ── */}
      {concurrentAlert && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '2px solid #fbbf24' }}>
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 900, color: '#92400e', textAlign: 'center' }}>
              {concurrentAlert.count} active sessions detected
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#78350f', textAlign: 'center', lineHeight: 1.5 }}>
              Your DID is active on <strong>{concurrentAlert.count} devices</strong>.
              If you did not authorise all of them, someone may have a copy of your key.
            </p>

            {sessionsList && sessionsList.length > 0 && (
              <div style={{ background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a', padding: '10px 14px', marginBottom: 16 }}>
                {sessionsList.map(s => (
                  <div key={s.session_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #fef3c7', fontSize: 12 }}>
                    <span style={{ fontSize: 16 }}>{s.is_current ? '📱' : '💻'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#451a03' }}>{s.is_current ? 'This device' : 'Other device'}</div>
                      <div style={{ color: '#92400e', fontFamily: 'monospace', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.ip} · {new Date(s.iat * 1000).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConcurrentAlert(null)}
                style={{ flex: 1, padding: '10px 0', background: '#f1f5f9', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#475569' }}
              >
                Ignore
              </button>
              <button
                disabled={revokingAll}
                onClick={async () => {
                  setRevokingAll(true)
                  await revokeAllSessions()
                  setRevokingAll(false)
                  setConcurrentAlert(null)
                  setSessionsList(null)
                  alert('All sessions revoked. Please re-verify to log in again.')
                }}
                style={{ flex: 1, padding: '10px 0', background: 'linear-gradient(135deg,#dc2626,#ef4444)', border: 'none', borderRadius: 10, cursor: revokingAll ? 'default' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff' }}
              >
                {revokingAll ? '⏳ Revoking…' : '🔒 Revoke all sessions'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <div style={{
        background: 'linear-gradient(135deg, #ede9fe 0%, #f0f9ff 55%, #fdf4ff 100%)',
        padding: '56px 24px 48px', textAlign: 'center',
        borderBottom: '1px solid rgba(124,58,237,0.1)',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
          borderRadius: 99, padding: '6px 16px', marginBottom: 20,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>{t('hero_badge')}</span>
        </div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 900, lineHeight: 1.15, margin: '0 0 16px', color: '#0f172a', letterSpacing: '-0.03em' }}>
          {t('hero_title')}{' '}
          <span style={{ background: 'linear-gradient(90deg,#7c3aed,#db2777)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {t('hero_human')}
          </span>
        </h1>
        <p style={{ fontSize: 18, color: '#475569', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
          {t('hero_subtitle')}
        </p>
      </div>

      {/* ── STEPS ── */}
      <div style={{ padding: '48px 24px', background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
        <p style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 28 }}>
          {t('steps_label')}
        </p>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ background: STEP_COLORS[i].bg, borderRadius: 20, padding: '24px 20px', color: '#fff', boxShadow: `0 4px 24px ${STEP_COLORS[i].color}30` }}>
              <div style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.2)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 14 }}>
                {['✏️', '🧠', '🔑', '⛓️'][i]}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.7, marginBottom: 6 }}>
                {t('steps_label').split(' ')[0]} {s.num}
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>{s.title}</div>
              <p style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px 60px' }}>

        {/* ══ DEVICE PAIRING BANNER ══ */}
        {linkCode && !importSuccess && (
          <div style={{ background: 'linear-gradient(135deg,#7c3aed,#2563eb)', borderRadius: 18, padding: '16px 22px', color: '#fff', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 28, flexShrink: 0 }}>📱</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>Device pairing mode</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>Complete verification on this device to link it to your account. Each device keeps its own key and proves its own humanness.</div>
            </div>
          </div>
        )}

        {/* ══ MANUAL PAIRING CODE ENTRY ══ */}
        {/* Also shown once the device turns out to be already bound: pairing is
            one of the two ways out of that state, so it must be reachable from
            there even though consent has already been given. */}
        {!linkCode && !importSuccess && (!consented || deviceBound) && (
          <div ref={pairRef} style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 16, padding: '14px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>📱 Linking a new device? Enter your pairing code:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                maxLength={6}
                placeholder="ABC123"
                style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1.5px solid #cbd5e1', fontSize: 18, fontFamily: 'monospace', letterSpacing: '0.15em', textAlign: 'center', textTransform: 'uppercase' }}
              />
              <button
                onClick={() => { if (codeInput.trim().length === 6) setLinkCode(codeInput.trim()) }}
                disabled={codeInput.trim().length !== 6}
                style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: codeInput.trim().length === 6 ? 'linear-gradient(135deg,#7c3aed,#2563eb)' : '#cbd5e1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: codeInput.trim().length === 6 ? 'pointer' : 'not-allowed' }}
              >
                Apply
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Get the code on your verified device: chat → 🔗 Link new device.</div>
          </div>
        )}

        {/* ══ RESTORE EXISTING DID ══ */}
        {/* Kept reachable when the device is already bound — restoring the key
            backup is the primary way out, and re-drawing never is. */}
        {!importSuccess && (!consented || deviceBound) && (
          <div ref={restoreRef} style={{ marginBottom: 20 }}>
            <button
              onClick={() => setRestoreOpen(o => !o)}
              style={{
                width: '100%', background: restoreOpen ? '#ede9fe' : '#f8fafc',
                border: `1.5px solid ${restoreOpen ? '#c4b5fd' : '#e2e8f0'}`,
                borderRadius: 16, padding: '14px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', color: '#374151', fontWeight: 600, fontSize: 14,
                transition: 'all 0.2s',
              }}
            >
              <span>🔄 Already verified? Restore your DID from backup</span>
              <span style={{ fontSize: 18, transition: 'transform 0.2s', transform: restoreOpen ? 'rotate(180deg)' : 'none' }}>⌄</span>
            </button>
            {restoreOpen && (
              <div style={{
                background: '#fff', border: '1.5px solid #c4b5fd', borderTop: 'none',
                borderRadius: '0 0 16px 16px', padding: 20,
              }}>
                <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>
                  Upload your <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>aptogon-key-*.json</code> backup file to restore your DID without re-verifying.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) { setPendingFile(f); importKey(f) } }}
                />
                {!pendingFile ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      width: '100%', padding: '12px 20px',
                      background: 'linear-gradient(135deg,#7c3aed,#2563eb)',
                      color: '#fff', fontWeight: 700, fontSize: 14,
                      border: 'none', borderRadius: 12, cursor: 'pointer',
                    }}
                  >
                    📂 Choose backup file
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, color: '#4b5563', padding: '8px 12px', background: '#f3f4f6', borderRadius: 8 }}>
                      🔒 <strong>{pendingFile.name}</strong> — enter password to decrypt
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="password"
                        placeholder="Backup password..."
                        value={importPwd}
                        onChange={e => setImportPwd(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') importKey(pendingFile, importPwd) }}
                        style={{ flex: 1, padding: '9px 14px', borderRadius: 10, border: '1.5px solid #c4b5fd', fontSize: 13, outline: 'none' }}
                        autoFocus
                      />
                      <button
                        onClick={() => importKey(pendingFile, importPwd)}
                        disabled={!importPwd}
                        style={{ padding: '9px 16px', background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 13, border: 'none', borderRadius: 10, cursor: importPwd ? 'pointer' : 'default', opacity: importPwd ? 1 : 0.5 }}
                      >
                        Unlock
                      </button>
                    </div>
                    <button
                      onClick={() => { setPendingFile(null); setImportPwd(''); setImportError(null) }}
                      style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      ← Choose different file
                    </button>
                  </div>
                )}
                {importError && (
                  <div style={{ marginTop: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#dc2626' }}>
                    ⚠️ {importError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ IMPORT SUCCESS ══ */}
        {importSuccess && (
          <div style={{
            background: 'linear-gradient(135deg,#059669,#10b981)', borderRadius: 24,
            padding: '32px 28px', color: '#fff', textAlign: 'center',
            boxShadow: '0 8px 40px rgba(5,150,105,0.25)',
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 900 }}>DID Restored!</h2>
            <p style={{ margin: '0 0 6px', fontSize: 14, opacity: 0.9 }}>
              Your identity has been restored from backup.
            </p>
            <p style={{ margin: '0 0 24px', fontSize: 12, opacity: 0.75 }}>
              {localStorage.getItem('aptogon_did')?.slice(0, 30)}...
            </p>
            <Link href="/chat" style={{
              display: 'inline-block', background: 'rgba(255,255,255,0.2)',
              color: '#fff', padding: '12px 28px', borderRadius: 16,
              fontWeight: 700, fontSize: 14, textDecoration: 'none',
              border: '1.5px solid rgba(255,255,255,0.4)',
            }}>
              💬 Go to Chat →
            </Link>
          </div>
        )}

        {/* ══ CONSENT DIALOG ══ */}
        {!consented && !importSuccess && (
          <div style={{
            background: '#fff', borderRadius: 24, padding: 32,
            border: '2px solid rgba(124,58,237,0.2)',
            boxShadow: '0 8px 40px rgba(124,58,237,0.10)',
            marginBottom: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
                borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, flexShrink: 0,
              }}>🛡️</div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
                  {t('consent.title')}
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
                  {t('consent.subtitle')}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {(t.raw('consent.items') as Array<{ icon: string; title: string; desc: string }>).map(item => (
                <div key={item.title} style={{
                  display: 'flex', gap: 12, padding: '12px 14px',
                  background: 'rgba(124,58,237,0.04)', borderRadius: 14,
                  border: '1px solid rgba(124,58,237,0.1)',
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 2 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Shielded Human: choose the purpose of this verification */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 10 }}>
                {t('consent.mode_heading')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {([
                  { id: 'public',   icon: '🌐', title: t('consent.mode_public_title'),   desc: t('consent.mode_public_desc') },
                  { id: 'shielded', icon: '🛡️', title: t('consent.mode_shielded_title'), desc: t('consent.mode_shielded_desc') },
                ] as const).map(opt => {
                  const active = mode === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setMode(opt.id)}
                      style={{
                        textAlign: 'start', padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                        border: active ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                        background: active ? 'rgba(124,58,237,0.06)' : '#fff',
                      }}
                    >
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{opt.icon}</div>
                      <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a', marginBottom: 4 }}>{opt.title}</div>
                      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 20, lineHeight: 1.6 }}>
              {t.rich('consent.gdpr_note', {
                link: (chunks) => <a href="/privacy" style={{ color: '#7c3aed' }}>{chunks}</a>,
              })}
            </p>

            <button
              onClick={() => setConsented(true)}
              style={{
                width: '100%', padding: '14px', borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(124,58,237,0.35)',
              }}
            >
              {t('consent.start_button')}
            </button>
            <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 12, marginBottom: 0 }}>
              {t('consent.no_account')}
            </p>
          </div>
        )}

        {/* ══ DRAW / FAILED ══ */}
        {consented && (stage === 'draw' || stage === 'failed') && (<>

          <div ref={drawCardRef} style={{ scrollMarginTop: 72, background: '#fff', borderRadius: 24, padding: '28px 28px 12px', border: '2px dashed rgba(124,58,237,0.3)', boxShadow: '0 4px 32px rgba(124,58,237,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 44 }}>
              <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>✏️</div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{t('canvas_title')}</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', marginTop: 2 }}>{t('canvas_subtitle')}</p>
              </div>
            </div>
            <GestureCanvas onComplete={handleGesture} labels={{
              dotTap:      (c, tot) => t('canvas_dot_tap',      { current: c, total: tot }),
              dotAllDone:  (tot)    => t('canvas_dot_all_done', { total: tot }),
              dotWait:     (d, tot) => t('canvas_dot_wait',     { done: d, total: tot }),
              keepDrawing: t('canvas_keep_drawing'),
              release:     t('canvas_release'),
              tapHint:     t('canvas_tap_hint'),
              pointsDone:  (c)      => t('canvas_points_done',  { count: c }),
              pointsCount: (c)      => t('canvas_points_count', { count: c }),
              drawHint:    t('canvas_draw_hint'),
              sec:         t('canvas_sec'),
              clear:       t('canvas_clear'),
              lifted:      t('canvas_lifted'),
              restarted:   t('canvas_restarted'),
            } satisfies GestureLabels} progressBelowCanvas />
            <div style={{ marginTop: 10, padding: '8px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px solid #bae6fd', fontSize: 12, color: '#0369a1', lineHeight: 1.5 }}>
              {t('canvas_dot_reminder')}
            </div>
          </div>

          {stage === 'failed' && result && (
            <div style={{ marginTop: 20 }}>
              <div style={{ background: '#fff', borderRadius: 24, padding: 24, border: '2px solid #fecaca', boxShadow: '0 4px 24px rgba(239,68,68,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 32, flexShrink: 0 }}>❌</div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#dc2626' }}>{t('failed_title')}</h3>
                    <p style={{ margin: 0, fontSize: 13, color: '#ef4444', marginTop: 4 }}>{result.reasoning}</p>
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: '#64748b' }}>
                      {t('confidence_label')} {result.via_fallback && <span style={{ color: '#f97316', fontSize: 11 }}>{t('fallback_label')}</span>}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 900, color: bandToDisplay(result.confidence_band).color }}>{bandToDisplay(result.confidence_band).label}</span>
                  </div>
                  <ProgressBar value={bandToDisplay(result.confidence_band).pct} color="#ef4444" />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                    <span>{t('threshold_0')}</span>
                    <span style={{ color: '#f97316', fontWeight: 600 }}>{t('threshold_70').replace('70', result.via_fallback ? '70' : '85')}</span>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{t('threshold_100')}</span>
                  </div>
                </div>
                {result.anomalies && result.anomalies.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {result.anomalies.map(a => (
                      <span key={a} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: '#fee2e2', color: '#dc2626' }}>{a}</span>
                    ))}
                  </div>
                )}
                <div style={{ background: '#fef2f2', borderRadius: 14, padding: '12px 16px', fontSize: 13, color: '#64748b', border: '1px solid #fecaca', lineHeight: 1.6 }}>
                  {t('failed_tip')}
                </div>
              </div>

              {result.debug && (
                <details style={{ marginTop: 12, borderRadius: 16, border: '1px solid #e2e8f0', background: '#f8fafc', overflow: 'hidden' }}>
                  <summary style={{ padding: '10px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, color: '#64748b', userSelect: 'none' }}>
                    {t('debug_title')}
                  </summary>
                  <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontFamily: 'monospace', fontSize: 11 }}>
                    {[
                      ['velocity_std', result.debug.velocity_std, '> 0.01'],
                      ['velocity_mean', result.debug.velocity_mean, ''],
                      ['pause_entropy', result.debug.pause_entropy, '> 1.0'],
                      ['corrections', result.debug.correction_count, '> 0'],
                      ['rhythm_irr.', result.debug.rhythm_irregularity, '> 0.3'],
                      ['duration_ms', result.debug.total_duration_ms, '> 500ms'],
                      ['points', result.debug.point_count, '> 10'],
                      ['motor_diff', String(result.debug.possible_motor_difficulty), ''],
                    ].map(([k, v, hint]) => (
                      <div key={String(k)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
                        <span style={{ color: '#94a3b8', width: 110, flexShrink: 0 }}>{k}</span>
                        <span style={{ fontWeight: 700, color: '#374151' }}>{typeof v === 'number' ? v.toFixed(4) : String(v)}</span>
                        {hint && <span style={{ color: '#94a3b8', fontSize: 10 }}>{hint}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <FpSignalsPanel fp={result.fp_signals} />
            </div>
          )}

          {deviceBound && (
            <div style={{ marginTop: 16, borderRadius: 16, background: '#f5f3ff', border: '1.5px solid #c4b5fd', padding: '16px 18px' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#5b21b6', marginBottom: 6 }}>
                🔑 {t('device_bound_title')}
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#4c1d95', lineHeight: 1.65 }}>
                {t('device_bound_body')}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    setRestoreOpen(true)
                    setTimeout(() => restoreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
                  }}
                  style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  {t('device_bound_restore')}
                </button>
                <button
                  onClick={() => {
                    setTimeout(() => pairRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
                  }}
                  style={{ padding: '10px 16px', borderRadius: 10, border: '1.5px solid #c4b5fd', background: '#fff', color: '#5b21b6', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  {t('device_bound_pair')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 16, borderRadius: 16, background: '#fff7ed', border: '1px solid #fed7aa', padding: '12px 16px' }}>
              <p style={{ margin: 0, fontSize: 13, fontFamily: 'monospace', color: '#c2410c' }}>{error}</p>
            </div>
          )}
        </>)}

        {/* ══ ANALYZING ══ */}
        {stage === 'analyzing' && (
          <div ref={analyzingRef} style={{ background: '#fff', borderRadius: 24, padding: '48px 32px', textAlign: 'center', border: '2px solid rgba(219,39,119,0.2)', boxShadow: '0 4px 32px rgba(219,39,119,0.08)' }}>
            {/* Animated spinner */}
            <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 24px' }}>
              {/* Pulsing outer ring */}
              <div className="pulse-ring" style={{
                position: 'absolute', inset: -6,
                borderRadius: '50%', border: '3px solid rgba(219,39,119,0.25)',
              }} />
              {/* Spinning arc */}
              <svg className="spinner" width="80" height="80" viewBox="0 0 80 80" style={{ position: 'absolute', inset: 0 }}>
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(219,39,119,0.12)" strokeWidth="6" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="#db2777" strokeWidth="6"
                  strokeLinecap="round" strokeDasharray="60 154" />
              </svg>
              {/* Center icon */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 28,
              }}>⏳</div>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{t('analyzing_title')}</h2>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>{t('analyzing_subtitle')}</p>
            {/* Seconds counter */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 99, padding: '6px 18px', marginBottom: 24 }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>⏱ Анализ:</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: '#db2777', fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'center' }}>{analyzingSec}</span>
              <span style={{ fontSize: 13, color: '#64748b' }}>сек</span>
            </div>
            <div style={{ maxWidth: 280, margin: '0 auto', textAlign: 'start' }}>
              {analyzingChecks.map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: ['#7c3aed','#db2777','#e11d48','#f97316','#059669'][i], flexShrink: 0 }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ SUCCESS ══ */}
        {stage === 'success' && result && (
          <div>
            {/* Device pairing result */}
            {pairResult && (
              <div style={{ background: 'linear-gradient(135deg,#7c3aed,#2563eb)', borderRadius: 20, padding: '18px 22px', color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 4px 24px rgba(124,58,237,0.25)' }}>
                <div style={{ fontSize: 32, flexShrink: 0 }}>🔗</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 3 }}>Device linked!</div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    {pairResult.display_name ? `Profile "${pairResult.display_name}" transferred.` : 'Your devices are now connected.'}
                    {pairResult.is_admin && <span style={{ marginInlineStart: 6, background: 'rgba(255,255,255,0.2)', padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>👤 {pairResult.role}</span>}
                  </div>
                </div>
              </div>
            )}

            {/* ── Account badge (DEVICE_ACCOUNTS feature) ── */}
            {accountBadge && (
              <div style={{ background: '#fff', borderRadius: 18, padding: '12px 18px', border: '1.5px solid rgba(124,58,237,0.2)', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>🔐</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>
                      This device is in your account
                      <span style={{ marginInlineStart: 6, background: 'rgba(124,58,237,0.1)', color: '#7c3aed', fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99 }}>
                        {accountBadge.device_count} device{accountBadge.device_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {accountBadge.max_trust_label && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        Best trust: <strong style={{ color: '#059669' }}>{Math.round(accountBadge.max_trust_score * 100)}%</strong>
                        <span style={{ marginInlineStart: 4, color: '#94a3b8' }}>{accountBadge.max_trust_label}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Link
                  href={`/${locale}/account`}
                  style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontWeight: 700, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', border: '1px solid rgba(124,58,237,0.2)' }}
                >
                  Manage devices →
                </Link>
              </div>
            )}
            <div style={{ background: 'linear-gradient(135deg,#059669,#10b981)', borderRadius: 24, padding: '28px 28px', color: '#fff', boxShadow: '0 8px 40px rgba(5,150,105,0.25)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{ width: 56, height: 56, background: 'rgba(255,255,255,0.2)', borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>✅</div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{t('success_title')}</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.8 }}>{t('success_subtitle')}</p>
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>{t('confidence_label')}</span>
                  <span style={{ fontWeight: 900, fontSize: 18 }}>{bandToDisplay(result.confidence_band).label}</span>
                </div>
                <ProgressBar value={bandToDisplay(result.confidence_band).pct} color="rgba(255,255,255,0.9)" />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, opacity: 0.7 }}>
                  <span>{t('threshold_0')}</span><span>{t('threshold_70')}</span><span>{t('threshold_85')}</span><span>{t('threshold_100')}</span>
                </div>
              </div>
            </div>

            {/* Trust Score Badge (Sybil Protection B) */}
            {result?.trust_score !== undefined && (
              <div style={{ background: '#fff', borderRadius: 18, padding: '14px 20px', border: '2px solid rgba(124,58,237,0.15)', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <HumanBadge
                    state={result.trust_label === 'revoked' ? 'revoked' : 'verified'}
                    size={48}
                  />
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                      Trust Score: <span style={{ color: '#7c3aed' }}>{Math.round((result.trust_score ?? 0.1) * 100)}%</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                      {result.trust_label === 'trusted' && '🏆 Trusted — 7+ bonds'}
                      {result.trust_label === 'community_verified' && '✅ Community Verified — 3+ bonds'}
                      {(!result.trust_label || result.trust_label === 'newcomer') && '🌱 Newcomer — get 3 bonds to reach 50%'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
                  <div style={{ height: 6, background: '#f3e8ff', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 99, width: `${Math.round((result.trust_score ?? 0.1) * 100)}%`, transition: 'width 0.6s ease' }} />
                  </div>
                  {(result.trust_label === 'newcomer' || !result.trust_label) && (
                    <div style={{ fontSize: '0.7rem', color: '#a78bfa', textAlign: 'end' }}>→ get bonds to grow</div>
                  )}
                </div>
              </div>
            )}

            <FpSignalsPanel fp={result.fp_signals} />

            {/* DID */}
            <div style={{ background: '#fff', borderRadius: 24, padding: 24, border: '2px solid rgba(8,145,178,0.2)', marginBottom: 16, boxShadow: '0 4px 24px rgba(8,145,178,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#0891b2,#22d3ee)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🔑</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0f172a' }}>{t('did_title')}</h3>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#0891b2', fontWeight: 600 }}>{t('did_subtitle')}</p>
                </div>
              </div>
              <div style={{ background: '#f0f9ff', borderRadius: 14, padding: 12, border: '1px solid rgba(8,145,178,0.2)', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6, flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>{t('did_id_label')}</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => result.did && copyDid(result.did)}
                      style={{
                        padding: '4px 12px', borderRadius: 8,
                        border: '1px solid rgba(8,145,178,0.3)',
                        background: didCopied ? '#0891b2' : 'rgba(8,145,178,0.08)',
                        color: didCopied ? '#fff' : '#0891b2',
                        fontWeight: 700, fontSize: 11, cursor: 'pointer',
                        transition: 'all 0.2s', whiteSpace: 'nowrap',
                      }}
                    >
                      {didCopied ? '✓ Copied!' : '📋 Copy DID'}
                    </button>
                    <button
                      onClick={() => setExportPwdOpen(o => !o)}
                      title="Download encrypted key backup"
                      style={{
                        padding: '4px 12px', borderRadius: 8,
                        border: '1px solid rgba(5,150,105,0.35)',
                        background: 'rgba(5,150,105,0.08)',
                        color: '#059669',
                        fontWeight: 700, fontSize: 11, cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🔒 Save key
                    </button>
                  </div>
                </div>
                <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: '#0f172a', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  {result.did}
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: t('did_what_label'), value: t('did_what_value') },
                  { label: t('did_where_label'), value: t('did_where_value') },
                  { label: t('did_key_label'), value: t('did_key_value') },
                  { label: t('did_gen_label'), value: t('did_gen_value') },
                ].map(item => (
                  <div key={item.label} style={{ background: '#f0f9ff', borderRadius: 12, padding: '10px 12px', border: '1px solid rgba(8,145,178,0.12)' }}>
                    <span style={{ fontSize: 11, color: '#0891b2', fontWeight: 700, display: 'block', marginBottom: 4 }}>{item.label}</span>
                    <span style={{ fontSize: 11, color: '#475569', lineHeight: 1.5 }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Declare handles — hidden in Shielded mode (no handle ↔ DID linkage) */}
            {mode !== 'shielded' && (
            <div style={{ background: '#fff', borderRadius: 24, padding: 24, border: '2px solid rgba(124,58,237,0.15)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🔗</div>
                <div>
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: 15 }}>Declare your handles</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Link your social accounts to get a public ✦ badge</div>
                </div>
              </div>
              {(['github', 'reddit', 'x', 'linkedin', 'bluesky', 'hackernews'] as const).map(platform => (
                <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 90, fontSize: 12, color: '#64748b', flexShrink: 0 }}>
                    {platform === 'x' ? 'X / Twitter' : platform.charAt(0).toUpperCase() + platform.slice(1)}
                  </span>
                  <input
                    type="text"
                    placeholder="your-username"
                    value={handleInputs[platform] ?? ''}
                    onChange={e => setHandleInputs(prev => ({ ...prev, [platform]: e.target.value }))}
                    onBlur={async e => {
                      const username = e.target.value.trim()
                      try {
                        if (!username) {
                          const existing = handles.find(h => h.platform === platform)
                          if (existing) {
                            await deleteHandle(platform, existing.username_lc)
                            setHandles(prev => prev.filter(h => h.platform !== platform))
                          }
                          return
                        }
                        await declareHandle(platform, username)
                        setHandles(prev => {
                          const next = prev.filter(h => h.platform !== platform)
                          return [...next, { platform, username_lc: username.toLowerCase(), created_at: Math.floor(Date.now() / 1000) }]
                        })
                      } catch {}
                    }}
                    style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, color: '#0f172a', background: '#f8fafc' }}
                  />
                  {handleInputs[platform] && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(badgeMarkdown(platform, handleInputs[platform]))
                        setBadgeCopied(platform)
                        setTimeout(() => setBadgeCopied(null), 2000)
                      }}
                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: badgeCopied === platform ? '#22c55e' : '#f8fafc', color: badgeCopied === platform ? '#fff' : '#7c3aed', fontWeight: 700, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
                      title="Copy badge markdown"
                    >
                      {badgeCopied === platform ? '✓' : '📋'}
                    </button>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
                Paste your handle, then click away to save. Use 📋 to copy a GitHub README badge.
              </div>
            </div>
            )}

            {/* Shielded: anonymous humanity proof (HDAA token under a pseudonym) */}
            {mode === 'shielded' && result?.did && (
            <div style={{ background: '#fff', borderRadius: 24, padding: 24, border: '2px solid rgba(124,58,237,0.15)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🛡️</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>Anonymous humanity proof</h3>
                  <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>Prove you’re human under a pseudonym — no identity revealed</p>
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 12 }}>
                Pick a pseudonym and generate a shareable link. Anyone can verify “a real human
                is behind this name” — without ever learning who you are. The link carries no DID
                and is not listed in any public directory.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  value={pseudonym}
                  onChange={e => setPseudonym(e.target.value)}
                  placeholder="pseudonym (e.g. NightOwl)"
                  maxLength={64}
                  style={{ flex: 1, minWidth: 160, padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }}
                />
                <button
                  disabled={!pseudonym.trim() || minting}
                  onClick={async () => {
                    setMinting(true); setProofUrl(null)
                    const proof = await mintHumanityProof(result.did!, result.private_key_b64 ?? localStorage.getItem('aptogon_key') ?? '', pseudonym.trim())
                    setMinting(false)
                    if (proof) setProofUrl(proofLink(proof.token, locale))
                    else setError('Could not generate proof. Is FEATURE_AGENT_PASSPORT enabled?')
                  }}
                  style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: pseudonym.trim() && !minting ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#cbd5e1', color: '#fff', fontWeight: 800, fontSize: 13, cursor: pseudonym.trim() && !minting ? 'pointer' : 'default' }}
                >
                  {minting ? '…' : 'Generate'}
                </button>
              </div>
              {proofUrl && (
                <div style={{ background: '#f8fafc', borderRadius: 12, padding: 12, border: '1px solid #e2e8f0' }}>
                  <p style={{ margin: '0 0 6px', fontFamily: 'monospace', fontSize: 11, color: '#7c3aed', wordBreak: 'break-all' }}>{proofUrl}</p>
                  <button
                    onClick={() => { navigator.clipboard.writeText(proofUrl); setProofCopied(true); setTimeout(() => setProofCopied(false), 1500) }}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: proofCopied ? '#22c55e' : '#fff', color: proofCopied ? '#fff' : '#7c3aed', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
                  >
                    {proofCopied ? '✓ Copied' : '📋 Copy proof link'}
                  </button>
                </div>
              )}
            </div>
            )}

            {/* Aptos */}
            <div style={{ background: '#fff', borderRadius: 24, padding: 24, border: '2px solid rgba(37,99,235,0.2)', marginBottom: 16, boxShadow: '0 4px 24px rgba(37,99,235,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#2563eb,#60a5fa)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>⛓️</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0f172a' }}>{t('aptos_title')}</h3>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: result.tx_hash ? '#dcfce7' : '#f1f5f9', color: result.tx_hash ? '#16a34a' : '#64748b' }}>
                    {result.tx_hash ? t('aptos_onchain') : t('aptos_local')}
                  </span>
                </div>
              </div>
              {result.tx_hash ? (
                <div style={{ background: '#eff6ff', borderRadius: 12, padding: 12, border: '1px solid rgba(37,99,235,0.2)', marginBottom: 12 }}>
                  <p style={{ margin: '0 0 4px', fontSize: 11, color: '#94a3b8' }}>{t('aptos_tx_label')}</p>
                  <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: '#2563eb', wordBreak: 'break-all' }}>{result.tx_hash}</p>
                </div>
              ) : (
                <div style={{ background: '#f8fafc', borderRadius: 12, padding: 12, border: '1px solid #e2e8f0', marginBottom: 12, fontSize: 13, color: '#64748b' }}>
                  {t('aptos_no_key').split('APTOS_PRIVATE_KEY')[0]}
                  <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 6, fontFamily: 'monospace' }}>APTOS_PRIVATE_KEY</code>
                  {t('aptos_no_key').split('APTOS_PRIVATE_KEY')[1]}
                </div>
              )}
              <div style={{ background: '#eff6ff', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#2563eb', lineHeight: 1.6 }}>
                {t('aptos_note')}
              </div>
            </div>

            {/* Bond CTA */}
            <div style={{ background: '#fff', borderRadius: 24, padding: 24, border: '2px solid rgba(99,102,241,0.2)', boxShadow: '0 4px 24px rgba(99,102,241,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#6366f1,#a5b4fc)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🛡️</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0f172a' }}>{t('bond_title')}</h3>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#6366f1', fontWeight: 600 }}>{t('bond_subtitle')}</p>
                </div>
              </div>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>{t('bond_desc')}</p>
              <button onClick={simulateBonds} style={{ width: '100%', padding: '16px 24px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontWeight: 900, fontSize: 15, border: 'none', borderRadius: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
                {t('bond_cta')}
              </button>
            </div>
          </div>
        )}

        {/* ══ BONDING ══ */}
        {stage === 'bonding' && (
          <div style={{ background: '#fff', borderRadius: 24, padding: '48px 32px', textAlign: 'center', border: '2px solid rgba(99,102,241,0.2)', boxShadow: '0 4px 32px rgba(99,102,241,0.08)' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{t('bonding_title')}</h2>
            <p style={{ margin: '0 0 40px', fontSize: 13, color: '#94a3b8' }}>{t('bonding_subtitle')}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 32 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: 'transform 0.5s, opacity 0.5s', transform: bondCount >= i ? 'scale(1.1)' : 'scale(1)', opacity: bondCount >= i ? 1 : 0.4 }}>
                  <div style={{ width: 64, height: 64, borderRadius: 20, border: '2px solid', borderColor: bondCount >= i ? '#22c55e' : '#e2e8f0', background: bondCount >= i ? '#dcfce7' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, transition: 'all 0.5s', boxShadow: bondCount >= i ? '0 4px 20px rgba(34,197,94,0.2)' : 'none' }}>
                    {bondCount >= i ? '✅' : '👤'}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: bondCount >= i ? '#16a34a' : '#94a3b8' }}>
                    {bondCount >= i ? t('bonding_vouched') : t('bonding_waiting')}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ maxWidth: 240, margin: '0 auto' }}>
              <ProgressBar value={(bondCount / 3) * 100} color="#6366f1" />
            </div>
            <p style={{ marginTop: 12, fontSize: 13, color: '#94a3b8' }}>{bondCount} {t('bonding_progress')}</p>
          </div>
        )}

        {/* ══ COMPLETE ══ */}
        {stage === 'complete' && (
          <div>
            <div style={{ background: 'linear-gradient(135deg,#2563eb,#6366f1,#7c3aed)', borderRadius: 24, padding: '40px 32px', color: '#fff', textAlign: 'center', boxShadow: '0 8px 48px rgba(99,102,241,0.3)', marginBottom: 16 }}>
              <div style={{ width: 80, height: 80, background: 'rgba(255,255,255,0.2)', borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, margin: '0 auto 20px' }}>✨</div>
              <h2 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 900 }}>{t('complete_title')}</h2>
              <p style={{ margin: '0 0 28px', fontSize: 15, opacity: 0.8 }}>{t('complete_subtitle')}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                {completeCards.map(b => (
                  <div key={b.title} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 14 }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{b.emoji}</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{b.title}</div>
                    <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{b.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 24, padding: 20, border: '1px solid #e2e8f0', marginBottom: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
                {t('stored_title')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {storedItems.map(item => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#374151' }}>
                    <span>{item.icon}</span>
                    <div><strong>{item.key}</strong> — {item.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Save key backup — encrypted with password */}
            <div style={{ background: '#fefce8', border: '2px solid #fde047', borderRadius: 16, padding: '14px 18px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#713f12' }}>🔒 Save your encrypted key backup</div>
                  <div style={{ fontSize: 12, color: '#854d0e', marginTop: 2 }}>Protected with your password — only you can decrypt it</div>
                </div>
                <button
                  onClick={() => setExportPwdOpen(o => !o)}
                  style={{ padding: '10px 20px', background: '#ca8a04', color: '#fff', fontWeight: 700, fontSize: 13, border: 'none', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  💾 Download backup
                </button>
              </div>
              {exportPwdOpen && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="password"
                    placeholder="Set a password for this backup..."
                    value={exportPwd}
                    onChange={e => setExportPwd(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && exportPwd.length >= 6) exportKey(exportPwd) }}
                    style={{ flex: 1, minWidth: 200, padding: '9px 14px', borderRadius: 10, border: '1.5px solid #fbbf24', fontSize: 13, outline: 'none' }}
                    autoFocus
                  />
                  <button
                    onClick={() => exportKey(exportPwd)}
                    disabled={exportPwd.length < 6}
                    style={{ padding: '9px 18px', background: exportPwd.length >= 6 ? '#ca8a04' : '#d1d5db', color: '#fff', fontWeight: 700, fontSize: 13, border: 'none', borderRadius: 10, cursor: exportPwd.length >= 6 ? 'pointer' : 'default' }}
                  >
                    Encrypt & Save
                  </button>
                  <div style={{ width: '100%', fontSize: 11, color: '#92400e', marginTop: 2 }}>
                    Min 6 characters. Without this password the backup cannot be restored.
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Link href="/chat" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 20px', background: 'linear-gradient(135deg,#2563eb,#60a5fa)', color: '#fff', fontWeight: 900, fontSize: 14, borderRadius: 16, textDecoration: 'none', boxShadow: '0 4px 20px rgba(37,99,235,0.25)' }}>
                {t('cta_chat')}
              </Link>
              <Link href="/bond" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 20px', background: '#fff', color: '#6366f1', fontWeight: 900, fontSize: 14, borderRadius: 16, textDecoration: 'none', border: '2px solid rgba(99,102,241,0.3)' }}>
                {t('cta_bond')}
              </Link>
            </div>
          </div>
        )}
      </div>

      <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', margin: 0, paddingBottom: 24 }}>
        {t('footer_note')}
      </p>
    </div>
  )
}
