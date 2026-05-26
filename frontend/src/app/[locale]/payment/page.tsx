'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type Modal = 'crypto' | 'webpay' | 'card' | null

const APTOS_ADDRESS = '0xbddd0085d25edf5c3be3f5bf01a36d90d87c4adc5a08ec8b5bef7bdfc8e8a4b9'

// ── Copy-to-clipboard helper ──────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      style={{
        padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.3)',
        background: copied ? '#7c3aed' : 'rgba(124,58,237,0.08)',
        color: copied ? '#fff' : '#7c3aed', fontWeight: 700, fontSize: 12,
        cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap',
      }}
    >
      {copied ? '✓ Copied' : '📋 Copy'}
    </button>
  )
}

// ── Modal overlay ─────────────────────────────────────────────────────────────
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 24, backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 24, padding: 32,
          maxWidth: 440, width: '100%', position: 'relative',
          boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            width: 32, height: 32, borderRadius: '50%',
            border: 'none', background: '#f1f5f9',
            color: '#64748b', fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >×</button>
        {children}
      </div>
    </div>
  )
}

// ── Crypto modal ──────────────────────────────────────────────────────────────
function CryptoModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        }}>⛓️</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, color: '#0f172a' }}>Crypto</div>
          <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>Aptos Network · APT</div>
        </div>
      </div>

      <div style={{ background: 'rgba(124,58,237,0.05)', borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
          Aptos wallet address
        </div>
        <div style={{
          fontFamily: 'monospace', fontSize: 12, color: '#4c1d95',
          wordBreak: 'break-all', lineHeight: 1.7, marginBottom: 12,
          padding: '12px 14px', background: 'rgba(124,58,237,0.08)',
          borderRadius: 10, border: '1px solid rgba(124,58,237,0.15)',
        }}>
          {APTOS_ADDRESS}
        </div>
        <CopyButton text={APTOS_ADDRESS} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {[
          { icon: '⚡', text: 'Instant settlement on Aptos blockchain' },
          { icon: '💸', text: 'Near-zero transaction fees (< $0.01)' },
          { icon: '🌍', text: 'Available worldwide, no KYC' },
          { icon: '📩', text: 'After sending — email us the TX hash to donate@homosapience.org' },
        ].map(item => (
          <div key={item.text} style={{ display: 'flex', gap: 10, fontSize: 13, color: '#475569' }}>
            <span>{item.icon}</span><span>{item.text}</span>
          </div>
        ))}
      </div>

      <a
        href="https://petra.app/"
        target="_blank" rel="noopener noreferrer"
        style={{
          display: 'block', textAlign: 'center',
          background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
          color: '#fff', fontWeight: 700, fontSize: 14,
          padding: '13px 0', borderRadius: 14, textDecoration: 'none',
          boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
        }}
      >
        Get Petra Wallet for Aptos →
      </a>
    </Modal>
  )
}

// ── Web Pay modal ─────────────────────────────────────────────────────────────
function WebPayModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg,#2563eb,#0ea5e9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        }}>🌐</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, color: '#0f172a' }}>Web Pay</div>
          <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600 }}>Stripe · PayPal · Wise</div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>
        International payment methods available for most countries. Click the link below — we&apos;ll reply with the payment link within 24 hours.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {[
          { icon: '💳', name: 'Stripe', desc: 'Visa · Mastercard · Apple Pay · Google Pay', color: '#635BFF' },
          { icon: '🅿️', name: 'PayPal',  desc: 'PayPal balance · card · bank transfer', color: '#003087' },
          { icon: '💸', name: 'Wise',    desc: 'Multi-currency bank transfer, low fees', color: '#48bb78' },
        ].map(p => (
          <div key={p.name} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px', borderRadius: 14,
            border: `1.5px solid ${p.color}22`,
            background: `${p.color}08`,
          }}>
            <span style={{ fontSize: 22 }}>{p.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>{p.name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{p.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <a
        href="mailto:donate@homosapience.org?subject=Web Pay donation request"
        style={{
          display: 'block', textAlign: 'center',
          background: 'linear-gradient(135deg,#2563eb,#0ea5e9)',
          color: '#fff', fontWeight: 700, fontSize: 14,
          padding: '13px 0', borderRadius: 14, textDecoration: 'none',
          boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
        }}
      >
        Request payment link →
      </a>
    </Modal>
  )
}

// ── Card modal ────────────────────────────────────────────────────────────────
function CardModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg,#059669,#10b981)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        }}>💳</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, color: '#0f172a' }}>Card</div>
          <div style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>Мир · Tinkoff · СБП</div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>
        Оплата российскими картами, в том числе картами Мир. Без зарубежных сервисов.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>

        {/* CloudTips */}
        <a
          href="https://pay.cloudtips.ru/p/76b1a873"
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px 18px', borderRadius: 16,
            background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)',
            border: '1.5px solid rgba(5,150,105,0.2)',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 28 }}>☁️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#065f46' }}>CloudTips</div>
            <div style={{ fontSize: 12, color: '#059669' }}>Тинькофф · Visa · Mastercard · Мир</div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg,#059669,#10b981)',
            color: '#fff', fontWeight: 700, fontSize: 12,
            padding: '8px 16px', borderRadius: 10,
          }}>Оплатить →</div>
        </a>

        {/* СБП */}
        <div style={{
          padding: '16px 18px', borderRadius: 16,
          background: 'rgba(5,150,105,0.05)',
          border: '1.5px solid rgba(5,150,105,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: 24 }}>📱</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#065f46' }}>СБП — Система быстрых платежей</div>
              <div style={{ fontSize: 12, color: '#059669' }}>Перевод по номеру телефона</div>
            </div>
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 14, fontWeight: 800,
            color: '#065f46', padding: '10px 14px',
            background: 'rgba(5,150,105,0.08)', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>+7 (xxx) xxx-xx-xx</span>
            <CopyButton text="+7xxxxxxxxxx" />
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, marginBottom: 0 }}>
            Напишите нам на donate@homosapience.org после перевода
          </p>
        </div>

        {/* Bank */}
        <a
          href="mailto:donate@homosapience.org?subject=Банковский перевод"
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 18px', borderRadius: 16,
            background: 'rgba(5,150,105,0.04)',
            border: '1.5px solid rgba(5,150,105,0.12)',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 22 }}>🏦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#065f46' }}>Банковский перевод</div>
            <div style={{ fontSize: 12, color: '#6ee7b7' }}>Реквизиты по запросу</div>
          </div>
          <div style={{ color: '#059669', fontSize: 12, fontWeight: 700 }}>Запросить →</div>
        </a>

      </div>
    </Modal>
  )
}

