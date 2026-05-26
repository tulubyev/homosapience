'use client'
import { useState } from 'react'

const WALLETS = [
  {
    symbol: '₿',
    name:    'Bitcoin',
    ticker:  'BTC',
    network: 'Bitcoin',
    color:   '#f7931a',
    bg:      '#fffbeb',
    address: 'bc1qdpxjvgtyzsa49zh63fayxtmmmeuvptsa3m3luw',
  },
  {
    symbol: '₮',
    name:    'Tether',
    ticker:  'USDT',
    network: 'TRC-20 · Tron',
    color:   '#26a17b',
    bg:      '#f0fdf4',
    address: 'TSjcLToLnr2May1EELcKvsPxsS73sWb8ZT',
  },
  {
    symbol: '$',
    name:    'USD Coin',
    ticker:  'USDC',
    network: 'ERC-20 · Ethereum',
    color:   '#2775ca',
    bg:      '#eff6ff',
    address: '0xc4F338A9c168638bc8Dde307D44F2c4130eE043A',
  },
  {
    symbol: 'Ξ',
    name:    'Ethereum',
    ticker:  'ETH',
    network: 'ERC-20 · Ethereum',
    color:   '#627eea',
    bg:      '#f5f3ff',
    address: '0xc4F338A9c168638bc8Dde307D44F2c4130eE043A',
  },
  {
    symbol: '⬡',
    name:    'Gonka',
    ticker:  'GNK',
    network: 'Gonka Chain',
    color:   '#7c3aed',
    bg:      '#faf5ff',
    address: 'gonka1rka2rlvld3ywp5up43zqu9yhlsqylqv2wq0acv',
  },
]

function WalletCard({ w }: { w: typeof WALLETS[0] }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(w.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = w.address
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{
      background: w.bg,
      border: `1.5px solid ${w.color}25`,
      borderRadius: 18,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: w.color, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.1rem', fontWeight: 900, flexShrink: 0,
        }}>
          {w.symbol}
        </div>
        <div>
          <div style={{ fontWeight: 800, color: '#111827', fontSize: '0.95rem', lineHeight: 1.2 }}>
            {w.ticker}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{w.name}</div>
        </div>
        <div style={{
          marginLeft: 'auto',
          fontSize: '0.68rem', fontWeight: 700,
          color: w.color,
          background: `${w.color}15`,
          padding: '3px 10px', borderRadius: 99,
          whiteSpace: 'nowrap',
        }}>
          {w.network}
        </div>
      </div>

      {/* Address + copy */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(0,0,0,0.03)',
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 10, padding: '9px 12px',
      }}>
        <span style={{
          flex: 1, fontFamily: 'monospace', fontSize: '0.72rem',
          color: '#374151', wordBreak: 'break-all', lineHeight: 1.5,
          userSelect: 'all',
        }}>
          {w.address}
        </span>
        <button
          onClick={copy}
          title="Copy address"
          style={{
            flexShrink: 0,
            width: 32, height: 32, borderRadius: 8,
            background: copied ? '#059669' : w.color,
            border: 'none', cursor: 'pointer',
            color: '#fff', fontSize: '0.85rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s',
          }}
        >
          {copied ? '✓' : '⎘'}
        </button>
      </div>
    </div>
  )
}

export default function CryptoWallets() {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#111827', marginBottom: 6 }}>
        🪙 Crypto donations
      </h2>
      <p style={{ color: '#6b7280', fontSize: '0.88rem', marginBottom: 20 }}>
        Send any amount directly to the wallet. No middlemen, no fees.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {WALLETS.map(w => <WalletCard key={w.ticker + w.network} w={w} />)}
      </div>
      <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 14, lineHeight: 1.6 }}>
        ⚠️ Always double-check the network before sending. Sending to the wrong network may result in permanent loss of funds.
      </p>
    </section>
  )
}
