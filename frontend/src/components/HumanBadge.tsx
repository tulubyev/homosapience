'use client'

/**
 * HumanBadge — SVG иконка статуса верификации человека.
 *
 * Состояния:
 *   verified   — зелёный фон, галочка       (trust_label: trusted / community_verified / newcomer с passed=true)
 *   unverified — серый + красная черта       (не верифицирован / неизвестен)
 *   revoked    — красный фон, крестик        (бот / отозван)
 *   pending    — пунктирная окантовка, ?     (ожидает bond)
 *
 * Размеры: 16 | 24 | 32 | 48 | 64 | 128
 */

export type BadgeState = 'verified' | 'unverified' | 'revoked' | 'pending'

interface HumanBadgeProps {
  state?: BadgeState
  size?: 16 | 24 | 32 | 48 | 64 | 128
  className?: string
  style?: React.CSSProperties
  title?: string
}

const THEMES = {
  verified: {
    bg:          '#166534',
    face:        '#86efac',
    overlayBg:   '#22c55e',
    overlayBorder: '#166534',
    ring:        '#22c55e',
    ringDash:    '',
  },
  unverified: {
    bg:          '#475569',
    face:        '#cbd5e1',
    overlayBg:   'none',
    overlayBorder: 'none',
    ring:        '#64748b',
    ringDash:    '',
  },
  revoked: {
    bg:          '#991b1b',
    face:        '#fca5a5',
    overlayBg:   '#ef4444',
    overlayBorder: '#991b1b',
    ring:        '#ef4444',
    ringDash:    '',
  },
  pending: {
    bg:          '#1e1b4b',
    face:        '#a5b4fc',
    overlayBg:   '#4f46e5',
    overlayBorder: '#1e1b4b',
    ring:        '#7c3aed',
    ringDash:    '4 2',
  },
}

export default function HumanBadge({
  state = 'unverified',
  size = 32,
  className,
  style,
  title,
}: HumanBadgeProps) {
  const s = size
  const r = s / 2              // радиус внешнего круга
  const cx = r                 // центр x
  const cy = r                 // центр y

  // Пропорции лица
  const headR   = s * 0.175   // радиус головы
  const headCy  = s * 0.33    // центр головы по Y
  const bodyTop = s * 0.50    // верх плеч
  const bodyW   = s * 0.70    // ширина плеч (полная)

  // Оверлей — кружок в правом нижнем углу
  const oR    = s * 0.22      // радиус оверлея
  const oCx   = s * 0.72     // центр оверлея x
  const oCy   = s * 0.72     // центр оверлея y

  const theme = THEMES[state]
  const uid   = `hb-${state}-${s}-${Math.random().toString(36).slice(2, 6)}`

  const defaultTitle =
    state === 'verified'   ? 'Verified Human' :
    state === 'unverified' ? 'Not Verified' :
    state === 'revoked'    ? 'Bot / Revoked' :
                             'Pending verification'

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role="img"
      aria-label={title ?? defaultTitle}
    >
      <title>{title ?? defaultTitle}</title>

      {/* Clip path — обрезаем силуэт по кругу */}
      <defs>
        <clipPath id={uid}>
          <circle cx={cx} cy={cy} r={r - 1} />
        </clipPath>
      </defs>

      {/* Фоновый круг */}
      <circle
        cx={cx} cy={cy} r={r - 1}
        fill={theme.bg}
        stroke={theme.ring}
        strokeWidth={s * 0.04}
        strokeDasharray={theme.ringDash || undefined}
      />

      {/* Голова (силуэт) */}
      <circle cx={cx} cy={headCy} r={headR} fill={theme.face} />

      {/* Плечи / тело */}
      <path
        d={`M ${cx - bodyW / 2} ${s + 2} Q ${cx - bodyW / 2} ${bodyTop} ${cx} ${bodyTop} Q ${cx + bodyW / 2} ${bodyTop} ${cx + bodyW / 2} ${s + 2} Z`}
        fill={theme.face}
        clipPath={`url(#${uid})`}
      />

      {/* ── Оверлеи по состоянию ── */}

      {state === 'verified' && (
        <g>
          <circle cx={oCx} cy={oCy} r={oR} fill={theme.overlayBg} stroke={theme.overlayBorder} strokeWidth={s * 0.03} />
          {/* Галочка */}
          <polyline
            points={`${oCx - oR * 0.45},${oCy} ${oCx - oR * 0.05},${oCy + oR * 0.45} ${oCx + oR * 0.55},${oCy - oR * 0.5}`}
            stroke="#fff"
            strokeWidth={s * 0.055}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}

      {state === 'unverified' && (
        /* Красная диагональная черта через весь круг */
        <line
          x1={s * 0.15} y1={s * 0.15}
          x2={s * 0.85} y2={s * 0.85}
          stroke="#ef4444"
          strokeWidth={s * 0.1}
          strokeLinecap="round"
        />
      )}

      {state === 'revoked' && (
        <g>
          <circle cx={oCx} cy={oCy} r={oR} fill={theme.overlayBg} stroke={theme.overlayBorder} strokeWidth={s * 0.03} />
          {/* Крестик */}
          <line x1={oCx - oR * 0.5} y1={oCy - oR * 0.5} x2={oCx + oR * 0.5} y2={oCy + oR * 0.5}
            stroke="#fff" strokeWidth={s * 0.055} strokeLinecap="round" />
          <line x1={oCx + oR * 0.5} y1={oCy - oR * 0.5} x2={oCx - oR * 0.5} y2={oCy + oR * 0.5}
            stroke="#fff" strokeWidth={s * 0.055} strokeLinecap="round" />
        </g>
      )}

      {state === 'pending' && (
        <g>
          <circle cx={oCx} cy={oCy} r={oR} fill={theme.overlayBg} stroke={theme.overlayBorder} strokeWidth={s * 0.03} />
          {/* Знак вопроса */}
          <text
            x={oCx} y={oCy + oR * 0.38}
            textAnchor="middle"
            fontSize={oR * 1.2}
            fontWeight="900"
            fill="#fff"
            fontFamily="system-ui, sans-serif"
          >?</text>
        </g>
      )}
    </svg>
  )
}

/**
 * Хелпер: определяет состояние badge по данным из API.
 */
export function badgeStateFromCredential(opts: {
  passed?: boolean
  trust_label?: string
  revoked?: boolean
  pending?: boolean
}): BadgeState {
  if (opts.revoked)                    return 'revoked'
  if (opts.pending)                    return 'pending'
  if (opts.passed || opts.trust_label) return 'verified'
  return 'unverified'
}
