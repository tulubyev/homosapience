import { Link } from '@/i18n/navigation'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getPost, POSTS, type ContentBlock } from '../posts'

export function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }))
}

function renderBlock(block: ContentBlock, color: string, idx: number) {
  switch (block.type) {
    case 'h2':
      return (
        <h2 key={idx} style={{ fontSize: '1.3rem', fontWeight: 800, color: '#111827', margin: '36px 0 14px', lineHeight: 1.35 }}>
          {block.text}
        </h2>
      )
    case 'h3':
      return (
        <h3 key={idx} style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1f2937', margin: '24px 0 10px' }}>
          {block.text}
        </h3>
      )
    case 'p':
      return (
        <p key={idx} style={{ fontSize: '1rem', color: '#374151', lineHeight: 1.8, margin: '0 0 18px' }}>
          {block.text}
        </p>
      )
    case 'ul':
      return (
        <ul key={idx} style={{ margin: '0 0 18px', paddingInlineStart: 24 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ fontSize: '1rem', color: '#374151', lineHeight: 1.75, marginBottom: 8 }}>{item}</li>
          ))}
        </ul>
      )
    case 'quote':
      return (
        <blockquote key={idx} style={{ margin: '24px 0', padding: '16px 20px', borderLeft: `4px solid ${color}`, background: `${color}08`, borderRadius: '0 10px 10px 0' }}>
          <p style={{ fontSize: '1rem', color: '#374151', lineHeight: 1.75, margin: 0, fontStyle: 'italic' }}>{block.text}</p>
          {block.author && <cite style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: 8, display: 'block' }}>— {block.author}</cite>}
        </blockquote>
      )
    case 'callout':
      return (
        <div key={idx} style={{ margin: '24px 0', padding: '16px 20px', background: `${color}12`, border: `1px solid ${color}35`, borderRadius: 12 }}>
          <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: 1.7, margin: 0, fontWeight: 500 }}>{block.text}</p>
        </div>
      )
    case 'code':
      return (
        <div key={idx} style={{ margin: '24px 0' }}>
          <div style={{ background: '#0f172a', borderRadius: 12, overflow: 'hidden' }}>
            {block.lang && (
              <div style={{ padding: '8px 16px', background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {block.lang}
              </div>
            )}
            <pre style={{ margin: 0, padding: '16px 20px', fontSize: '0.85rem', color: '#e2e8f0', lineHeight: 1.65, overflowX: 'auto', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
              <code>{block.text}</code>
            </pre>
          </div>
        </div>
      )
    case 'table':
      return (
        <div key={idx} style={{ margin: '24px 0', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {block.headers.map((h, i) => (
                  <th key={i} style={{ padding: '10px 14px', textAlign: 'start', fontWeight: 700, color: '#374151', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid #f1f5f9', background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '10px 14px', color: '#4b5563', lineHeight: 1.5, fontWeight: ci === 0 ? 600 : 400 }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'divider':
      return <hr key={idx} style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '32px 0' }} />
    case 'link':
      return (
        <a key={idx} href={block.href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', margin: '4px 0 20px', fontSize: '0.95rem', fontWeight: 700, color, textDecoration: 'none' }}>
          {block.text}
        </a>
      )
    default:
      return null
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params
  const post = getPost(slug)
  if (!post) notFound()
  const t = await getTranslations({ locale, namespace: 'blog' })

  const otherPosts = POSTS.filter(p => p.slug !== post.slug)

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: `linear-gradient(135deg, #0f172a 0%, #1a1a2e 100%)`, padding: '52px 24px 44px', borderBottom: `3px solid ${post.color}` }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/blog" style={{ fontSize: '0.78rem', color: '#64748b', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
              ← {t('post.back')}
            </Link>
            <span style={{ color: '#334155', fontSize: 12 }}>·</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: post.color, background: `${post.color}20`, border: `1px solid ${post.color}40`, borderRadius: 99, padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {post.category}
            </span>
          </div>
          <h1 style={{ fontSize: 'clamp(1.5rem,4vw,2.1rem)', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.25, margin: '0 0 16px' }}>
            {post.title}
          </h1>
          <p style={{ fontSize: '1.05rem', color: '#94a3b8', lineHeight: 1.6, margin: '0 0 20px', maxWidth: 580 }}>
            {post.subtitle}
          </p>
          <div style={{ fontSize: '0.8rem', color: '#475569' }}>
            {post.date} · {post.readingTime} {t('post.read_suffix')}
          </div>
        </div>
      </section>

      {/* ── CONTENT ── */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 64px' }}>
        <article style={{ background: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', padding: 'clamp(24px, 5vw, 44px)' }}>
          {post.content.map((block, idx) => renderBlock(block, post.color, idx))}
        </article>

        {/* ── CTA ── */}
        <div style={{ marginTop: 32, background: `linear-gradient(135deg, ${post.color}15 0%, ${post.color}08 100%)`, border: `1px solid ${post.color}30`, borderRadius: 18, padding: '28px 24px', textAlign: 'center' }}>
          <h3 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#111827', margin: '0 0 8px' }}>
            {t('post.cta.title')}
          </h3>
          <p style={{ fontSize: '0.88rem', color: '#6b7280', margin: '0 0 18px' }}>
            {t('post.cta.desc')}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '10px 24px', background: post.color, color: '#fff', fontWeight: 700, fontSize: '0.88rem', borderRadius: 10, textDecoration: 'none' }}>
              {t('post.cta.get_started')} →
            </Link>
            <Link href="/api-reference" style={{ padding: '10px 18px', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '0.88rem', borderRadius: 10, textDecoration: 'none', border: '1.5px solid #e2e8f0' }}>
              {t('post.cta.api_docs')}
            </Link>
          </div>
        </div>

        {/* ── MORE ARTICLES ── */}
        {otherPosts.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontWeight: 800, fontSize: '1rem', color: '#374151', marginBottom: 16 }}>{t('post.more_articles')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {otherPosts.map(p => (
                <Link key={p.slug} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderTop: `3px solid ${p.color}`, borderRadius: 14, padding: '18px 16px', gap: 8 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: p.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{p.category}</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#111827', lineHeight: 1.35 }}>{p.title}</span>
                  <span style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 'auto' }}>{p.readingTime} {t('post.read_suffix')}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
