'use client'
import { Link, usePathname } from '@/i18n/navigation'
import { useState } from 'react'
import LangSwitcher from './LangSwitcher'
import Logo from './Logo'

const NAV_LINKS = [
  { href: '/manifest',   label: 'Manifest',    color: '#a78bfa', activeBg: 'rgba(167,139,250,0.15)', activeBorder: 'rgba(167,139,250,0.35)' },
  { href: '/developers', label: 'Developers',  color: '#67e8f9', activeBg: 'rgba(103,232,249,0.12)', activeBorder: 'rgba(103,232,249,0.35)' },
  { href: '/donate',     label: 'Donate',      color: '#86efac', activeBg: 'rgba(134,239,172,0.12)', activeBorder: 'rgba(134,239,172,0.35)' },
  { href: '/verify',     label: 'Verify',      color: '#fbbf24', activeBg: 'rgba(251,191,36,0.12)',  activeBorder: 'rgba(251,191,36,0.35)'  },
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

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2.05 21.5l4.396-1.368A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.952 7.952 0 01-4.073-1.118l-.291-.173-3.018.94.955-2.951-.19-.304A7.955 7.955 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>
    </svg>
  )
}

export default function Header() {
  const pathname  = usePathname()  // next-intl: already without locale prefix
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <style>{`
        .hdr-nav { display: flex; gap: 4px; align-items: center; }
        .hdr-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .hdr-hamburger { display: none; }
        .hdr-mobile-menu { display: none; }
        @media (max-width: 767px) {
          .hdr-nav { display: none; }
          .hdr-hamburger { display: flex; }
          .hdr-mobile-menu.open {
            display: flex; flex-direction: column;
            position: fixed; top: 56px; left: 0; right: 0;
            background: rgba(10,15,26,0.98);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid rgba(255,255,255,0.08);
            padding: 12px 16px 16px;
            gap: 4px; z-index: 49;
          }
        }
      `}</style>

      <header dir="ltr" style={{
        background: 'rgba(10, 15, 26, 0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '0 20px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>

        {/* Logo */}
        <Link href="/" style={{ textDecoration: 'none', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Logo size={28} />
          <span style={{ fontSize: '1.15rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
            <span style={{ color: '#f1f5f9' }}>APT</span>
            <span style={{ color: '#06b6d4' }}>O</span>
            <span style={{ background: 'linear-gradient(90deg,#7c3aed,#db2777)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>GON</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hdr-nav">
          {NAV_LINKS.map(link => {
            const isActive = pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: link.color,
                  background: isActive ? link.activeBg : 'transparent',
                  border: `1px solid ${isActive ? link.activeBorder : 'transparent'}`,
                  opacity: isActive ? 1 : 0.7,
                  transition: 'opacity 0.15s, background 0.15s',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        {/* Right: social + lang + hamburger */}
        <div className="hdr-right">
          <Link href="/chat" title="Chat"
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(244,114,182,0.1)', border: '1px solid rgba(244,114,182,0.2)', color: '#f472b6', textDecoration: 'none' }}>
            <ChatIcon />
          </Link>
          <a href="https://t.me/aptogon" target="_blank" rel="noopener noreferrer" title="Telegram"
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', color: '#38bdf8', textDecoration: 'none' }}>
            <TelegramIcon />
          </a>
          <a href="https://github.com/tulubyev/homosapience" target="_blank" rel="noopener noreferrer" title="GitHub"
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)', color: '#94a3b8', textDecoration: 'none' }}>
            <GitHubIcon />
          </a>
          <LangSwitcher />
          {/* Hamburger */}
          <button
            className="hdr-hamburger"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, padding: '4px', display: 'flex', alignItems: 'center' }}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      <div className={`hdr-mobile-menu ${menuOpen ? 'open' : ''}`}>
        {NAV_LINKS.map(link => {
          const isActive = pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                color: link.color,
                background: isActive ? link.activeBg : 'transparent',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {link.label}
            </Link>
          )
        })}
      </div>
    </>
  )
}
