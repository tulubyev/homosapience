import Link from 'next/link'

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2.05 21.5l4.396-1.368A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.952 7.952 0 01-4.073-1.118l-.291-.173-3.018.94.955-2.951-.19-.304A7.955 7.955 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>
    </svg>
  )
}

const LINKS = [
  { href: '/manifest',   label: 'Manifest',    color: '#a78bfa' },
  { href: '/developers', label: 'Developers',  color: '#67e8f9' },
  { href: '/research',   label: 'Research',    color: '#a5f3fc' },
  { href: '/donate',     label: 'Donate',      color: '#86efac' },
  { href: '/verify',     label: 'Verify',      color: '#fbbf24' },
]

function TelegramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  )
}

export default function Footer() {
  return (
    <footer dir="ltr" style={{
      background: '#0a0f1a',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '40px 24px 28px',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Main row: logo + nav links on same baseline */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>

          {/* Logo only */}
          <Link href="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
            <span style={{ fontSize: '1.4rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
              <span style={{ color: '#f1f5f9' }}>APT</span>
              <span style={{ color: '#06b6d4' }}>O</span>
              <span style={{ background: 'linear-gradient(90deg,#7c3aed,#db2777)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>GON</span>
            </span>
          </Link>

          {/* Nav links — same row as logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            {LINKS.map(l => (
              <Link key={l.href} href={l.href} style={{ color: l.color, fontSize: 14, fontWeight: 600, textDecoration: 'none', opacity: 0.85 }}>
                {l.label}
              </Link>
            ))}
            <span style={{ color: '#334155' }}>·</span>
            <Link href="/chat"
              style={{ color: '#f472b6', fontSize: 14, fontWeight: 600, textDecoration: 'none', opacity: 0.85, display: 'flex', alignItems: 'center', gap: 6 }}>
              <ChatIcon /> Chat
            </Link>
            <a href="https://t.me/aptogon" target="_blank" rel="noopener noreferrer"
              style={{ color: '#38bdf8', fontSize: 14, fontWeight: 600, textDecoration: 'none', opacity: 0.85, display: 'flex', alignItems: 'center', gap: 6 }}>
              <TelegramIcon /> Telegram
            </a>
            <a href="https://github.com/tulubyev/homosapience" target="_blank" rel="noopener noreferrer"
              style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, textDecoration: 'none', opacity: 0.85, display: 'flex', alignItems: 'center', gap: 6 }}>
              <GitHubIcon /> GitHub
            </a>
          </div>
        </div>

        {/* Bottom row: tagline + copyright left, version right */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Human Firewall for the Internet</p>
            <p style={{ fontSize: 12, color: '#334155', margin: 0 }}>© 2025–26 Homo Sapience Internet · Open Source · AGPL-3.0 + Commercial</p>
          </div>
          <p style={{ fontSize: 12, color: '#334155', margin: 0, flexShrink: 0 }}>
            v0.2.0 · SapiX · Aptos Testnet
          </p>
        </div>

      </div>
    </footer>
  )
}
