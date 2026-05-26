import { ImageResponse } from 'next/og'

export const size        = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
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
      </div>
    ),
    { ...size },
  )
}
