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
  usage_this_month: number
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
