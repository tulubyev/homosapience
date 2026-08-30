/**
 * alertsApi.ts — R1-D4 typed fetch wrappers for alert endpoints.
 * Auth is handled by authHeaders() from sessionAuth (JWT or X-APTOGON-DID fallback).
 */
import { authHeaders } from '@/lib/sessionAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertStatus   = 'active' | 'acknowledged' | 'escalated' | 'resolved'

export interface Alert {
  id: number
  ts: number
  owner_did: string
  api_key_pk: string | null
  severity: AlertSeverity
  level: 1 | 2 | 3
  event_type: string
  detail: Record<string, unknown>
  status: AlertStatus
  resolved_at: number | null
  resolved_by: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function jsonHeaders(): Promise<Record<string, string>> {
  const h = await authHeaders()
  return { ...h, 'Content-Type': 'application/json' }
}

// ── Console (org-owner) ───────────────────────────────────────────────────────

export async function listAlerts(status?: AlertStatus): Promise<Alert[]> {
  const h = await authHeaders()
  const qs = status ? `?status=${status}` : ''
  const r = await fetch(`/api/console/alerts${qs}`, { headers: h })
  if (!r.ok) throw new Error(`list_alerts failed: ${r.status}`)
  const data = await r.json() as { alerts: Alert[] }
  return data.alerts
}

export async function countUnread(): Promise<number> {
  const h = await authHeaders()
  const r = await fetch('/api/console/alerts/unread', { headers: h })
  if (!r.ok) return 0
  const data = await r.json() as { count: number }
  return data.count
}

export async function acknowledgeAlert(id: number): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/console/alerts/${id}/acknowledge`, { method: 'POST', headers: h })
  if (!r.ok) throw new Error(`acknowledge_alert failed: ${r.status}`)
}

export async function escalateAlert(id: number, comment: string): Promise<void> {
  const h = await jsonHeaders()
  const r = await fetch(`/api/console/alerts/${id}/escalate`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ comment }),
  })
  if (!r.ok) throw new Error(`escalate_alert failed: ${r.status}`)
}

export async function freezeKeyAlert(id: number): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/console/alerts/${id}/freeze-key`, { method: 'POST', headers: h })
  if (!r.ok) throw new Error(`freeze_key_alert failed: ${r.status}`)
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface AdminAlertFilters {
  level?: 1 | 2 | 3
  severity?: AlertSeverity
  status?: AlertStatus
  owner_did?: string
  limit?: number
}

export async function adminListAlerts(filters: AdminAlertFilters = {}): Promise<Alert[]> {
  const h = await authHeaders()
  const params = new URLSearchParams()
  if (filters.level   != null)  params.set('level',     String(filters.level))
  if (filters.severity)         params.set('severity',  filters.severity)
  if (filters.status)           params.set('status',    filters.status)
  if (filters.owner_did)        params.set('owner_did', filters.owner_did)
  if (filters.limit   != null)  params.set('limit',     String(filters.limit))
  const qs = params.toString() ? `?${params}` : ''
  const r = await fetch(`/api/admin/alerts${qs}`, { headers: h })
  if (!r.ok) throw new Error(`admin_list_alerts failed: ${r.status}`)
  const data = await r.json() as { alerts: Alert[] }
  return data.alerts
}

export async function adminResolveAlert(id: number): Promise<void> {
  const h = await authHeaders()
  const r = await fetch(`/api/admin/alerts/${id}/resolve`, { method: 'POST', headers: h })
  if (!r.ok) throw new Error(`admin_resolve_alert failed: ${r.status}`)
}
