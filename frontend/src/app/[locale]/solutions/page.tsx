import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

const VERTICAL_STYLES = [
  { icon: '📊', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', href: '/solutions/surveys' },
  { icon: '👥', color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc', href: '/solutions/communities' },
  { icon: '🤖', color: '#db2777', bg: '#fdf2f8', border: '#f9a8d4', href: '/solutions/ai-labeling' },
  { icon: '🔗', color: '#059669', bg: '#f0fdf4', border: '#6ee7b7', href: '/solutions/web3' },
]

type Vertical = { title: string; headline: string; desc: string; stats: { n: string; l: string }[] }

export default async function SolutionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'solutions' })
  const gonkaBullets = t.raw('gonka.bullets') as string[]
  const verticals = t.raw('verticals') as Vertical[]
  const agentsStats = t.raw('agents.stats') as { n: string; l: string }[]
  const guaranteeChips = t.raw('common_guarantee.chips') as { icon: string; label: string }[]

  const agentsCard = {
    icon: '🔑',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    href: '/agent-passport',
    title: t('agents.title'),
    headline: t('agents.headline'),
    desc: t('agents.desc'),
    stats: agentsStats,
  }

  const verticalCards = verticals.map((v, i) => ({ ...v, ...VERTICAL_STYLES[i] }))

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: '64px 24px 48px', textAlign: 'center' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 99, padding: '5px 16px', marginBottom: 24, fontSize: 11, fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {t('hero.eyebrow')}
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.2, margin: '0 0 16px' }}>
            {t('hero.title')}
          </h1>
          <p style={{ fontSize: '1.05rem', color: '#94a3b8', lineHeight: 1.65, maxWidth: 480, margin: '0 auto' }}>
            {t('hero.subtitle')}
          </p>
        </div>
      </section>

      {/* ── 4 VERTICALS ── */}
      <section style={{ padding: '48px 24px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 20 }}>
          {[...verticalCards, agentsCard].map(v => (
            <Link key={v.href} href={v.href} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${v.border}`, borderTop: `3px solid ${v.color}`, borderRadius: 18, padding: '28px 24px', transition: 'box-shadow 0.15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: v.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>{v.icon}</div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: v.color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{v.title}</div>
                  <div style={{ fontWeight: 900, fontSize: '1rem', color: '#111827', lineHeight: 1.25 }}>{v.headline}</div>
                </div>
              </div>
              <p style={{ fontSize: '0.88rem', color: '#6b7280', lineHeight: 1.6, margin: '0 0 18px', flex: 1 }}>{v.desc}</p>
              <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
                {v.stats.map(s => (
                  <div key={s.n}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: v.color }}>{s.n}</div>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af', lineHeight: 1.3 }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: v.color }}>{t('see_solution')} →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── GONKA / INFRASTRUCTURE TRUST ── */}
      <section style={{ padding: '48px 24px', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-block', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 99, padding: '4px 14px', marginBottom: 16, fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {t('gonka.eyebrow')}
          </div>
          <h2 style={{ fontWeight: 900, fontSize: '1.4rem', color: '#111827', marginBottom: 12, lineHeight: 1.3 }}>{t('gonka.title')}</h2>
          <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.65, marginBottom: 24 }}>{t('gonka.body')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            {gonkaBullets.map(b => (
              <div key={b} style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', fontSize: '0.82rem', fontWeight: 600, color: '#374151', lineHeight: 1.35 }}>
                {b}
              </div>
            ))}
          </div>
          <Link href="/solutions/gonka" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#7c3aed', textDecoration: 'none' }}>
            {t('gonka.cta')}
          </Link>
        </div>
      </section>

      {/* ── COMMON GUARANTEE ── */}
      <section style={{ padding: '48px 24px', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.4rem', color: '#111827', marginBottom: 8 }}>{t('common_guarantee.title')}</h2>
          <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 32 }}>
            {t('common_guarantee.desc')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            {[...guaranteeChips, { icon: '🎭', label: t('deepfake_chip') }].map(f => (
              <div key={f.label} style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{f.icon}</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', lineHeight: 1.35 }}>{f.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '56px 24px', background: 'linear-gradient(135deg, #ede9fe 0%, #ecfeff 100%)', textAlign: 'center' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.7rem', color: '#111827', marginBottom: 12 }}>{t('cta_section.title')}</h2>
          <p style={{ color: '#6b7280', fontSize: '1rem', lineHeight: 1.6, marginBottom: 28 }}>
            {t('cta_section.desc')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '13px 32px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '0.95rem', borderRadius: 12, textDecoration: 'none' }}>
              {t('cta_section.start_free')} →
            </Link>
            <Link href="/pricing" style={{ padding: '13px 24px', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '0.95rem', borderRadius: 12, textDecoration: 'none', border: '1.5px solid #e2e8f0' }}>
              {t('cta_section.view_pricing')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
