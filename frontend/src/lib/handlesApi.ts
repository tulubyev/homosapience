/**
 * Handles API wrappers — typed fetch calls for /api/handles/* and /badge/*
 * Auth is handled by aptogonHeaders() from sessionAuth (JWT or X-APTOGON-DID fallback).
 */
import { aptogonHeaders } from '@/lib/sessionAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Handle {
  platform:    string
  username_lc: string
  created_at:  number
}

export interface BadgeInfo {
  verified:     boolean
  did?:         string
  trust_score?: number
  trust_label?: string
  claimed_at?:  number
  valid_until?:  number
  expired?:     boolean
}

// ── Handle management ─────────────────────────────────────────────────────────

export async function declareHandle(platform: string, username: string): Promise<{ ok: boolean }> {
  const r = await fetch('/api/handles', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...aptogonHeaders() },
    body:    JSON.stringify({ platform, username }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function listHandles(): Promise<Handle[]> {
  const r = await fetch('/api/handles', { headers: aptogonHeaders() })
  if (!r.ok) return []
  const data = await r.json()
  return data.handles ?? []
}

export async function deleteHandle(platform: string, username: string): Promise<void> {
  const r = await fetch(`/api/handles/${platform}/${username}`, {
    method:  'DELETE',
    headers: aptogonHeaders(),
  })
  if (!r.ok) throw new Error(await r.text())
}

// ── Badge info ────────────────────────────────────────────────────────────────

export async function getBadgeInfo(platform: string, username: string): Promise<BadgeInfo> {
  const r = await fetch(`/badge/${platform}/${username}/info`)
  if (!r.ok) return { verified: false }
  return r.json()
}

export function badgeImageUrl(platform: string, username: string): string {
  return `https://homosapience.org/badge/${platform}/${username}.svg`
}

export function badgeMarkdown(platform: string, username: string): string {
  const img = badgeImageUrl(platform, username)
  const link = `https://homosapience.org/h/${platform}/${username}`
  return `[![✦ Human Verified](${img})](${link})`
}
