import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'

type HowItem = { title: string; desc: string }

export default async function GonkaInfraPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'solutions_gonka' })

  const missionBullets = t.raw('missionBullets') as string[]
  const howItems = t.raw('howItems') as HowItem[]
  const securityBullets = t.raw('securityBullets') as string[]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: '64px 24px 48px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 99, padding: '5px 16px', marginBottom: 24, fontSize: 11, fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {t('eyebrow')}
          </div>
          <h1 style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.25, margin: '0 0 16px' }}>
            {t('title')}
          </h1>
          <p style={{ fontSize: '1.02rem', color: '#94a3b8', lineHeight: 1.65, maxWidth: 520, margin: '0 auto' }}>
            {t('subtitle')}
          </p>
        </div>
      </section>

      {/* ── NAME ── */}
      <section style={{ padding: '48px 24px', background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.25rem', color: '#111827', marginBottom: 10 }}>{t('nameTitle')}</h2>
          <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.65 }}>{t('nameBody')}</p>
        </div>
      </section>

      {/* ── MISSION ── */}
      <section style={{ padding: '48px 24px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.25rem', color: '#111827', marginBottom: 14 }}>{t('missionTitle')}</h2>
          <p style={{ color: '#6b7280', fontSize: '0.92rem', lineHeight: 1.7, marginBottom: 24 }}>{t('missionBody')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {missionBullets.map(b => (
              <div key={b} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', fontSize: '0.85rem', fontWeight: 600, color: '#374151', lineHeight: 1.4 }}>
                {b}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '48px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.25rem', color: '#111827', marginBottom: 28 }}>{t('howTitle')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            {howItems.map((s, i) => (
              <div key={s.title} style={{ background: '#f8fafc', borderRadius: 14, border: '1px solid #e5e7eb', padding: '20px 18px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 12, insetInlineEnd: 14, fontSize: 11, fontWeight: 800, color: '#d1d5db' }}>0{i + 1}</div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#7c3aed', marginBottom: 6 }}>{s.title}</div>
                <p style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.55, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECURITY ── */}
      <section style={{ padding: '48px 24px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.25rem', color: '#111827', marginBottom: 20 }}>{t('securityTitle')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {securityBullets.map(b => (
              <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' }}>
                <span style={{ color: '#7c3aed', fontSize: 14, marginTop: 1 }}>✓</span>
                <span style={{ fontSize: '0.87rem', color: '#374151', lineHeight: 1.5 }}>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COST ── */}
      <section style={{ padding: '48px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.25rem', color: '#111827', marginBottom: 10 }}>{t('costTitle')}</h2>
          <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.7 }}>{t('costBody')}</p>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section style={{ padding: '48px 24px', background: 'linear-gradient(135deg, #ede9fe 0%, #ecfeff 100%)' }}>
        <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', lineHeight: 1.65, marginBottom: 28 }}>{t('closing')}</p>
          <Link href="/solutions" style={{ display: 'inline-block', padding: '13px 28px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '0.9rem', borderRadius: 12, textDecoration: 'none' }}>
            {t('backCta')}
          </Link>
        </div>
      </section>

      {/* ── SOURCE ── */}
      <div style={{ background: '#fff', borderTop: '1px solid #f1f5f9', padding: '16px 24px', textAlign: 'center' }}>
        <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
          {t('sourceLabel')}: <a href="https://joingonka.ai/ru/knowledge/what-is-gonka/" target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed', textDecoration: 'none' }}>{t('sourceText')}</a>
        </span>
      </div>
    </div>
  )
}