// ── Main Payment page ─────────────────────────────────────────────────────────
export default function PaymentPage() {
  const [modal, setModal] = useState<Modal>(null)
  const params = useParams()
  const locale = (params?.locale as string) || 'en'

  const methods = [
    {
      id: 'crypto' as Modal,
      icon: '⛓️',
      title: 'Crypto',
      subtitle: 'Aptos · APT',
      desc: 'Instant, borderless. Near-zero fees on Aptos blockchain.',
      gradient: 'linear-gradient(160deg,#faf5ff,#ede9fe)',
      accent: '#7c3aed',
      btnGrad: 'linear-gradient(135deg,#7c3aed,#a855f7)',
      border: 'rgba(124,58,237,0.2)',
    },
    {
      id: 'webpay' as Modal,
      icon: '🌐',
      title: 'Web Pay',
      subtitle: 'Stripe · PayPal · Wise',
      desc: 'International cards and bank transfers. Available in most countries.',
      gradient: 'linear-gradient(160deg,#eff6ff,#dbeafe)',
      accent: '#2563eb',
      btnGrad: 'linear-gradient(135deg,#2563eb,#0ea5e9)',
      border: 'rgba(37,99,235,0.2)',
    },
    {
      id: 'card' as Modal,
      icon: '💳',
      title: 'Card',
      subtitle: 'Мир · Tinkoff · СБП',
      desc: 'Russian cards including Mir. Direct payment without foreign services.',
      gradient: 'linear-gradient(160deg,#f0fdf4,#dcfce7)',
      accent: '#059669',
      btnGrad: 'linear-gradient(135deg,#059669,#10b981)',
      border: 'rgba(5,150,105,0.2)',
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#faf5ff', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg,#2d1b69,#4c1d95)',
        padding: '56px 24px 48px', textAlign: 'center',
      }}>
        <Link href={`/${locale}/donate`} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: '#a78bfa', fontSize: 13, fontWeight: 600, textDecoration: 'none',
          marginBottom: 24,
        }}>← Back to donate</Link>
        <div style={{ fontSize: 48, marginBottom: 16 }}>💜</div>
        <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', fontWeight: 900, color: '#fff', marginBottom: 12 }}>
          Choose payment method
        </h1>
        <p style={{ color: '#c4b5fd', fontSize: '1rem', maxWidth: 440, margin: '0 auto' }}>
          Support APTOGON — open infrastructure for a human internet
        </p>
      </div>

      {/* Payment blocks */}
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '48px 24px 64px' }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 20 }}>
          {methods.map(m => (
            <button
              key={m.id}
              onClick={() => setModal(m.id)}
              style={{
                borderRadius: 22, border: `2px solid ${m.border}`,
                background: m.gradient,
                padding: '28px 22px', textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: 14,
                cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 30px ${m.accent}25` }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)' }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 16,
                background: m.btnGrad,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, boxShadow: `0 4px 14px ${m.accent}35`,
              }}>{m.icon}</div>
              <div>
                <div style={{ fontWeight: 900, fontSize: '1.15rem', color: m.accent, marginBottom: 2 }}>{m.title}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: m.accent, opacity: 0.7 }}>{m.subtitle}</div>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5, margin: 0, flex: 1 }}>{m.desc}</p>
              <div style={{
                padding: '10px 0', borderRadius: 12, width: '100%',
                background: m.btnGrad,
                color: '#fff', fontWeight: 700, fontSize: '0.85rem', textAlign: 'center',
                boxShadow: `0 3px 10px ${m.accent}30`,
              }}>
                Pay with {m.title} →
              </div>
            </button>
          ))}
        </div>

        {/* Security note */}
        <div style={{
          marginTop: 40, borderRadius: 18, padding: '20px 24px',
          background: 'rgba(124,58,237,0.05)', border: '1px solid rgba(124,58,237,0.12)',
          display: 'flex', gap: 14, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#4c1d95', marginBottom: 4 }}>Your data is safe</div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              We never store your payment details. Each method opens the provider&apos;s own secure interface.
              Questions? Write to <a href="mailto:donate@homosapience.org" style={{ color: '#7c3aed' }}>donate@homosapience.org</a>
            </div>
          </div>
        </div>

      </div>

      {/* Modals */}
      {modal === 'crypto'  && <CryptoModal  onClose={() => setModal(null)} />}
      {modal === 'webpay'  && <WebPayModal  onClose={() => setModal(null)} />}
      {modal === 'card'    && <CardModal    onClose={() => setModal(null)} />}
    </div>
  )
}
