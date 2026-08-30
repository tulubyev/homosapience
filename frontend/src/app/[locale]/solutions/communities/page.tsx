'use client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

const STEP_STYLES = [
  { icon: '🔗', color: '#0891b2' },
  { icon: '✍️', color: '#7c3aed' },
  { icon: '🔑', color: '#059669' },
  { icon: '🛡️', color: '#db2777' },
]

const FEATURE_ICONS = ['🤝', '🔐', '⛓️']

const NAV_LINKS = [
  { href: '/solutions/surveys', icon: '📊' },
  { href: '/solutions/ai-labeling', icon: '🤖' },
  { href: '/solutions/web3', icon: '🔗' },
]

type StatItem = { stat: string; label: string; src: string }
type StepItem = { title: string; desc: string }
type VsRow = { name: string; res: string; verdict: 'good' | 'bad' }
type FeatureItem = { title: string; desc: string }
type NavLabel = { label: string }

export default function CommunitiesPage() {
  const t = useTranslations('solutions_communities')

  const problems = t.raw('problems.items') as StatItem[]
  const steps = t.raw('how_it_works.steps') as StepItem[]
  const vs = t.raw('vs.rows') as VsRow[]
  const features = t.raw('differentiator.features') as FeatureItem[]
  const navLabels = t.raw('nav.links') as NavLabel[]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #0c1a2e 0%, #0a2540 100%)', padding: '72px 24px 56px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(8,145,178,0.2)', border: '1px solid rgba(103,232,249,0.3)', borderRadius: 99, padding: '6px 16px', marginBottom: 28 }}>
            <span style={{ fontSize: 14 }}>👥</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#67e8f9', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{t('hero.eyebrow')}</span>
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.8rem)', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.2, margin: '0 0 18px', letterSpacing: '-0.02em' }}>
            {t('hero.title')}
          </h1>
          <p style={{ fontSize: '1.05rem', color: '#94a3b8', lineHeight: 1.65, maxWidth: 520, margin: '0 auto 32px' }}>
            {t('hero.subtitle')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '13px 32px', background: 'linear-gradient(135deg,#0891b2,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '0.95rem', borderRadius: 12, textDecoration: 'none', boxShadow: '0 6px 24px rgba(8,145,178,0.35)' }}>
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
                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0891b2', marginBottom: 6 }}>{p.stat}</div>
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
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${STEP_STYLES[i].color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 12 }}>{STEP_STYLES[i].icon}</div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#111827', marginBottom: 6 }}>{s.title}</div>
                <p style={{ fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.55, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VS ── */}
      <section style={{ padding: '60px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#111827', marginBottom: 6 }}>{t('vs.title')}</h2>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.95rem', marginBottom: 28 }}>{t('vs.subtitle')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {vs.map(r => (
              <div key={r.name} style={{
                background: r.verdict === 'good' ? '#ecfeff' : '#f8fafc',
                border: `1px solid ${r.verdict === 'good' ? '#a5f3fc' : '#e5e7eb'}`,
                borderInlineStart: `3px solid ${r.verdict === 'good' ? '#0891b2' : '#e5e7eb'}`,
                borderRadius: 10, padding: '14px 18px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
              }}>
                <span style={{ fontWeight: 800, fontSize: '0.9rem', color: r.verdict === 'good' ? '#0891b2' : '#111827', minWidth: 160 }}>{r.name}</span>
                <span style={{ fontSize: '0.82rem', color: r.verdict === 'good' ? '#155e75' : '#6b7280', flex: 1 }}>{r.res}</span>
                <span style={{ fontSize: 18 }}>{r.verdict === 'good' ? '✓' : '✗'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DIFFERENTIATOR ── */}
      <section style={{ padding: '60px 24px', background: '#0c1a2e' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.5rem', color: '#f1f5f9', marginBottom: 16 }}>{t('differentiator.title')}</h2>
          <p style={{ fontSize: '0.95rem', color: '#94a3b8', lineHeight: 1.7, marginBottom: 28 }}>
            {t('differentiator.body')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {features.map((f, i) => (
              <div key={f.title} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '18px 14px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{FEATURE_ICONS[i]}</div>
                <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#e2e8f0', marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '64px 24px', background: 'linear-gradient(135deg, #ecfeff 0%, #f0f9ff 100%)', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.8rem', color: '#111827', marginBottom: 12 }}>{t('cta.title')}</h2>
          <p style={{ color: '#6b7280', fontSize: '1rem', lineHeight: 1.6, marginBottom: 32 }}>
            {t('cta.desc')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '14px 36px', background: 'linear-gradient(135deg,#0891b2,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '1rem', borderRadius: 14, textDecoration: 'none', boxShadow: '0 6px 24px rgba(8,145,178,0.3)' }}>
              {t('cta.start_free')} →
            </Link>
            <Link href="/pricing" style={{ padding: '14px 28px', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '1rem', borderRadius: 14, textDecoration: 'none', border: '1.5px solid #e2e8f0' }}>
              {t('cta.view_pricing')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── NAV ── */}
      <div style={{ background: '#fff', borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{t('nav.other_verticals')}</span>
          {NAV_LINKS.map((l, i) => (
            <Link key={l.href} href={l.href} style={{ fontSize: '0.8rem', color: '#0891b2', textDecoration: 'none', fontWeight: 600 }}>{l.icon} {navLabels[i].label}</Link>
          ))}
        </div>
      </div>
    </div>
  )
}
