/**
 * Console API wrappers — typed fetch calls for /api/console/*
 * Auth is handled by authHeaders() from sessionAuth (JWT or X-APTOGON-DID fallback).
 */
import { authHeaders } from '@/lib/sessionAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: number
  publishable_key: string
  name: string
  allowed_origins: string[]
  active: boolean
  created_at: number
  last_used_at: number | null
  usage_this_month: number       // billed: server-side /siteverify calls
  gestures_this_month?: number   // attempts: gestures drawn + classified (GBM data)
  monthly_cap: number
}

export interface CreateKeyResult {
  publishable_key: string
  secret_key: string
  name: string
  allowed_origins: string[]
}

export interface DomainMethods {
  dns_txt: { name: string; value: string }
  well_known: { url: string; content: string }
}

export interface Domain {
  id: number
  origin: string
  status: 'pending' | 'verified' | 'failed'
  method: string | null
  created_at: number
  verified_at: number | null
  // present only for non-verified domains
  token?: string
  methods?: DomainMethods
}

export interface CreateDomainResult {
  id: number
  origin: string
  status: string
  token: string
  recommended: string
  methods: DomainMethods
}

export interface VerifyDomainResult {
  id: number
  origin: string
  status: 'pending' | 'verified' | 'failed'
  method: 'dns_txt' | 'well_known' | null
}

export interface ConsoleApiError extends Error {
  code?: string
  status: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function jsonHeaders(): Promise<Record<string, string>> {
  const h = await authHeaders()
  return { ...h, 'Content-Type': 'application/json' }
}

function makeError(msg: string, status: number, code?: string): ConsoleApiError {
  const e = new Error(msg) as ConsoleApiError
  e.code = code
  e.status = status
  return e
}

async function extractCode(r: Response): Promise<string | undefined> {
  try {
    const body = await r.json() as { error?: string; detail?: { error?: string } | string }
    if (typeof body.detail === 'object') return body.detail?.error
    if (typeof body.error === 'string') return body.error
  } catch { /* ignore */ }
  return undefined
}

// ── Keys ──────────────────────────────────────────────────────────────────────

export async function listKeys(): Promise<ApiKey[]> {
  const h = await authHeaders()
  const r = await fetch('/api/console/keys', { headers: h })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError(`list_keys failed: ${r.status}`, r.status, code)
  }
  const data = await r.json() as { keys: ApiKey[] }
  return data.keys
}

export async function createKey(name: string, origin: string): Promise<CreateKeyResult> {
  const h = await jsonHeaders()
  const r = await fetch('/api/console/keys', {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ name, allowed_origins: [origin] }),
  })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError('create_key failed', r.status, code)
  }
  return r.json() as Promise<CreateKeyResult>
}

export async function deactivateKey(id: number): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/console/keys/${id}`, { method: 'DELETE', headers: h })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError(`deactivate_key failed: ${r.status}`, r.status, code)
  }
}

export async function reactivateKey(id: number): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/console/keys/${id}/reactivate`, { method: 'POST', headers: h })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError('reactivate_key failed', r.status, code)
  }
}

// ── Domains ───────────────────────────────────────────────────────────────────

export async function listDomains(): Promise<Domain[]> {
  const h = await authHeaders()
  const r = await fetch('/api/console/domains', { headers: h })
  if (!r.ok) throw makeError(`list_domains failed: ${r.status}`, r.status)
  const data = await r.json() as { domains: Domain[] }
  return data.domains
}

export async function createDomain(origin: string): Promise<CreateDomainResult> {
  const h = await jsonHeaders()
  const r = await fetch('/api/console/domains', {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ origin }),
  })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError('create_domain failed', r.status, code)
  }
  return r.json() as Promise<CreateDomainResult>
}

export async function verifyDomain(
  id: number,
  method: 'dns_txt' | 'well_known',
): Promise<VerifyDomainResult> {
  const h = await jsonHeaders()
  const r = await fetch(`/api/console/domains/${id}/verify`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ method }),
  })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError(`verify_domain failed: ${r.status}`, r.status, code)
  }
  return r.json() as Promise<VerifyDomainResult>
}

