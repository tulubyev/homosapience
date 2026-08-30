'use client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

const STEP_ICONS = ['💼', '✍️', '⛓️', '🗳️']
const STEP_COLORS = ['#059669', '#7c3aed', '#2563eb', '#059669']
const USE_CASE_ICONS = ['🗳️', '🎁', '💰', '🏆']

const NAV_LINKS = [
  { href: '/solutions/surveys', icon: '📊' },
  { href: '/solutions/communities', icon: '👥' },
  { href: '/solutions/ai-labeling', icon: '🤖' },
]

type StatItem = { stat: string; label: string; src: string }
type StepItem = { title: string; desc: string }
type UseCaseItem = { title: string; desc: string }
type CompareColumn = { name: string; items: string[] }
type NavLabel = { label: string }

export default function Web3Page() {
  const t = useTranslations('solutions_web3')

  const problems = t.raw('problems.items') as StatItem[]
  const steps = t.raw('how_it_works.steps') as StepItem[]
  const useCases = t.raw('use_cases.items') as UseCaseItem[]
  const compareColumns = t.raw('vs_worldcoin.columns') as CompareColumn[]
  const badges = t.raw('cta.badges') as string[]
  const navLabels = t.raw('nav.links') as NavLabel[]

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #022c22 0%, #065f46 100%)', padding: '72px 24px 56px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(5,150,105,0.25)', border: '1px solid rgba(110,231,183,0.4)', borderRadius: 99, padding: '6px 16px', marginBottom: 28 }}>
            <span style={{ fontSize: 14 }}>🔗</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6ee7b7', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{t('hero.eyebrow')}</span>
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.8rem)', fontWeight: 900, color: '#f1f5f9', lineHeight: 1.2, margin: '0 0 18px', letterSpacing: '-0.02em' }}>
            {t('hero.title_line1')}<br />{t('hero.title_line2')}
          </h1>
          <p style={{ fontSize: '1.05rem', color: '#94a3b8', lineHeight: 1.65, maxWidth: 520, margin: '0 auto 32px' }}>
            {t('hero.subtitle')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '13px 32px', background: 'linear-gradient(135deg,#059669,#0891b2)', color: '#fff', fontWeight: 700, fontSize: '0.95rem', borderRadius: 12, textDecoration: 'none', boxShadow: '0 6px 24px rgba(5,150,105,0.4)' }}>
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
                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#059669', marginBottom: 6 }}>{p.stat}</div>
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

      {/* ── USE CASES ── */}
      <section style={{ padding: '60px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#111827', marginBottom: 6 }}>{t('use_cases.title')}</h2>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.95rem', marginBottom: 36 }}>
            {t('use_cases.subtitle')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {useCases.map((u, i) => (
              <div key={u.title} style={{ background: '#f0fdf4', border: '1px solid #6ee7b7', borderTop: '3px solid #059669', borderRadius: 14, padding: '22px 18px' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{USE_CASE_ICONS[i]}</div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#111827', marginBottom: 6 }}>{u.title}</div>
                <p style={{ fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.55, margin: 0 }}>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VS WORLDCOIN ── */}
      <section style={{ padding: '60px 24px', background: '#022c22' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#f1f5f9', marginBottom: 16 }}>{t('vs_worldcoin.title')}</h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem', marginBottom: 28 }}>{t('vs_worldcoin.subtitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {compareColumns.map((col, ci) => (
              <div key={col.name} style={{ background: ci === 1 ? 'rgba(5,150,105,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${ci === 1 ? 'rgba(110,231,183,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, padding: '20px 16px' }}>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: ci === 1 ? '#6ee7b7' : '#94a3b8', marginBottom: 14 }}>{col.name}</div>
                {col.items.map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                    <span style={{ color: ci === 1 ? '#6ee7b7' : '#64748b', fontSize: 13, marginTop: 1 }}>{ci === 1 ? '✓' : '·'}</span>
                    <span style={{ fontSize: '0.8rem', color: ci === 1 ? '#d1fae5' : '#64748b', lineHeight: 1.4 }}>{item}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SMART CONTRACT INTEGRATION ── */}
      <section style={{ padding: '60px 24px', background: '#0f172a' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.5rem', color: '#f1f5f9', marginBottom: 6 }}>{t('smart_contract.title')}</h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.95rem', marginBottom: 32 }}>
            {t('smart_contract.subtitle')}
          </p>
          <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', padding: '24px 22px', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.7, overflowX: 'auto' }}>
            <div style={{ color: '#64748b' }}>// {t('smart_contract.comment_module')}</div>
            <div><span style={{ color: '#a78bfa' }}>public</span> <span style={{ color: '#7c3aed' }}>fun</span> <span style={{ color: '#67e8f9' }}>cast_vote</span>(voter: &signer, proposal_id: u64) {'{'}
            </div>
            <div style={{ paddingInlineStart: 20, color: '#94a3b8' }}>
              <span style={{ color: '#64748b' }}>// {t('smart_contract.comment_verify')}</span><br />
              <span style={{ color: '#a78bfa' }}>let</span> addr = signer::address_of(voter);<br />
              <span style={{ color: '#a78bfa' }}>assert!</span>(<br />
              <span style={{ paddingInlineStart: 20 }}></span>human_firewall::is_verified(addr),<br />
              <span style={{ paddingInlineStart: 20 }}></span><span style={{ color: '#86efac' }}>E_NOT_VERIFIED_HUMAN</span><br />
              );<br />
              <span style={{ color: '#64748b' }}>// {t('smart_contract.comment_record')}</span><br />
              governance::record_vote(addr, proposal_id);
            </div>
            <div style={{ color: '#94a3b8' }}>{'}'}
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <Link href="/developers" style={{ padding: '12px 28px', background: 'rgba(5,150,105,0.2)', color: '#6ee7b7', fontWeight: 700, fontSize: '0.9rem', borderRadius: 10, textDecoration: 'none', border: '1px solid rgba(110,231,183,0.3)' }}>
              {t('smart_contract.full_docs')} →
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '64px 24px', background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontWeight: 900, fontSize: '1.8rem', color: '#111827', marginBottom: 12 }}>{t('cta.title')}</h2>
          <p style={{ color: '#6b7280', fontSize: '1rem', lineHeight: 1.6, marginBottom: 32 }}>
            {t('cta.desc')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/verify" style={{ padding: '14px 36px', background: 'linear-gradient(135deg,#059669,#0891b2)', color: '#fff', fontWeight: 700, fontSize: '1rem', borderRadius: 14, textDecoration: 'none', boxShadow: '0 6px 24px rgba(5,150,105,0.3)' }}>
              {t('cta.start_free')} →
            </Link>
            <Link href="/pricing" style={{ padding: '14px 28px', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '1rem', borderRadius: 14, textDecoration: 'none', border: '1.5px solid #e2e8f0' }}>
              {t('cta.view_pricing')}
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
            {badges.map(f => (
              <span key={f} style={{ fontSize: '0.82rem', color: '#059669', fontWeight: 600 }}>✓ {f}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── NAV ── */}
      <div style={{ background: '#fff', borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{t('nav.other_verticals')}</span>
          {NAV_LINKS.map((l, i) => (
            <Link key={l.href} href={l.href} style={{ fontSize: '0.8rem', color: '#059669', textDecoration: 'none', fontWeight: 600 }}>{l.icon} {navLabels[i].label}</Link>
          ))}
        </div>
      </div>
    </div>
  )
}
