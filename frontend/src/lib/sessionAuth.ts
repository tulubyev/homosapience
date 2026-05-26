/**
 * APTOGON Session Authentication
 * ──────────────────────────────
 * Implements the Signed Session Challenge protocol:
 *
 *   1. GET  /api/auth/challenge  → {nonce (hex)}
 *   2. Sign nonce bytes with Ed25519 private key (Web Crypto API)
 *   3. POST /api/auth/session    → {token (JWT)}
 *   4. Use  Authorization: Bearer <token> on all subsequent requests
 *
 * This proves private key ownership — sharing the DID string alone
 * is no longer sufficient to impersonate a user.
 *
 * Storage:
 *   - JWT session token → sessionStorage('aptogon_session_token')
 *     (tab-scoped: token is cleared when the tab closes)
 *   - DID + private key → localStorage('aptogon_did', 'aptogon_key')
 *     (set by verify/page.tsx after successful verification)
 *
 * Expiry strategy:
 *   - Token TTL = 1 hour (server-side JWT exp)
 *   - Auto-refresh when < 5 minutes remain (if private key is available)
 *   - Fall back to legacy X-APTOGON-DID header if session unavailable
 */

// ── Ed25519 PKCS#8 prefix (RFC 8410) ─────────────────────────────────────────
// Web Crypto requires PKCS#8 format; we prepend this 16-byte prefix to
// the raw 32-byte Ed25519 private key bytes.
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e,  // SEQUENCE
  0x02, 0x01, 0x00,  // INTEGER (version = 0)
  0x30, 0x05,  // SEQUENCE (algorithmIdentifier)
    0x06, 0x03, 0x2b, 0x65, 0x70,  // OID 1.3.101.112 (Ed25519)
  0x04, 0x22,  // OCTET STRING
    0x04, 0x20,  // OCTET STRING (private key)
])

// ── Encoding helpers ──────────────────────────────────────────────────────────

function base64urlDecode(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    b64.length + (4 - (b64.length % 4)) % 4, '='
  )
  const bin = atob(padded)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = ''
  bytes.forEach(b => { s += String.fromCharCode(b) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return arr
}

// ── Core crypto ───────────────────────────────────────────────────────────────

/**
 * Sign arbitrary bytes with the Ed25519 private key stored as base64url.
 * Returns base64url-encoded 64-byte signature.
 */
export async function signWithKey(keyB64: string, data: Uint8Array): Promise<string> {
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

// ── JWT helpers ───────────────────────────────────────────────────────────────

function parseJwtExp(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.exp ?? 0
  } catch {
    return 0
  }
}

function tokenIsValid(token: string, bufferSeconds = 300): boolean {
  return parseJwtExp(token) > Date.now() / 1000 + bufferSeconds
}

// ── Session management ────────────────────────────────────────────────────────

const SESSION_KEY = 'aptogon_session_token'

/** Get the cached session token if still valid (>5 min remaining). */
export function getCachedToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  const token = sessionStorage.getItem(SESSION_KEY)
  return token && tokenIsValid(token) ? token : null
}

/** Store a session token in sessionStorage. */
function storeToken(token: string): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_KEY, token)
  }
}

/** Clear the session token (e.g., on logout or key change). */
export function clearSession(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_KEY)
  }
}

/**
 * Obtain a valid session token.
 * - Returns cached token if still valid.
 * - Otherwise: fetches a challenge, signs it with the private key, exchanges for JWT.
 * - Returns null if authentication is not possible.
 */
