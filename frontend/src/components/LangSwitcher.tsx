'use client'
import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useState, useEffect } from 'react'

const RTL_LOCALES = ['ar', 'he']

const LANGS = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'ru', label: 'RU', name: 'Русский' },
  { code: 'zh', label: '中文', name: '中文' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'ar', label: 'AR', name: 'العربية' },
  { code: 'he', label: 'HE', name: 'עברית' },
  { code: 'pt', label: 'PT', name: 'Português' },
  { code: 'hi', label: 'HI', name: 'हिन्दी' },
  { code: 'de', label: 'DE', name: 'Deutsch' },
  { code: 'ja', label: 'JP', name: '日本語' },
]

export default function LangSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const current = LANGS.find(l => l.code === locale) || LANGS[0]
  const isRTL = RTL_LOCALES.includes(locale)

  // Close dropdown on route change (layout persists across navigations)
  useEffect(() => { setOpen(false) }, [pathname])

  const switchLocale = (code: string) => {
    // Persist choice in cookie so middleware keeps this locale on future navigations
    document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=31536000; SameSite=Lax`
    router.replace(pathname, { locale: code })
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          padding: '6px 12px',
          color: '#94a3b8',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        🌐 {current.label}
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: 8,
            zIndex: 100,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 2,
            minWidth: 200,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            {LANGS.map(lang => (
              <button
                key={lang.code}
                onClick={() => switchLocale(lang.code)}
                style={{
                  background: lang.code === locale ? 'rgba(124,58,237,0.2)' : 'transparent',
                  border: lang.code === locale ? '1px solid rgba(124,58,237,0.4)' : '1px solid transparent',
                  borderRadius: 8,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: lang.code === locale ? '#a78bfa' : '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
                  {lang.name}
                </span>
                <span style={{ fontSize: 10, color: '#475569', fontFamily: 'Inter, system-ui, sans-serif' }}>
                  {lang.code.toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
