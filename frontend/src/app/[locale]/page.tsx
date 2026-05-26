'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import HumanBadge from '@/components/HumanBadge'

const CARD_IDS = ['gesture', 'ai', 'did', 'aptos', 'privacy', 'bond'] as const
const CARD_ICONS: Record<string, string> = {
  gesture: '✍️', ai: '🧠', did: '🔑', aptos: '⛓️', privacy: '🛡️', bond: '🤝',
}
const CARD_BG: Record<string, string> = {
  gesture: '#7c3aed', ai: '#db2777', did: '#0891b2', aptos: '#2563eb', privacy: '#059669', bond: '#d97706',
}
const STEP_KEYS = ['s01', 's02', 's03', 's04'] as const
const STEP_ICONS = ['✍️', '🧠', '🔑', '⛓️']
const STEP_BG = ['#7c3aed', '#db2777', '#0891b2', '#2563eb']

type CardId = typeof CARD_IDS[number]

export default function Home() {
  const t = useTranslations('home')
  const [modal, setModal] = useState<CardId | null>(null)

  const cards = CARD_IDS.map(id => ({
    id,
    icon: CARD_ICONS[id],
    bg: CARD_BG[id],
    title: t(`cards.${id}.title`),
    subtitle: t(`cards.${id}.subtitle`),
    modal: {
      title: t(`cards.${id}.modal_title`),
      body: t(`cards.${id}.modal_body`),
    },
  }))

  const steps = STEP_KEYS.map((key, i) => ({
    n: `0${i + 1}`,
    icon: STEP_ICONS[i],
    bg: STEP_BG[i],
    title: t(`steps.${key}.title`),
    desc: t(`steps.${key}.desc`),
  }))

  const activeCard = modal ? cards.find(c => c.id === modal) : null

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #ede9fe 0%, #f0f9ff 60%, #fdf4ff 100%)', padding: '80px 24px 60px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 400, height: 400, borderRadius: '50%', background: 'rgba(124,58,237,0.08)', filter: 'blur(80px)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <HumanBadge state="verified"   size={32} title="Verified Human" />
              <HumanBadge state="unverified" size={32} title="Not Verified" />
              <HumanBadge state="pending"    size={32} title="Pending" />
              <HumanBadge state="revoked"    size={32} title="Bot/Revoked" />
            </div>
            <span style={{ fontSize: 11, letterSpacing: '0.25em', fontWeight: 700, color: '#7c3aed', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 99, padding: '6px 16px', textTransform: 'uppercase' }}>
              {t('badge')}
            </span>
          </div>
          <h1 style={{ fontSize: 'clamp(3rem,11vw,6rem)', fontWeight: 900, lineHeight: 1, marginBottom: 20, letterSpacing: '-0.02em' }}>
            <span style={{ color: '#111827' }}>APT</span>
            <span style={{ color: '#0891b2' }}>O</span>
            <span style={{ background: 'linear-gradient(90deg,#7c3aed,#db2777)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>GON</span>
          </h1>
          <p style={{ fontSize: 'clamp(1.1rem,3vw,1.5rem)', fontWeight: 600, color: '#1e293b', marginBottom: 12 }}>{t('headline')}</p>
          <p style={{ fontSize: '1.05rem', color: '#64748b', marginBottom: 36, maxWidth: 500, margin: '0 auto 36px' }}>
            {t('subheadline')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28 }}>
            <Link href="/verify" style={{ padding: '14px 36px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '1.05rem', borderRadius: 14, textDecoration: 'none', boxShadow: '0 6px 24px rgba(124,58,237,0.3)' }}>
              {t('cta_verify')}
            </Link>
            <Link href="/chat" style={{ padding: '14px 28px', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '1.05rem', borderRadius: 14, textDecoration: 'none', border: '1.5px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              {t('cta_chat')}
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#manifest" style={{ color: '#7c3aed', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none' }}>📜 {t('manifest_card.title')}</a>
            <a href="#developers" style={{ color: '#0891b2', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none' }}>⚡ {t('developers_card.title')}</a>
            <a href="#donate" style={{ color: '#059669', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none' }}>🤝 {t('donate_card.title')}</a>
          </div>
        </div>
      </section>

      {/* ── КАРТОЧКИ ТЕХНОЛОГИЙ ── */}
      <section style={{ padding: '64px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.6rem', color: '#111827', marginBottom: 8 }}>{t('tech_title')}</p>
          <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: 40 }}>{t('tech_subtitle')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {cards.map(card => (
              <button
                key={card.id}
                onClick={() => setModal(card.id)}
                style={{ background: card.bg, border: 'none', borderRadius: 20, padding: '28px 16px 24px', cursor: 'pointer', textAlign: 'center', color: '#fff', transition: 'transform 0.15s, box-shadow 0.15s', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 12px 28px rgba(0,0,0,0.18)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)' }}
              >
                <div style={{ fontSize: 36, marginBottom: 10 }}>{card.icon}</div>
                <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>{card.title}</div>
                <div style={{ fontSize: 11, opacity: 0.75, fontWeight: 500 }}>{card.subtitle}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── КАК РАБОТАЕТ ── */}
      <section style={{ padding: '64px 24px', background: '#f1f5f9' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <p style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.6rem', color: '#111827', marginBottom: 8 }}>{t('how_title')}</p>
          <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: 40 }}>{t('how_subtitle')}</p>

          <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', flexWrap: 'nowrap', overflowX: 'auto' }}>
            {steps.map((s, i) => (
              <div key={s.n} style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 180 }}>
                <div style={{ background: s.bg, borderRadius: 20, padding: '28px 20px', color: '#fff', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{s.icon}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 6 }}>{t('step')} {s.n}</div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 8 }}>{s.title}</div>
                  <p style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
                </div>
                {i < steps.length - 1 && (
                  <div style={{ padding: '0 8px', color: '#94a3b8', fontSize: 20, fontWeight: 900, flexShrink: 0, display: 'flex', alignItems: 'center' }}>→</div>
                )}
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Link href="/verify" style={{ display: 'inline-block', padding: '14px 40px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', fontWeight: 700, fontSize: '1rem', borderRadius: 14, textDecoration: 'none' }}>
              {t('cta_verify')} →
            </Link>
          </div>
        </div>
      </section>

      {/* ── MANIFEST / DEVELOPERS / DONATE ── */}
      <section id="manifest" style={{ padding: '72px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.6rem', color: '#111827', marginBottom: 8 }}>{t('join_title')}</p>
          <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: 40 }}>{t('join_subtitle')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20 }}>
            <Link href="/manifest" style={{ textDecoration: 'none', display: 'flex', borderRadius: 22, overflow: 'hidden', boxShadow: '0 4px 20px rgba(124,58,237,0.15)' }}>
              <div style={{ background: 'linear-gradient(145deg, #0f172a, #1e1b4b)', padding: '36px 28px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📜</div>
                <div style={{ fontWeight: 900, fontSize: '1.3rem', color: '#fff', marginBottom: 8 }}>{t('manifest_card.title')}</div>
                <p style={{ fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: 0, flex: 1 }}>{t('manifest_card.body')}</p>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 20, display: 'block' }}>{t('manifest_card.cta')}</span>
              </div>
            </Link>

            <Link id="developers" href="/developers" style={{ textDecoration: 'none', display: 'flex', borderRadius: 22, overflow: 'hidden', boxShadow: '0 4px 20px rgba(8,145,178,0.15)' }}>
              <div style={{ background: 'linear-gradient(145deg, #0c1a2e, #0a2540)', padding: '36px 28px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
                <div style={{ fontWeight: 900, fontSize: '1.3rem', color: '#fff', marginBottom: 8 }}>{t('developers_card.title')}</div>
                <p style={{ fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: 0, flex: 1 }}>{t('developers_card.body')}</p>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#67e8f9', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 20, display: 'block' }}>{t('developers_card.cta')}</span>
              </div>
            </Link>

            <Link id="donate" href="/donate" style={{ textDecoration: 'none', display: 'flex', borderRadius: 22, overflow: 'hidden', boxShadow: '0 4px 20px rgba(124,58,237,0.1)' }}>
              <div style={{ background: 'linear-gradient(145deg, #2d1b69, #4c1d95)', padding: '36px 28px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🤝</div>
                <div style={{ fontWeight: 900, fontSize: '1.3rem', color: '#fff', marginBottom: 8 }}>{t('donate_card.title')}</div>
                <p style={{ fontSize: '0.875rem', color: '#c4b5fd', lineHeight: 1.6, marginBottom: 0, flex: 1 }}>{t('donate_card.body')}</p>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#e9d5ff', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 20, display: 'block' }}>{t('donate_card.cta')}</span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ── МОДАЛЬНОЕ ОКНО ── */}
      {activeCard && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setModal(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 24, padding: '36px 32px', maxWidth: 480, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.2)', position: 'relative' }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setModal(null)}
              style={{ position: 'absolute', top: 16, right: 16, background: '#f1f5f9', border: 'none', borderRadius: 99, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >✕</button>

            <div style={{ width: 56, height: 56, borderRadius: 16, background: activeCard.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 20 }}>
              {activeCard.icon}
            </div>
            <h2 style={{ fontWeight: 800, fontSize: '1.3rem', color: '#111827', marginBottom: 12 }}>{activeCard.modal.title}</h2>
            <p style={{ color: '#4b5563', lineHeight: 1.7, fontSize: '0.95rem' }}>{activeCard.modal.body}</p>
          </div>
        </div>
      )}
    </div>
  )
}
