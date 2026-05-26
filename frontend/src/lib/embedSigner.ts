/**
 * embedSigner.ts — client-side embed assert flow (runs in the signer popup on
 * homosapience.org, where the DID key is accessible).
 */
import { signWithKey } from '@/lib/sessionAuth'

/** Canonical bytes the user signs — must match backend embed_service.assert_message. */
export function assertMessage(nonce: string, origin: string, did: string): Uint8Array {
  return new TextEncoder().encode(`aptogon-embed-assert:v1:${nonce}:${origin}:${did}`)
}

export interface AssertResult {
  token?: string
  trust_band?: string
  needs_verification?: boolean
  verify_url?: string
}

/**
 * Run challenge → sign → assert. Returns the assertion token (or
 * needs_verification if the DID has no valid credential).
 */
export async function runEmbedAssert(
  publishableKey: string,
  origin: string,
  did: string,
  keyB64: string,
): Promise<AssertResult> {
  const chRes = await fetch('/api/embed/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishable_key: publishableKey, origin }),
  })
  if (!chRes.ok) throw new Error(`challenge failed (${chRes.status})`)
  const { nonce } = (await chRes.json()) as { nonce: string }

  const signature = await signWithKey(keyB64, assertMessage(nonce, origin, did))

  const asrRes = await fetch('/api/embed/assert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishable_key: publishableKey, nonce, did, signature }),
  })
  if (!asrRes.ok) throw new Error(`assert failed (${asrRes.status})`)
  return (await asrRes.json()) as AssertResult
}
