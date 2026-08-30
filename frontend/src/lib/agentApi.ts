// Anonymous humanity proof (Shielded Human) — thin wrapper over the HDAA endpoints.
//
// A shielded user proves "I'm a verified human" under a chosen pseudonym WITHOUT
// revealing their DID: /api/agent/delegate mints a token carrying human_trust_score
// + agent_id (the pseudonym), and /api/agent/verify returns it minus human_did.
// agent_id is simply the pseudonym here — the mechanics are identical to AI-agent
// delegation, only the framing differs.
import { getSessionToken } from './sessionAuth'

export interface HumanityProof {
  token: string
  agent_id: string
  expires_at: number
}

/** Mint a non-enumerable humanity proof for a shielded credential.
 *  Returns null if the session token or delegation call fails. */
export async function mintHumanityProof(
  did: string,
  keyB64: string,
  pseudonym: string,
): Promise<HumanityProof | null> {
  const jwt = await getSessionToken(did, keyB64)
  if (!jwt) return null
  try {
    const res = await fetch('/api/agent/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ agent_id: pseudonym, permissions: ['read'] }),
    })
    if (!res.ok) return null
    const data = await res.json() as { token: string; agent_id: string; expires_at: number }
    return { token: data.token, agent_id: data.agent_id, expires_at: data.expires_at }
  } catch {
    return null
  }
}

export interface ProofResult {
  valid: boolean
  human_trust_score?: number
  human_trust_label?: string
  agent_id?: string
  permissions?: string[]
  expires_at?: string
  reason?: string
}

/** Verify a humanity proof token — public, no auth, never exposes a DID. */
export async function verifyHumanityProof(token: string): Promise<ProofResult> {
  try {
    const res = await fetch(`/api/agent/verify?token=${encodeURIComponent(token)}`)
    const body = await res.json()
    if (res.ok) return { valid: true, ...body }
    // 403 → { detail: { valid:false, reason } }
    return { valid: false, reason: body?.detail?.reason ?? 'invalid' }
  } catch {
    return { valid: false, reason: 'network_error' }
  }
}

/** Shareable public link that renders the proof for a reader. */
export function proofLink(token: string, locale = 'en'): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://homosapience.org'
  return `${origin}/${locale}/human-proof?token=${encodeURIComponent(token)}`
}
