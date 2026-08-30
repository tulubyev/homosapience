'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

const STEP_ICONS = ['🔗', '✍️', '🔑', '⛓️']
const STEP_COLORS = ['#7c3aed', '#0891b2', '#059669', '#2563eb']

const NAV_LINKS = [
  { href: '/solutions/communities', icon: '👥' },
  { href: '/solutions/ai-labeling', icon: '🤖' },
  { href: '/solutions/web3', icon: '🔗' },
]

type StepItem = { title: string; desc: string }
type StatItem = { stat: string; label: string; src: string }
type CompareRow = { name: string; fraud: string; privacy: string; cost: string; verdict: 'good' | 'partial' | 'bad' }
type NavLabel = { label: string }

function RoiCalc({ t }: { t: ReturnType<typeof useTranslations> }) {
  const [volume, setVolume]   = useState(50000)
  const [fraud,  setFraud]    = useState(20)
  const [reward, setReward]   = useState(5)

  const fraudResponses  = Math.round(volume * fraud / 100)
  const incentiveLost   = fraudResponses * reward
  const aptogonCost     = volume <= 1000 ? 0 : volume <= 10000 ? volume * 0.05 : volume <= 100000 ? volume * 0.03 : volume * 0.01
  const netSaving       = incentiveLost - aptogonCost

  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n}`

  const sliders = [
    { label: t('roi.sliders.volume'), min: 1000, max: 1000000, step: 1000, val: volume, set: setVolume, fmt: (v: number) => v.toLocaleString() },
    { label: t('roi.sliders.fraud'), min: 1, max: 60, step: 1, val: fraud, set: setFraud, fmt: (v: number) => `${v}%` },
    { label: t('roi.sliders.reward'), min: 1, max: 50, step: 1, val: reward, set: setReward, fmt: (v: number) => `$${v}` },
  ]

  const outputs = [
    { label: t('roi.outputs.lost'), val: incentiveLost, color: '#dc2626', bg: '#fef2f2' },
    { label: t('roi.outputs.cost'), val: aptogonCost, color: '#d97706', bg: '#fffbeb' },
    { label: t('roi.outputs.net'), val: netSaving, color: netSaving >= 0 ? '#16a34a' : '#dc2626', bg: netSaving >= 0 ? '#f0fdf4' : '#fef2f2' },
  ]

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: '28px 24px' }}>
      <p style={{ fontWeight: 800, fontSize: '1rem', color: '#111827', marginBottom: 20 }}>{t('roi.title')}</p>

      {sliders.map(s => (
        <div key={s.label} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>{s.label}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#7c3aed' }}>{s.fmt(s.val)}</span>
          </div>
          <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
            onChange={e => s.set(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#7c3aed' }} />
        </div>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 8 }}>
        {outputs.map(r => (
          <div key={r.label} style={{ background: r.bg, borderRadius: 10, padding: '14px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 900, color: r.color }}>{fmt(Math.abs(r.val))}{r.val < 0 && r.label === t('roi.outputs.net') ? ` ${t('roi.loss_suffix')}` : ''}</div>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 4, lineHeight: 1.3 }}>{r.label}</div>
          </div>
        ))}
      </div>
      {aptogonCost === 0 && (
        <p style={{ fontSize: 12, color: '#059669', marginTop: 10, fontWeight: 600 }}>✓ {t('roi.free_tier_note')}</p>
      )}
    </div>
  )
}

export default function SurveysPage() {
  const t = useTranslations('solutions_surveys')

  const steps = t.raw('how_it_works.steps') as StepItem[]
  const problems = t.raw('problems.items') as StatItem[]
  const compareRows = t.raw('roi.compare_rows') as CompareRow[]
  const navLabels = t.raw('nav.links') as NavLabel[]
  const ctaBadges = t.raw('cta.badges') as string[]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: '72px 24px 56px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 99, padding: '6px 16px', marginBottom: 28 }}>
            <span style={{ fontSize: 14 }}>📊</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{t('hero.eyebrow')}</span>
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.8rem)', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.2, margin: '0 0 18px', letterSpacing: '-0.02em' }}>
            {t('hero.title_line1')}<br />{t('hero.title_line2')}
          </h1>
          <p style={{ fontSize: '1.05rem', color: '#94a3b8', lineHeight: 1.65, maxWidth: 520, margin: '0 auto 32px' }}>
            {t('hero.subtitle')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '13px 32px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '0.95rem', borderRadius: 12, textDecoration: 'none', boxShadow: '0 6px 24px rgba(124,58,237,0.35)' }}>
              {t('hero.cta_try')} →
            </Link>
            <Link href="/developers" style={{ padding: '13px 24px', background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem', borderRadius: 12, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.15)' }}>
              {t('hero.cta_api')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── THE PROBLEM ── */}
      <section style={{ padding: '60px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#111827', marginBottom: 6 }}>{t('problems.title')}</h2>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.95rem', marginBottom: 36 }}>
            {t('problems.subtitle')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
            {problems.map(p => (
              <div key={p.stat} style={{ background: '#f8fafc', borderRadius: 14, border: '1px solid #e5e7eb', padding: '20px 16px' }}>
                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#7c3aed', marginBottom: 6 }}>{p.stat}</div>
                <div style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.5, marginBottom: 6 }}>{p.label}</div>
                <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{p.src}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '60px 24px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#111827', marginBottom: 6 }}>{t('how_it_works.title')}</h2>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.95rem', marginBottom: 36 }}>
            {t('how_it_works.subtitle')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
            {steps.map((s, i) => (
              <div key={s.title} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '22px 18px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 12, insetInlineEnd: 14, fontSize: 11, fontWeight: 800, color: '#d1d5db' }}>0{i + 1}</div>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${STEP_COLORS[i]}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 12 }}>{STEP_ICONS[i]}</div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#111827', marginBottom: 6 }}>{s.title}</div>
                <p style={{ fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.55, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ROI + COMPARISON ── */}
      <section style={{ padding: '60px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#111827', marginBottom: 6 }}>{t('roi.section_title')}</h2>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.95rem', marginBottom: 36 }}>
            {t('roi.section_subtitle')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
            <RoiCalc t={t} />

            <div>
              <p style={{ fontWeight: 800, fontSize: '1rem', color: '#111827', marginBottom: 16 }}>{t('roi.compare_title')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {compareRows.map(r => (
                  <div key={r.name} style={{
                    background: r.verdict === 'good' ? '#f5f3ff' : '#f8fafc',
                    border: `1px solid ${r.verdict === 'good' ? '#ddd6fe' : '#e5e7eb'}`,
                    borderInlineStart: `3px solid ${r.verdict === 'good' ? '#7c3aed' : r.verdict === 'partial' ? '#d97706' : '#e5e7eb'}`,
                    borderRadius: 10, padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: '0.85rem', color: r.verdict === 'good' ? '#7c3aed' : '#111827' }}>{r.name}</span>
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{r.cost}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: r.verdict === 'good' ? '#5b21b6' : '#6b7280' }}>{r.fraud}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── API SNIPPET ── */}
      <section style={{ padding: '60px 24px', background: '#0f172a' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#f1f5f9', marginBottom: 6 }}>{t('api.title')}</h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.95rem', marginBottom: 32 }}>
            {t('api.subtitle')}
          </p>
          <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', padding: '24px 22px', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.7, overflowX: 'auto' }}>
            <div style={{ color: '#64748b' }}># {t('api.comment_verify')}</div>
            <div><span style={{ color: '#7c3aed' }}>POST</span> <span style={{ color: '#67e8f9' }}>https://aptogon.com/api/verify/check</span></div>
            <br />
            <div style={{ color: '#94a3b8' }}>{`{`}</div>
            <div style={{ paddingInlineStart: 20, color: '#94a3b8' }}>
              <span style={{ color: '#a78bfa' }}>&quot;token&quot;</span>: <span style={{ color: '#86efac' }}>&quot;&lt;token from widget&gt;&quot;</span>,<br />
              <span style={{ color: '#a78bfa' }}>&quot;survey_id&quot;</span>: <span style={{ color: '#86efac' }}>&quot;survey_abc123&quot;</span>,<br />
              <span style={{ color: '#a78bfa' }}>&quot;unique_scope&quot;</span>: <span style={{ color: '#86efac' }}>&quot;survey&quot;</span>
            </div>
            <div style={{ color: '#94a3b8' }}>{`}`}</div>
            <br />
            <div style={{ color: '#64748b' }}># {t('api.comment_response')}</div>
            <div style={{ color: '#94a3b8' }}>{`{`}</div>
            <div style={{ paddingInlineStart: 20, color: '#94a3b8' }}>
              <span style={{ color: '#a78bfa' }}>&quot;verified&quot;</span>: <span style={{ color: '#34d399' }}>true</span>,<br />
              <span style={{ color: '#a78bfa' }}>&quot;unique&quot;</span>: <span style={{ color: '#34d399' }}>true</span>,<span style={{ color: '#64748b' }}>  // {t('api.comment_false_note')}</span><br />
              <span style={{ color: '#a78bfa' }}>&quot;did&quot;</span>: <span style={{ color: '#86efac' }}>&quot;did:apt:0xbddd...&quot;</span>,<br />
              <span style={{ color: '#a78bfa' }}>&quot;onchain_tx&quot;</span>: <span style={{ color: '#86efac' }}>&quot;0x9ad9...&quot;</span>
            </div>
            <div style={{ color: '#94a3b8' }}>{`}`}</div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <Link href="/developers" style={{ padding: '12px 28px', background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', fontWeight: 700, fontSize: '0.9rem', borderRadius: 10, textDecoration: 'none', border: '1px solid rgba(167,139,250,0.3)' }}>
              {t('api.full_docs')} →
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '64px 24px', background: 'linear-gradient(135deg, #ede9fe 0%, #f0f9ff 100%)', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.8rem', color: '#111827', marginBottom: 12 }}>{t('cta.title')}</h2>
          <p style={{ color: '#6b7280', fontSize: '1rem', lineHeight: 1.6, marginBottom: 32 }}>
            {t('cta.desc')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '14px 36px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '1rem', borderRadius: 14, textDecoration: 'none', boxShadow: '0 6px 24px rgba(124,58,237,0.3)' }}>
              {t('cta.start_free')} →
            </Link>
            <Link href="/pricing" style={{ padding: '14px 28px', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '1rem', borderRadius: 14, textDecoration: 'none', border: '1.5px solid #e2e8f0' }}>
              {t('cta.view_pricing')}
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
            {ctaBadges.map(f => (
              <span key={f} style={{ fontSize: '0.82rem', color: '#7c3aed', fontWeight: 600 }}>✓ {f}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── BREADCRUMB NAV ── */}
      <div style={{ background: '#fff', borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{t('nav.other_verticals')}</span>
          {NAV_LINKS.map((l, i) => (
            <Link key={l.href} href={l.href} style={{ fontSize: '0.8rem', color: '#7c3aed', textDecoration: 'none', fontWeight: 600 }}>{l.icon} {navLabels[i].label}</Link>
          ))}
        </div>
      </div>

    </div>
  )
}
