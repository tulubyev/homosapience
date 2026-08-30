import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { POSTS } from './posts'

export default async function BlogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'blog' })

  const featured = POSTS[0]
  const rest = POSTS.slice(1)

  const seriesColors: Record<string, string> = {
    'The Bot Problem': '#7c3aed',
    'APTOGON vs.': '#0891b2',
    'How It Works': '#059669',
    'Developer Guide': '#d97706',
  }

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '56px 24px 44px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(129,140,248,0.35)', borderRadius: 99, padding: '4px 14px', marginBottom: 20, fontSize: 11, fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {t('eyebrow')}
          </div>
          <h1 style={{ fontSize: 'clamp(1.7rem,4vw,2.4rem)', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.2, margin: '0 0 12px' }}>
            {t('hero.title')}
          </h1>
          <p style={{ fontSize: '1rem', color: '#94a3b8', lineHeight: 1.65, maxWidth: 520 }}>
            {t('hero.subtitle')}
          </p>
        </div>
      </section>

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 64px' }}>

        {/* ── FEATURED ── */}
        <Link href={`/blog/${featured.slug}`} style={{ textDecoration: 'none', display: 'block', marginBottom: 32 }}>
          <article style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: `4px solid ${featured.color}`, borderRadius: 18, padding: '32px 28px', transition: 'box-shadow 0.15s' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: featured.color, background: `${featured.color}18`, border: `1px solid ${featured.color}40`, borderRadius: 99, padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {featured.category}
              </span>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                {featured.date} · {featured.readingTime} {t('post.read_suffix')}
              </span>
            </div>
            <h2 style={{ fontSize: 'clamp(1.2rem,3vw,1.6rem)', fontWeight: 900, color: '#111827', lineHeight: 1.3, margin: '0 0 12px' }}>
              {featured.title}
            </h2>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: 1.65, margin: '0 0 20px', maxWidth: 580 }}>
              {featured.subtitle}
            </p>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: featured.color }}>{t('card.read_more')} →</span>
          </article>
        </Link>

        {/* ── REST ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {rest.map(post => (
            <Link key={post.slug} href={`/blog/${post.slug}`} style={{ textDecoration: 'none' }}>
              <article style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: `3px solid ${post.color}`, borderRadius: 16, padding: '24px 20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: post.color, background: `${post.color}18`, border: `1px solid ${post.color}40`, borderRadius: 99, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {post.category}
                  </span>
                </div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#111827', lineHeight: 1.35, margin: '0 0 10px', flex: 1 }}>
                  {post.title}
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.55, margin: '0 0 16px' }}>
                  {post.subtitle.slice(0, 120)}…
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{post.date} · {post.readingTime}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: post.color }}>{t('card.read')} →</span>
                </div>
              </article>
            </Link>
          ))}
        </div>

        {/* ── SERIES INDEX ── */}
        <div style={{ marginTop: 48, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: '28px 24px' }}>
          <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#111827', margin: '0 0 20px' }}>{t('series.title')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {Object.entries(seriesColors).map(([name, color]) => {
              const count = POSTS.filter(p => p.series === name).length
              return (
                <div key={name} style={{ background: `${color}10`, border: `1px solid ${color}30`, borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{t('series.count', { count })}</div>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
