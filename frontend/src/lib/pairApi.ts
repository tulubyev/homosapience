/**
 * pairApi.ts — typed fetch wrappers for /api/pair device-account endpoints.
 *
 * Backend: backend/routers/pair.py (FEATURE_DEVICE_ACCOUNTS gated)
 * Auth: authHeaders() from sessionAuth (JWT Bearer or X-APTOGON-DID fallback)
 */
import { authHeaders } from '@/lib/sessionAuth'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DeviceEntry {
  did:        string
  label:      string | null
  is_primary: boolean
  linked_at:  number   // unix timestamp
  revoked:    boolean
}

export interface AccountSummary {
  person_id:       string
  device_count:    number
  devices:         DeviceEntry[]
  max_trust_score: number
  max_trust_label: string | null
  this_did?:       string          // set by /devices endpoint
}

export interface AccountBadge {
  device_count:    number
  max_trust_label: string | null
  max_trust_score: number
}

export interface PairingCreate {
  link_code:   string
  verify_url:  string
  expires_at:  number
  ttl_seconds: number
}

export interface UnlinkResult {
  status: 'unlinked' | 'already_unlinked'
  did:    string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function jsonReq(url: string, method: string, body?: unknown): Promise<Response> {
  const h = await authHeaders()
  return fetch(url, {
    method,
    headers: body ? { ...h, 'Content-Type': 'application/json' } : h,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * List all devices in the calling device's person account.
 * Returns null if the feature is off (404) or not authenticated.
 */
export async function listDevices(): Promise<AccountSummary | null> {
  try {
    const r = await jsonReq('/api/pair/devices', 'GET')
    if (!r.ok) return null
    return r.json()
  } catch {
    return null
  }
}

/**
 * Compact account badge for verify-page header.
 * Returns null if feature is off or not authenticated.
 */
export async function getAccountBadge(): Promise<AccountBadge | null> {
  try {
    const r = await jsonReq('/api/pair/account', 'GET')
    if (!r.ok) return null
    return r.json()
  } catch {
    return null
  }
}

/**
 * Unlink (revoke) a device from the calling device's person.
 * Only devices in the SAME person can be unlinked.
 * Throws on 403 (not your device) or network error.
 */
export async function unlinkDevice(did: string): Promise<UnlinkResult> {
  const r = await jsonReq('/api/pair/unlink', 'POST', { did })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    throw new Error(detail?.detail?.message ?? `unlink failed: ${r.status}`)
  }
  return r.json()
}

/**
 * Create a new pairing code for QR display.
 * The calling device must be verified (credential still valid).
 */
export async function createPairing(): Promise<PairingCreate> {
  const h = await authHeaders()
  const r = await fetch('/api/pair/create', { method: 'POST', headers: h })
  if (!r.ok) throw new Error(`create_pairing failed: ${r.status}`)
  return r.json()
}
