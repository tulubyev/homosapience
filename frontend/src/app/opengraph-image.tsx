import { ImageResponse } from 'next/og'

export const alt         = 'APTOGON — Verified Human. Prove you are human with a gesture.'
export const size        = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0f1a',
          fontFamily: 'system-ui, sans-serif',
          padding: '0 80px',
          gap: 32,
        }}
      >
        <svg width="220" height="220" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="48" fill="#dcfce7" stroke="#16a34a" strokeWidth="3" />
          <circle cx="44" cy="34" r="11" fill="#16a34a" />
          <path d="M 22 80 Q 22 52 44 52 Q 66 52 66 80 Z" fill="#16a34a" />
          <circle cx="74" cy="72" r="14" fill="#16a34a" stroke="#ffffff" strokeWidth="3" />
          <polyline
            points="67,72 73,78 81,66"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 88, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.03em', lineHeight: 1 }}>
            APTOGON
          </div>
          <div style={{ fontSize: 32, color: '#94a3b8', fontWeight: 500, lineHeight: 1.2, textAlign: 'center' }}>
            Prove you're human — with a gesture.
          </div>
          <div style={{ fontSize: 20, color: '#475569', fontWeight: 400, marginTop: 24 }}>
            homosapience.org
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
