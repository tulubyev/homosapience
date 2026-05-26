import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import CryptoWallets from '@/components/CryptoWallets'

const DONATE_STYLES = `
  @media (max-width: 640px) {
    .tiers-grid { grid-template-columns: repeat(2, 1fr) !important; }
  }
  @media (max-width: 400px) {
    .tiers-grid { grid-template-columns: 1fr !important; }
  }
`

export default async function DonatePage() {
  const t = await getTranslations('donate')
  const locale = await getLocale()

  const funds = t.raw('funds') as Array<{ icon: string; title: string; desc: string; pct: number }>
  const tiers = t.raw('tiers') as Array<{ amount: string; label: string; desc: string; icon: string }>

  const tierStyles = [
    { color: '#d97706', bg: '#fffbeb' },
    { color: '#059669', bg: '#f0fdf4' },
    { color: '#7c3aed', bg: '#faf5ff' },
    { color: '#1d4ed8', bg: '#eff6ff' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#faf5ff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{DONATE_STYLES}</style>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #2d1b69 0%, #4c1d95 100%)', padding: '72px 24px 60px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🤝</div>
        <h1 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, color: '#fff', marginBottom: 16 }}>
          {t('hero_title')}
        </h1>
        <p style={{ color: '#c4b5fd', fontSize: '1.05rem', maxWidth: 500, margin: '0 auto' }}>
          {t('hero_subtitle')}
        </p>
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '64px 24px' }}>

        {/* Where funds go */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#111827', marginBottom: 16 }}>{t('funds_title')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {funds.map(item => (
              <div key={item.title} style={{ background: '#fff', borderRadius: 16, padding: '18px 20px', border: '1px solid #e9d5ff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  <span style={{ fontWeight: 700, color: '#111827', flex: 1 }}>{item.title}</span>
                  <span style={{ fontWeight: 800, color: '#7c3aed', fontSize: '0.9rem' }}>{item.pct}%</span>
                </div>
                <div style={{ height: 4, background: '#f3e8ff', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 99, width: `${item.pct}%` }} />
                </div>
                <p style={{ fontSize: '0.85rem', color: '#9ca3af', margin: 0 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Support tiers */}
        <section style={{ marginBottom: 48 }}>

          {/* 3-column grid: row1 = $5/$20/$100 · row2 = $500 + Venture Partner (span 2) */}
          <div className="tiers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, alignItems: 'stretch' }}>

            {/* Tier cards — equal height, clickable → /payment */}
            {tiers.map((tier, i) => (
              <Link key={tier.amount} href={`/${locale}/payment`} style={{
                borderRadius: 20, border: `2px solid ${tierStyles[i].color}25`,
                background: tierStyles[i].bg,
                padding: '24px 18px', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textDecoration: 'none', cursor: 'pointer',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>{tier.icon}</div>
                <div style={{ fontWeight: 900, fontSize: '1.5rem', color: tierStyles[i].color, marginBottom: 2 }}>{tier.amount}</div>
                <div style={{ fontWeight: 700, color: '#111827', marginBottom: 6, fontSize: '0.9rem' }}>{tier.label}</div>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af', lineHeight: 1.4, flex: 1 }}>{tier.desc}</div>
                <div style={{
                  marginTop: 12, padding: '7px 0', borderRadius: 10, width: '100%',
                  background: `${tierStyles[i].color}15`,
                  color: tierStyles[i].color, fontWeight: 700, fontSize: '0.78rem',
                }}>
                  Support →
                </div>
              </Link>
            ))}

            {/* Venture Partner — spans 2 columns, English text */}
            <a
              href="mailto:donate@homosapience.org?subject=Venture Partner"
              style={{
                gridColumn: 'span 2',
                borderRadius: 20,
                background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 60%, #2d1b69 100%)',
                border: '2px solid rgba(167,139,250,0.3)',
                boxShadow: '0 6px 24px rgba(124,58,237,0.25)',
                padding: '24px 28px', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 24,
              }}
            >
              <div style={{ fontSize: 40, flexShrink: 0 }}>💎</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 4 }}>
                  Venture Partner
                </div>
                <div style={{ fontWeight: 900, fontSize: '1.6rem', color: '#fff', lineHeight: 1, marginBottom: 10 }}>
                  from $5,000
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '4px 20px' }}>
                  {[
                    'HSI tokens at launch',
                    'Seat on tech council',
                    'Direct roadmap access',
                    'Co-branding on site',
                  ].map(b => (
                    <li key={b} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: '#c4b5fd' }}>
                      <span style={{ color: '#a78bfa', fontWeight: 800 }}>✦</span> {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div style={{
                flexShrink: 0,
                background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
                color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                padding: '12px 24px', borderRadius: 14,
                boxShadow: '0 3px 10px rgba(124,58,237,0.4)', whiteSpace: 'nowrap',
              }}>
                Discuss terms →
              </div>
            </a>

          </div>
        </section>



        <CryptoWallets />

        {/* Contact */}
        <section style={{ background: 'linear-gradient(135deg,#2d1b69,#4c1d95)', borderRadius: 22, padding: '36px 32px', textAlign: 'center' }}>
          <h3 style={{ color: '#fff', fontWeight: 900, fontSize: '1.2rem', marginBottom: 10 }}>{t('contact_title')}</h3>
          <p style={{ color: '#c4b5fd', marginBottom: 24, fontSize: '0.95rem' }}>{t('contact_desc')}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="https://t.me/aptogon" target="_blank" rel="noopener noreferrer"
              style={{ padding: '12px 28px', background: '#fff', color: '#0088cc', fontWeight: 700, borderRadius: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0088cc" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L6.22 13.628l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.928.931z"/>
              </svg>
              Telegram @aptogon
            </a>
            <a href="mailto:donate@homosapience.org"
              style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.1)', color: '#c4b5fd', fontWeight: 700, borderRadius: 12, textDecoration: 'none' }}>
              📩 donate@homosapience.org
            </a>
            <Link href="/"
              style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.05)', color: '#c4b5fd', fontWeight: 600, borderRadius: 12, textDecoration: 'none' }}>
              {t('cta_home')}
            </Link>
          </div>
        </section>

      </div>
    </div>
  )
}
