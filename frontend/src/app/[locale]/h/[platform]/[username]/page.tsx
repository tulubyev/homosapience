'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { getBadgeInfo, badgeMarkdown, type BadgeInfo } from '@/lib/handlesApi'

const PLATFORM_LABELS: Record<string, string> = {
  github:        'GitHub',
  reddit:        'Reddit',
  x:             'X / Twitter',
  hackernews:    'Hacker News',
  discord:       'Discord',
  telegram:      'Telegram',
  instagram:     'Instagram',
  substack:      'Substack',
  youtube:       'YouTube',
  linkedin:      'LinkedIn',
  stackoverflow: 'Stack Overflow',
  habr:          'Habr',
  gitlab:        'GitLab',
  bluesky:       'Bluesky',
  twitch:        'Twitch',
  medium:        'Medium',
  tiktok:        'TikTok',
  notion:        'Notion',
}

export default function HumanProofPage({
  params,
}: {
  params: { platform: string; username: string }
}) {
  const locale    = useLocale()
  const [info,    setInfo]    = useState<BadgeInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied,  setCopied]  = useState(false)

  const { platform, username } = params
  const platformLabel = PLATFORM_LABELS[platform] ?? platform

  useEffect(() => {
    getBadgeInfo(platform, username)
      .then(d => { setInfo(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [platform, username])

  const copyMarkdown = () => {
    const md = badgeMarkdown(platform, username)
    navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const svgUrl = `/badge/${platform}/${username}.svg`
  const md     = badgeMarkdown(platform, username)

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✦</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#0f172a' }}>
            Human Verification
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b' }}>
            {platformLabel} · <strong>{username}</strong>
          </p>
        </div>

        {/* Status card */}
        <div style={{
          background:   '#fff',
          borderRadius: 20,
          border:       `2px solid ${loading ? '#e2e8f0' : info?.verified ? '#22c55e' : '#f43f5e'}`,
          padding:      24,
          marginBottom: 20,
          boxShadow:    '0 4px 24px rgba(0,0,0,0.05)',
        }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0' }}>
              Checking verification…
            </div>
          )}

          {!loading && info?.verified && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                  ✅
                </div>
                <div>
                  <div style={{ fontWeight: 800, color: '#15803d', fontSize: 17 }}>Verified Human</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>HSI HumanCredential · active</div>
                </div>
              </div>
              <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '12px 14px', fontSize: 12, color: '#166534' }}>
                <div style={{ marginBottom: 4 }}>🏷 Trust: <strong>{info.trust_label}</strong> ({Math.round((info.trust_score ?? 0) * 100)}%)</div>
                <div style={{ marginBottom: 4 }}>🔑 DID: <code style={{ fontSize: 11 }}>{info.did?.slice(0, 20)}…{info.did?.slice(-8)}</code></div>
                <div>📅 Claimed: {info.claimed_at ? new Date(info.claimed_at * 1000).toLocaleDateString() : '—'}</div>
              </div>
            </>
          )}

          {!loading && !info?.verified && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>❌</div>
              <div style={{ fontWeight: 700, color: '#be123c', fontSize: 16 }}>Not verified</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
                {info?.expired
                  ? 'Credential expired — re-verification needed.'
                  : 'No HumanCredential found for this handle.'}
              </div>
            </div>
          )}
        </div>

        {/* Badge embed section — only when verified */}
        {info?.verified && (
          <div style={{ background: '#fff', borderRadius: 20, border: '2px solid #e2e8f0', padding: 20, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>Embed this badge</div>
            {/* Preview */}
            <div style={{ marginBottom: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svgUrl} alt="Human Verified badge" />
            </div>
            {/* Markdown snippet */}
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: '#334155', wordBreak: 'break-all', marginBottom: 10 }}>
              {md}
            </div>
            <button
              onClick={copyMarkdown}
              style={{
                width:      '100%',
                padding:    '10px 0',
                borderRadius: 10,
                border:     '1px solid #e2e8f0',
                background: copied ? '#22c55e' : '#f8fafc',
                color:      copied ? '#fff' : '#334155',
                fontWeight: 700,
                cursor:     'pointer',
                fontSize:   13,
                transition: 'all 0.2s',
              }}
            >
              {copied ? '✓ Copied!' : '📋 Copy Markdown'}
            </button>
          </div>
        )}

        {/* CTA */}
        <div style={{ textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>
          <Link href={`/${locale}/verify`} style={{ color: '#7c3aed', fontWeight: 700, textDecoration: 'none' }}>
            Get your own ✦ Human badge →
          </Link>
        </div>
      </div>
    </div>
  )
}
