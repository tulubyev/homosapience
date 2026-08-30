'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

// ── Static styling (non-translatable) for pricing tiers, zipped by index with translated content ──

const TIER_STYLES = [
  { color: '#64748b', accentBg: '#f8fafc', border: '#e2e8f0', ctaHref: '/developers', highlight: false },
  { color: '#0891b2', accentBg: '#f0f9ff', border: '#bae6fd', ctaHref: 'mailto:alt@in2sys.fr?subject=APTOGON Starter', highlight: false },
  { color: '#7c3aed', accentBg: '#faf5ff', border: '#c4b5fd', ctaHref: 'mailto:alt@in2sys.fr?subject=APTOGON Growth', highlight: true },
  { color: '#059669', accentBg: '#f0fdf4', border: '#bbf7d0', ctaHref: 'mailto:alt@in2sys.fr?subject=APTOGON Scale', highlight: false },
]

type Tier = { name: string; price: string; priceNote: string; volume: string; features: string[]; cta: string }
type RoiInput = { label: string }
type RoiOutput = { label: string }
type ComparisonRow = { label: string; apt: string; vfy: string; kyc: string }
type FaqItem = { q: string; a: string }

// ── ROI Calculator ────────────────────────────────────────────────────────────

function RoiCalc({ t }: { t: ReturnType<typeof useTranslations> }) {
  const [volume, setVolume] = useState(50000)
  const [fraudPct, setFraudPct] = useState(20)
  const [costPerUnit, setCostPerUnit] = useState(2)

  const kycCostPerCheck = 3  // average KYC
  const verifyCostPerCheck = 0.02  // VerifyYou mid-tier

  const fraudLoss = volume * (fraudPct / 100) * costPerUnit
  const aptogonPrice = volume <= 1000 ? 0 : volume <= 10000 ? 0.05 : volume <= 100000 ? 0.03 : 0.01
  const aptogonCost = volume * aptogonPrice
  const kycCost = volume * kycCostPerCheck
  const verifyCost = volume * verifyCostPerCheck

  const savingsVsKyc = kycCost - aptogonCost
  const savingsVsVerify = verifyCost - aptogonCost
  const fraudRecovery = fraudLoss - aptogonCost

  const fmt = (n: number) =>
    n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M`
    : n >= 1000 ? `$${(n / 1000).toFixed(1)}K`
    : `$${n.toFixed(0)}`

  const roiInputs = t.raw('roi.inputs') as RoiInput[]
  const roiOutputs = t.raw('roi.outputs') as RoiOutput[]

  const inputConfigs = [
    { value: volume, setter: setVolume, min: 1000, max: 1000000, step: 1000, unit: 'number' as const },
    { value: fraudPct, setter: setFraudPct, min: 1, max: 60, step: 1, unit: 'percent' as const },
    { value: costPerUnit, setter: setCostPerUnit, min: 0.1, max: 50, step: 0.1, unit: 'currency' as const },
  ]

  const outputConfigs = [
    { value: fraudLoss, color: '#dc2626', bg: '#fef2f2', border: 'rgba(220,38,38,0.2)' },
    { value: aptogonCost, color: '#7c3aed', bg: '#faf5ff', border: 'rgba(124,58,237,0.2)' },
    { value: savingsVsKyc, color: '#059669', bg: '#f0fdf4', border: 'rgba(5,150,105,0.2)' },
    { value: savingsVsVerify, color: '#0891b2', bg: '#f0f9ff', border: 'rgba(8,145,178,0.2)' },
  ]

  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid #e2e8f0', padding: '28px 28px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
      <h3 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 900, color: '#0f172a' }}>
        💰 {t('roi.title')}
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 18, marginBottom: 24 }}>
        {roiInputs.map((input, i) => {
          const cfg = inputConfigs[i]
          return (
            <div key={input.label}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                {input.label}
              </label>
              <input
                type="range" min={cfg.min} max={cfg.max} step={cfg.step} value={cfg.value}
                onChange={e => cfg.setter(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#7c3aed', marginBottom: 4 }}
              />
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                {cfg.unit === 'percent' ? `${cfg.value}%` : cfg.unit === 'currency' ? `$${cfg.value}` : cfg.value.toLocaleString()}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {roiOutputs.map((output, i) => {
          const cfg = outputConfigs[i]
          return (
            <div key={output.label} style={{ background: cfg.bg, borderRadius: 12, padding: '14px 16px', border: `1.5px solid ${cfg.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, lineHeight: 1.4 }}>{output.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: cfg.color }}>{fmt(cfg.value)}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{t('roi.per_month')}</div>
            </div>
          )
        })}
      </div>

      {fraudRecovery > 0 && (
        <div style={{ marginTop: 16, background: 'linear-gradient(135deg,#7c3aed,#059669)', borderRadius: 12, padding: '14px 18px', color: '#fff' }}>
          <strong>{t('roi.net_benefit_label')}: {fmt(fraudRecovery)}/{t('roi.month_abbr')}</strong>
          {' '}{t('roi.net_benefit_suffix')}
          {' '} = <strong>{fmt(fraudRecovery * 12)}/{t('roi.year_abbr')}</strong>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const locale = useLocale()
  const t = useTranslations('pricing')
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const tiers = t.raw('tiers') as Tier[]
  const badges = t.raw('hero.badges') as string[]
  const comparisonRows = t.raw('comparison.rows') as ComparisonRow[]
  const faqs = t.raw('faq.items') as FaqItem[]

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: '#f8fafc', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #0c1a2e 100%)', padding: '72px 24px 60px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
          {t('hero.eyebrow')}
        </div>
        <h1 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, color: '#fff', margin: '0 0 16px', lineHeight: 1.15 }}>
          {t('hero.title_line1')}<br />
          <span style={{ background: 'linear-gradient(90deg,#a78bfa,#34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {t('hero.title_line2')}
          </span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 16, maxWidth: 520, margin: '0 auto 28px', lineHeight: 1.6 }}>
          {t('hero.subtitle')}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {badges.map(badge => (
            <span key={badge} style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 99, padding: '4px 12px', fontSize: 12, fontWeight: 600, color: '#c4b5fd' }}>
              ✓ {badge}
            </span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '48px 20px 80px' }}>

        {/* Tiers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 48 }}>
          {tiers.map((tier, i) => {
            const style = TIER_STYLES[i]
            return (
              <div key={tier.name} style={{
                background: '#fff',
                borderRadius: 20,
                border: style.highlight ? `2px solid ${style.color}` : `1.5px solid ${style.border}`,
                padding: '24px 22px',
                boxShadow: style.highlight ? `0 8px 32px ${style.color}22` : '0 2px 12px rgba(0,0,0,0.04)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              }}>
                {style.highlight && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: style.color, color: '#fff', fontSize: 10, fontWeight: 800, padding: '3px 12px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                    {t('most_popular')}
                  </div>
                )}

                <div style={{ fontSize: 11, fontWeight: 700, color: style.color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  {tier.name}
                </div>

                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 900, color: '#0f172a' }}>{tier.price}</span>
                  <span style={{ fontSize: 13, color: '#94a3b8', marginInlineStart: 4 }}>{tier.priceNote}</span>
                </div>

                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20, minHeight: 32 }}>
                  {tier.volume}
                </div>

                <ul style={{ margin: '0 0 24px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  {tier.features.map(f => (
                    <li key={f} style={{ fontSize: 13, color: '#374151', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ color: style.color, fontWeight: 900, flexShrink: 0 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <a
                  href={style.ctaHref}
                  style={{
                    display: 'block', textAlign: 'center',
                    padding: '11px 0', borderRadius: 12,
                    background: style.highlight ? style.color : style.accentBg,
                    color: style.highlight ? '#fff' : style.color,
                    border: style.highlight ? 'none' : `1.5px solid ${style.border}`,
                    fontWeight: 700, fontSize: 14, textDecoration: 'none',
                    transition: 'opacity 0.15s',
                  }}
                >
                  {tier.cta} →
                </a>
              </div>
            )
          })}
        </div>

        {/* Enterprise CTA */}
        <div style={{ background: 'linear-gradient(135deg, #0f172a, #1e1b4b)', borderRadius: 20, padding: '28px 32px', marginBottom: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 6 }}>{t('enterprise.title')}</div>
            <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.5 }}>
              {t('enterprise.desc')}
            </div>
          </div>
          <a href="mailto:alt@in2sys.fr?subject=APTOGON Enterprise"
            style={{ padding: '12px 24px', borderRadius: 12, background: 'linear-gradient(135deg,#7c3aed,#059669)', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            {t('enterprise.cta')} →
          </a>
        </div>

        {/* ROI Calculator */}
        <div style={{ marginBottom: 48 }}>
          <RoiCalc t={t} />
        </div>

        {/* Comparison table */}
        <div style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '0 0 20px', textAlign: 'center' }}>
            {t('comparison.title')}
          </h2>
          <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['', 'APTOGON', 'VerifyYou', 'KYC (Onfido)'].map((h, i) => (
                    <th key={h || 'blank'} style={{ padding: '12px 16px', textAlign: i === 0 ? 'start' : 'center', fontSize: 12, fontWeight: 700, color: i === 1 ? '#7c3aed' : '#64748b', background: i === 1 ? '#faf5ff' : undefined }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => (
                  <tr key={row.label} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '11px 16px', fontWeight: 600, color: '#374151', fontSize: 13 }}>{row.label}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'center', fontWeight: 700, background: '#faf5ff', color: row.apt.startsWith('✓') ? '#059669' : row.apt.startsWith('✗') ? '#059669' : '#0f172a' }}>{row.apt}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'center', color: '#64748b' }}>{row.vfy}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'center', color: '#64748b' }}>{row.kyc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            {t('comparison.footnote')}{' '}
            <Link href={`/${locale}/research`} style={{ color: '#7c3aed' }}>{t('comparison.methodology_cta')} →</Link>
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '0 0 20px', textAlign: 'center' }}>{t('faq.title')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {faqs.map((item, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{ width: '100%', background: 'none', border: 'none', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', textAlign: 'start', gap: 12 }}
                >
                  <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 14 }}>{item.q}</span>
                  <span style={{ color: '#7c3aed', fontSize: 18, flexShrink: 0 }}>{openFaq === i ? '−' : '+'}</span>
                </button>
                {openFaq === i && (
                  <div style={{ padding: '0 20px 16px', fontSize: 14, color: '#475569', lineHeight: 1.65 }}>
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
