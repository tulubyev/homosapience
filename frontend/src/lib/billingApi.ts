import { authHeaders } from '@/lib/sessionAuth'

export interface OwnerPlan {
  plan: string
  label: string
  monthly_cap: number | null   // null = unlimited
  used_this_month: number
}

export interface PlanDef { plan: string; label: string; monthly_cap: number | null }

export interface OwnerPlanRow {
  owner_did: string
  plan: string
  label: string
  monthly_cap: number | null
  updated_at: number
}

export async function getPlan(): Promise<OwnerPlan> {
  const r = await fetch('/api/console/plan', { headers: await authHeaders() })
  if (!r.ok) throw new Error(`get_plan failed: ${r.status}`)
  return r.json()
}

export async function adminListOwnerPlans(): Promise<{ owner_plans: OwnerPlanRow[]; plans: PlanDef[] }> {
  const r = await fetch('/api/admin/owner-plans', { headers: await authHeaders() })
  if (!r.ok) throw new Error(`list_owner_plans failed: ${r.status}`)
  return r.json()
}

export async function adminSetOwnerPlan(ownerDid: string, plan: string): Promise<void> {
  const h = await authHeaders()
  const r = await fetch('/api/admin/owner-plan', {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_did: ownerDid, plan }),
  })
  if (!r.ok) throw new Error(`set_owner_plan failed: ${r.status}`)
}
