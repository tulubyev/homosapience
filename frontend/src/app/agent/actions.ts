'use server'

/**
 * CartPilot demo — server-side actions calling the real, public APTOGON HDAA API
 * on the main site. Runs server-to-server (Server Actions), so it isn't subject
 * to the browser CORS whitelist in backend/main.py, and the client never sees or
 * handles any human credential — only the delegation token an agent would carry.
 *
 * Session auth mirrors frontend/src/lib/sessionAuth.ts (challenge → Ed25519 sign
 * → JWT exchange) using a dedicated, server-only demo account
 * (DEMO_HUMAN_DID / DEMO_HUMAN_KEY_B64 env vars) — never a real visitor's
 * credential. The session JWT is cached in-memory and refreshed automatically
 * (it only lives 1 hour server-side), so the demo keeps working indefinitely
 * with no manual token refresh.
 */

const API_BASE = 'https://homosapience.org'

// ── Ed25519 signing (same PKCS#8-wrapping approach as sessionAuth.ts) ──────────

const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e,
  0x02, 0x01, 0x00,
  0x30, 0x05,
    0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22,
    0x04, 0x20,
])

function base64urlDecode(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    b64.length + (4 - (b64.length % 4)) % 4, '='
  )
  const bin = Buffer.from(padded, 'base64')
  return new Uint8Array(bin)
}

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return arr
}

async function signWithDemoKey(data: Uint8Array): Promise<string> {
  const keyB64 = process.env.DEMO_HUMAN_KEY_B64
  if (!keyB64) throw new Error('DEMO_HUMAN_KEY_B64 not configured')

  const rawKey = base64urlDecode(keyB64)
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + rawKey.length)
  pkcs8.set(PKCS8_PREFIX)
  pkcs8.set(rawKey, PKCS8_PREFIX.length)

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer as ArrayBuffer,
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('Ed25519', cryptoKey, data.buffer as ArrayBuffer)
  return base64urlEncode(new Uint8Array(sig))
}

function parseJwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
    return payload.exp ?? 0
  } catch {
    return 0
  }
}

// Module-level cache — persists across calls within the same server process.
let cachedSessionToken: string | null = null

async function getDemoSessionToken(): Promise<string> {
  if (cachedSessionToken && parseJwtExp(cachedSessionToken) > Date.now() / 1000 + 300) {
    return cachedSessionToken
  }

  const did = process.env.DEMO_HUMAN_DID
  if (!did) throw new Error('DEMO_HUMAN_DID not configured')

  const challengeResp = await fetch(`${API_BASE}/api/auth/challenge`)
  if (!challengeResp.ok) throw new Error('Failed to fetch auth challenge')
  const { nonce } = await challengeResp.json() as { nonce: string }

  const signature = await signWithDemoKey(hexToBytes(nonce))

  const sessionResp = await fetch(`${API_BASE}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, nonce, signature }),
  })
  if (!sessionResp.ok) throw new Error('Failed to establish demo session')
  const { token } = await sessionResp.json() as { token: string }

  cachedSessionToken = token
  return token
}

// ── Public server actions ──────────────────────────────────────────────────────

export type DelegateResult = {
  ok: true
  delegation_id: string
  token: string
  expires_at: number
} | { ok: false; error: string }

export async function delegateAgent(): Promise<DelegateResult> {
  try {
    const jwt = await getDemoSessionToken()
    const res = await fetch(`${API_BASE}/api/agent/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        agent_id: 'my-shopping-assistant',
        agent_name: 'ShopBot (CartPilot demo)',
        permissions: ['read', 'search'],
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body?.detail?.message || body?.detail?.error || `HTTP ${res.status}` }
    }
    const data = await res.json()
    return { ok: true, delegation_id: data.delegation_id, token: data.token, expires_at: data.expires_at }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export type VerifyResult = {
  ok: true
  valid: true
  human_trust_score: number
  human_trust_label: string
  agent_id: string
  permissions: string[]
  expires_at: string
} | { ok: true; valid: false; reason: string } | { ok: false; error: string }

export async function verifyAgent(token: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${API_BASE}/api/agent/verify?token=${encodeURIComponent(token)}`)
    const data = await res.json()
    if (res.ok && data.valid) {
      return {
        ok: true, valid: true,
        human_trust_score: data.human_trust_score,
        human_trust_label: data.human_trust_label,
        agent_id: data.agent_id,
        permissions: data.permissions,
        expires_at: data.expires_at,
      }
    }
    return { ok: true, valid: false, reason: data?.detail?.reason || data?.reason || 'unknown' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export type RevokeResult = { ok: true } | { ok: false; error: string }

export async function revokeAgent(delegationId: string): Promise<RevokeResult> {
  try {
    const jwt = await getDemoSessionToken()
    const res = await fetch(`${API_BASE}/api/agent/${encodeURIComponent(delegationId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body?.detail?.message || body?.detail?.error || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}
