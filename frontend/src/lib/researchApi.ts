import { authHeaders } from '@/lib/sessionAuth'

export type AccessLevel = 'basic' | 'standard' | 'full'

export interface DataRequest {
  id: number
  did_short: string
  name: string
  company: string
  email: string
  phone: string | null
  suggested_level: AccessLevel
  granted_level: AccessLevel | null
  status: 'pending' | 'approved' | 'denied'
  reason: string | null
  created_at: number
}

export interface SignalCount { signal: string; count: number }

export interface DataPackage {
  level: AccessLevel
  period_days: number
  totals: { sessions: number; humans: number; bots: number; ai_agents: number; suspicious: number; blocked: number }
  by_day?: Array<{ day: string; sessions: number; humans: number; bots: number; ai_agents: number; suspicious: number; blocked: number }>
  signals?: SignalCount[]
}

export interface DataAccessState {
  available: boolean
  request: DataRequest | null
  package?: DataPackage
}

export async function submitDataRequest(
  fields: { name: string; company: string; email: string; phone?: string },
): Promise<{ status: string; suggested_level: AccessLevel }> {
  const h = await authHeaders()
  const r = await fetch('/api/research/data-request', {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!r.ok) throw new Error(`submit_data_request failed: ${r.status}`)
  return r.json()
}

export async function getDataAccess(): Promise<DataAccessState> {
  const r = await fetch('/api/console/data-access', { headers: await authHeaders() })
  if (!r.ok) throw new Error(`get_data_access failed: ${r.status}`)
  return r.json()
}

export async function adminListDataRequests(status?: string): Promise<{ requests: DataRequest[] }> {
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  const r = await fetch(`/api/admin/data-requests${q}`, { headers: await authHeaders() })
  if (!r.ok) throw new Error(`list_data_requests failed: ${r.status}`)
  return r.json()
}

export async function adminDecideDataRequest(
  id: number, decision: { status: 'approved' | 'denied'; level?: AccessLevel; reason?: string },
): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/admin/data-requests/${id}/decide`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  })
  if (!r.ok) throw new Error(`decide_data_request failed: ${r.status}`)
}