export async function getSessionToken(
  did: string,
  keyB64: string,
): Promise<string | null> {
  // Return cached token if still valid (> 5 min remaining)
  const cached = getCachedToken()
  if (cached) return cached

  try {
    // 1. Get challenge nonce from server
    const challengeResp = await fetch('/api/auth/challenge')
    if (!challengeResp.ok) return null
    const { nonce } = await challengeResp.json() as { nonce: string }

    // 2. Sign the nonce bytes with Ed25519 private key
    const nonceBytes = hexToBytes(nonce)
    const signature = await signWithKey(keyB64, nonceBytes)

    // 3. Exchange signature for JWT
    const sessionResp = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, nonce, signature }),
    })
    if (!sessionResp.ok) return null
    const data = await sessionResp.json() as {
      token: string
      session_id: string
      concurrent_alert?: boolean
      concurrent_count?: number
    }

    storeToken(data.token)

    // Dispatch event if multiple concurrent sessions detected
    if (data.concurrent_alert && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aptogon:concurrent_sessions', {
        detail: { count: data.concurrent_count ?? 0 }
      }))
    }

    return data.token
  } catch {
    return null
  }
}

/**
 * Revoke all sessions for this DID (logout all devices).
 * Call after user confirms in UI.
 */
export async function revokeAllSessions(): Promise<boolean> {
  const headers = aptogonHeaders()
  if (!headers['Authorization'] && !headers['X-APTOGON-DID']) return false
  try {
    const r = await fetch('/api/auth/sessions', { method: 'DELETE', headers })
    if (r.ok) {
      clearSession()
      return true
    }
  } catch {}
  return false
}

/**
 * Get list of active sessions for current DID.
 */
export async function getActiveSessions(): Promise<{
  sessions: Array<{ session_id: string; ip: string; ua: string; iat: number; exp: number; is_current: boolean }>
  count: number
} | null> {
  const headers = aptogonHeaders()
  if (!headers['Authorization'] && !headers['X-APTOGON-DID']) return null
  try {
    const r = await fetch('/api/auth/sessions', { headers })
    if (r.ok) return r.json()
  } catch {}
  return null
}

/**
 * Try to refresh the session using localStorage credentials.
 * Used on page load when a session token may have expired.
 */
export async function autoRefreshSession(): Promise<string | null> {
  if (typeof localStorage === 'undefined') return null
  const did = localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did')
  const key = localStorage.getItem('aptogon_key')
  if (!did || !key) return null
  return getSessionToken(did, key)
}

// ── Request headers ───────────────────────────────────────────────────────────

/**
 * Returns the best available Authorization headers for API calls.
 *
 * Priority:
 *   1. Authorization: Bearer <JWT>  (if session token is cached and valid)
 *   2. X-APTOGON-DID: <did>         (legacy fallback)
 *
 * Call `getSessionToken()` or `autoRefreshSession()` first for fresh auth.
 */
export function aptogonHeaders(fallbackDid?: string): Record<string, string> {
  const token = getCachedToken()
  if (token) return { Authorization: `Bearer ${token}` }
  const did = fallbackDid
    || (typeof localStorage !== 'undefined' ? (localStorage.getItem('aptogon_did') || localStorage.getItem('hsi_did') || '') : '')
  if (did) return { 'X-APTOGON-DID': did }
  return {}
}

/**
 * Build headers for an authenticated fetch call.
 * If keyB64 is provided and no cached session exists, will attempt to create one.
 */
export async function authHeaders(
  did?: string,
  keyB64?: string,
): Promise<Record<string, string>> {
  // Fast path: use cached session
  const cached = getCachedToken()
  if (cached) return { Authorization: `Bearer ${cached}` }

  // Try to get a fresh session token if credentials available
  const resolvedDid = did
    || (typeof localStorage !== 'undefined' ? (localStorage.getItem('aptogon_did') || '') : '')
  const resolvedKey = keyB64
    || (typeof localStorage !== 'undefined' ? (localStorage.getItem('aptogon_key') || '') : '')

  if (resolvedDid && resolvedKey) {
    const token = await getSessionToken(resolvedDid, resolvedKey)
    if (token) return { Authorization: `Bearer ${token}` }
  }

  // Legacy fallback
  if (resolvedDid) return { 'X-APTOGON-DID': resolvedDid }
  return {}
}