export async function deleteDomain(id: number): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/console/domains/${id}`, { method: 'DELETE', headers: h })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError(`delete_domain failed: ${r.status}`, r.status, code)
  }
}

// ── Owner account (email verification) ──────────────────────────────────────────

export interface OwnerAccount {
  email: string | null
  email_verified: boolean
  email_required?: boolean   // UI must force the email step before anything else
}

export async function getAccount(): Promise<OwnerAccount> {
  const h = await authHeaders()
  const r = await fetch('/api/console/account', { headers: h })
  if (!r.ok) throw makeError(`get_account failed: ${r.status}`, r.status)
  return r.json() as Promise<OwnerAccount>
}

export async function registerEmail(email: string): Promise<{ ok: boolean; email: string; sent: boolean }> {
  const h = await jsonHeaders()
  const r = await fetch('/api/console/account/register', {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ email }),
  })
  if (!r.ok) {
    const code = await extractCode(r)
    throw makeError('register_email failed', r.status, code)
  }
  return r.json() as Promise<{ ok: boolean; email: string; sent: boolean }>
}

// ── Super-admin: owner-account moderation (403 unless caller is super_admin) ─────

export interface OwnerRow {
  did: string
  email: string | null
  email_verified: boolean
  suspended: boolean
  suspended_reason: string | null
  admin_note: string | null  // super-admin private note
  key_count: number
  labels: string[]           // names of the owner's active keys
  origins: string[]          // sites this owner connected (allowed_origins of active keys)
  usage_this_month: number
}

/** Returns the owner list, or throws (status 403) if the caller is not super_admin. */
export async function listOwners(): Promise<OwnerRow[]> {
  const h = await authHeaders()
  const r = await fetch('/api/admin/owners', { headers: h })
  if (!r.ok) throw makeError(`list_owners failed: ${r.status}`, r.status)
  const data = await r.json() as { owners: OwnerRow[] }
  return data.owners
}

export async function suspendOwner(did: string, reason: string): Promise<void> {
  const h = await jsonHeaders()
  const r = await fetch(`/api/admin/owners/${encodeURIComponent(did)}/suspend`, {
    method: 'POST', headers: h, body: JSON.stringify({ reason }),
  })
  if (!r.ok) { const code = await extractCode(r); throw makeError('suspend failed', r.status, code) }
}

export async function unsuspendOwner(did: string): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/admin/owners/${encodeURIComponent(did)}/unsuspend`, {
    method: 'POST', headers: h,
  })
  if (!r.ok) { const code = await extractCode(r); throw makeError('unsuspend failed', r.status, code) }
}

export async function editOwner(did: string, patch: { email?: string; admin_note?: string }): Promise<void> {
  const h = await jsonHeaders()
  const r = await fetch(`/api/admin/owners/${encodeURIComponent(did)}`, {
    method: 'PATCH', headers: h, body: JSON.stringify(patch),
  })
  if (!r.ok) { const code = await extractCode(r); throw makeError('edit owner failed', r.status, code) }
}

export async function deleteOwner(did: string): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/admin/owners/${encodeURIComponent(did)}`, { method: 'DELETE', headers: h })
  if (!r.ok) { const code = await extractCode(r); throw makeError('delete owner failed', r.status, code) }
}

export async function messageOwner(
  did: string, kind: 'message' | 'warning' | 'proposal', subject: string, body: string,
): Promise<{ sent: boolean }> {
  const h = await jsonHeaders()
  const r = await fetch(`/api/admin/owners/${encodeURIComponent(did)}/message`, {
    method: 'POST', headers: h, body: JSON.stringify({ kind, subject, body }),
  })
  if (!r.ok) { const code = await extractCode(r); throw makeError('message owner failed', r.status, code) }
  return r.json() as Promise<{ sent: boolean }>
}
