interface LogoProps {
  size?: number
  className?: string
}

export default function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="APTOGON verified human"
      className={className}
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
  )
}
