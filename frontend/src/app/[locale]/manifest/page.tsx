import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

export default async function ManifestPage() {
  const t = await getTranslations('manifest')

  const apps = t.raw('apps') as Array<{ icon: string; title: string; desc: string }>
  const tiers = t.raw('tiers') as Array<{ title: string; sub: string; icon: string }>
  const s2Steps = t.raw('s2_steps') as string[]
  const tierColors = ['#059669', '#2563eb', '#7c3aed', '#d97706']

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)', padding: '72px 24px 60px', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.25em', color: '#7c3aed', textTransform: 'uppercase', marginBottom: 16 }}>
          {t('hero_label')}
        </p>
        <h1 style={{ fontSize: 'clamp(2rem,6vw,3.5rem)', fontWeight: 900, color: '#fff', marginBottom: 16, lineHeight: 1.1 }}>
          Homo Sapience<br />
          <span style={{ background: 'linear-gradient(90deg,#a78bfa,#67e8f9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Manifest
          </span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.05rem', maxWidth: 500, margin: '0 auto' }}>
          {t('hero_subtitle')}
        </p>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '64px 24px' }}>

        {/* Section 1: Problem */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ width: 4, height: 40, background: 'linear-gradient(180deg,#7c3aed,#06b6d4)', borderRadius: 4, flexShrink: 0 }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#e2e8f0' }}>{t('s1_title')}</h2>
          </div>
          <div style={{ color: '#94a3b8', lineHeight: 1.85, fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ color: '#cbd5e1', fontWeight: 500 }}>{t('s1_p1')}</p>
            <p>{t('s1_p2')}</p>
            <p>{t('s1_p3')}</p>
          </div>
        </section>

        {/* Section 2: Solution */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ width: 4, height: 40, background: 'linear-gradient(180deg,#06b6d4,#7c3aed)', borderRadius: 4, flexShrink: 0 }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#e2e8f0' }}>{t('s2_title')}</h2>
          </div>
          <div style={{ color: '#94a3b8', lineHeight: 1.85, fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p>{t('s2_p1')}</p>
            <p>{t('s2_p2')}</p>
            <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 16, padding: '20px 24px' }}>
              <p style={{ color: '#c4b5fd', fontWeight: 700, marginBottom: 12 }}>{t('s2_how_label')}</p>
              <ol style={{ paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 8, color: '#94a3b8' }}>
                {s2Steps.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </div>
          </div>
        </section>

        {/* Section 3: Applications */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ width: 4, height: 40, background: 'linear-gradient(180deg,#059669,#0891b2)', borderRadius: 4, flexShrink: 0 }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#e2e8f0' }}>{t('s3_title')}</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {apps.map(item => (
              <div key={item.title} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '20px 22px', display: 'flex', gap: 16 }}>
                <span style={{ fontSize: 28, flexShrink: 0 }}>{item.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{item.title}</div>
                  <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.65, margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 4: Monetisation */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ width: 4, height: 40, background: 'linear-gradient(180deg,#d97706,#7c3aed)', borderRadius: 4, flexShrink: 0 }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#e2e8f0' }}>{t('s4_title')}</h2>
          </div>
          <div style={{ color: '#94a3b8', lineHeight: 1.85, fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p>{t('s4_p1')}</p>
            <style>{`@media (max-width: 640px){.tier-grid{display:none !important}}`}</style>
            <div className="tier-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              {tiers.map((tier, i) => (
                <div key={tier.title} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '14px 12px', border: `1px solid ${tierColors[i]}30` }}>
                  <span style={{ fontSize: 22 }}>{tier.icon}</span>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1.25, color: tierColors[i], marginTop: 8 }}>{tier.title}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.3, marginTop: 2 }}>{tier.sub}</div>
                </div>
              ))}
            </div>
            <p>{t('s4_p2')}</p>
          </div>
        </section>

        {/* Section 5: Community */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ width: 4, height: 40, background: 'linear-gradient(180deg,#db2777,#7c3aed)', borderRadius: 4, flexShrink: 0 }} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#e2e8f0' }}>{t('s5_title')}</h2>
          </div>
          <div style={{ color: '#94a3b8', lineHeight: 1.85, fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p>{t('s5_p1')}</p>
            <p><strong style={{ color: '#f9a8d4' }}>Verified Human badge</strong> — {t('s5_p2')}</p>
            <p>{t('s5_p3')}</p>
          </div>
        </section>

        {/* Quote + CTA */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 40, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '1.1rem', fontStyle: 'italic', marginBottom: 32 }}>
            {t('quote')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, borderRadius: 12, textDecoration: 'none' }}>
              {t('cta_verify')}
            </Link>
            <a href="https://t.me/aptogon" target="_blank" rel="noopener noreferrer"
              style={{ padding: '12px 28px', background: '#0088cc', color: '#fff', fontWeight: 700, borderRadius: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.1 13.67 5.12 12.77c-.663-.207-.676-.663.136-.983l10.86-4.188c.549-.2 1.03.134.778.622z" fill="#fff"/>
              </svg>
              {t('cta_telegram')}
            </a>
            <Link href="/developers"
              style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', fontWeight: 600, borderRadius: 12, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.1)' }}>
              {t('cta_developers')}
            </Link>
            <Link href="/" style={{ padding: '12px 28px', background: 'transparent', color: '#64748b', fontWeight: 600, borderRadius: 12, textDecoration: 'none' }}>
              {t('cta_home')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
