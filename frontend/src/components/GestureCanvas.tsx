'use client'
import { useRef, useEffect, useState } from 'react'

export interface TouchEventData {
  x: number           // normalized 0-1
  y: number           // normalized 0-1
  pressure: number
  timestamp_ms: number
  pause_after_ms: number
}

export interface ChallengeResult {
  dot_x: number            // normalized 0-1
  dot_y: number            // normalized 0-1
  shown_at_ms: number      // ms relative to gesture start
  reaction_ms: number | null  // null = missed
  tap_x: number | null
  tap_y: number | null
  passed: boolean
  color: string            // dot color for this challenge
}

interface Props {
  onComplete: (events: TouchEventData[], challenges: ChallengeResult[]) => void
  disabled?: boolean
}

// Record a point at most every THROTTLE_MS ms
const THROTTLE_MS    = 45
const MIN_DIST       = 0.004
const PAUSE_POLL_MS  = 120

// Challenge config
const CHALLENGE_DELAY_MIN    = 1500  // ms after gesture start before first dot
const CHALLENGE_DELAY_MAX    = 2500
const CHALLENGE_BETWEEN_MIN  = 3000  // ms between sequential dots
const CHALLENGE_BETWEEN_MAX  = 4000
const CHALLENGE_TAP_RADIUS   = 0.075 // normalized — cursor must visually touch dot
const CHALLENGE_TIMEOUT_MS   = 5000  // per dot timeout (5 sec visibility)
const DOT_RADIUS_PX          = 28    // large visible dot so cursor clearly overlaps
const CHALLENGE_COUNT_MIN    = 2
const CHALLENGE_COUNT_MAX    = 2     // always 2 dots

// Dot color palette — random per challenge
const DOT_PALETTE = [
  { fill: '#f59e0b', glow: 'rgba(251,191,36,',   label: 'yellow'  },
  { fill: '#10b981', glow: 'rgba(16,185,129,',   label: 'green'   },
  { fill: '#ef4444', glow: 'rgba(239,68,68,',    label: 'red'     },
  { fill: '#8b5cf6', glow: 'rgba(139,92,246,',   label: 'purple'  },
  { fill: '#3b82f6', glow: 'rgba(59,130,246,',   label: 'blue'    },
]

function drawChallengeDot(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  phase: number,
  colorIdx: number,
) {
  const col   = DOT_PALETTE[colorIdx]
  const pulse = 1 + 0.25 * Math.sin(phase * Math.PI * 2)
  const r     = DOT_RADIUS_PX * pulse

  // Outer glow ring
  ctx.beginPath()
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2)
  ctx.fillStyle = `${col.glow}${(0.18 * pulse).toFixed(2)})`
  ctx.fill()

  // Inner circle
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = col.fill
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2.5
  ctx.stroke()

  // Center dot
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
}

export function GestureCanvas({ onComplete, disabled = false }: Props) {
  const canvasRef       = useRef<HTMLCanvasElement>(null)
  const eventsRef       = useRef<TouchEventData[]>([])
  const gestureStartRef = useRef<number>(0)
  const lastRecordedRef = useRef<number>(0)
  const lastPosRef      = useRef<{ x: number; y: number } | null>(null)
  const isDrawingRef    = useRef(false)
  const pauseTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const challengeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animFrameRef    = useRef<number>(0)
  const [isDone, setIsDone]         = useState(false)
  const [pointCount, setPointCount] = useState(0)
  const [dotActive, setDotActive]   = useState(false)
  const [dotColor, setDotColor]     = useState('')
  const [dotTotal, setDotTotal]     = useState(0)
  const [dotsHit, setDotsHit]       = useState(0)
  const [isDrawing, setIsDrawing]   = useState(false)
  const [elapsed, setElapsed]       = useState(0)  // seconds

  // Challenge state — all in refs to avoid re-renders during drawing
  const challengeRef = useRef<{
    active:    boolean
    resolved:  boolean
    dot_x:     number    // normalized
    dot_y:     number
    cx:        number    // canvas pixels
    cy:        number
    shown_at:  number    // absolute ms
    colorIdx:  number
    // Multi-challenge tracking
    total:     number    // how many dots to show this gesture
    index:     number    // current dot index (0-based)
    completed: ChallengeResult[]
  }>({ active: false, resolved: false, dot_x: 0, dot_y: 0, cx: 0, cy: 0, shown_at: 0, colorIdx: 0, total: 1, index: 0, completed: [] })

  // Gesture trace buffer for redrawing (so dot renders on top)
  const traceRef = useRef<Array<{ cx: number; cy: number; start: boolean }>>([])

  const syncSize = (canvas: HTMLCanvasElement) => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }

  const redrawTrace = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#1d4ed8'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const pt of traceRef.current) {
      if (pt.start) {
        ctx.beginPath()
        ctx.moveTo(pt.cx, pt.cy)
      } else {
        ctx.lineTo(pt.cx, pt.cy)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(pt.cx, pt.cy)
      }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    syncSize(canvas)

    const getXY = (e: MouseEvent | Touch) => {
      syncSize(canvas)
      const rect = canvas.getBoundingClientRect()
      return {
        cx: e.clientX - rect.left,
        cy: e.clientY - rect.top,
        nx: (e.clientX - rect.left) / rect.width,
        ny: (e.clientY - rect.top) / rect.height,
        pressure: 'force' in e ? Math.min(1, Math.max(0, (e as Touch).force || 0.5)) : 0.5,
      }
    }

    const pushPoint = (x: number, y: number, pressure: number) => {
      const now   = Date.now()
      const pause = lastRecordedRef.current ? now - lastRecordedRef.current : 0
      lastRecordedRef.current = now
      lastPosRef.current = { x, y }
      eventsRef.current.push({ x, y, pressure, timestamp_ms: now, pause_after_ms: pause })
      setPointCount(eventsRef.current.length)
    }

    // ── Resolve current challenge and optionally schedule next ─────────────────
    const resolveChallenge = (result: ChallengeResult) => {
      const ch = challengeRef.current
      ch.active   = false
      ch.resolved = true
      ch.completed.push(result)
      ch.index++
      setDotActive(false)
      setDotColor('')
      if (result.reaction_ms !== null) setDotsHit(h => h + 1)
      redrawTrace(ctx, canvas)

      // Schedule next dot if more remain and still drawing
      if (ch.index < ch.total && isDrawingRef.current) {
        const delay = CHALLENGE_BETWEEN_MIN + Math.random() * (CHALLENGE_BETWEEN_MAX - CHALLENGE_BETWEEN_MIN)
        ch.resolved = false  // reset so showNextChallenge can run
        challengeTimerRef.current = setTimeout(() => showNextChallengeDot(), delay)
      }
    }

    // ── Show next challenge dot ────────────────────────────────────────────────
    const showNextChallengeDot = () => {
      const ch = challengeRef.current
      if (!isDrawingRef.current || ch.resolved) return
      syncSize(canvas)
      const margin = 0.18
      const dot_x  = margin + Math.random() * (1 - margin * 2)
      const dot_y  = margin + Math.random() * (1 - margin * 2)
      const px     = dot_x * canvas.width
      const py     = dot_y * canvas.height
      // Pick random color different from previous
      let colorIdx: number
      do {
        colorIdx = Math.floor(Math.random() * DOT_PALETTE.length)
      } while (colorIdx === ch.colorIdx && DOT_PALETTE.length > 1)

      ch.active    = true
      ch.resolved  = false
      ch.dot_x     = dot_x
      ch.dot_y     = dot_y
      ch.cx        = px
      ch.cy        = py
      ch.shown_at  = Date.now()
      ch.colorIdx  = colorIdx
      setDotActive(true)
      setDotColor(DOT_PALETTE[colorIdx].fill)
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = requestAnimationFrame(animateChallenge)
    }

    // ── Check challenge tap ────────────────────────────────────────────────────
    const checkChallengeTap = (nx: number, ny: number, now: number) => {
      const ch = challengeRef.current
      if (!ch.active || ch.resolved) return
      const dist = Math.sqrt((nx - ch.dot_x) ** 2 + (ny - ch.dot_y) ** 2)
      if (dist <= CHALLENGE_TAP_RADIUS) {
        const reaction_ms = now - ch.shown_at
        resolveChallenge({
          dot_x:       ch.dot_x,
          dot_y:       ch.dot_y,
          shown_at_ms: ch.shown_at - gestureStartRef.current,
          reaction_ms,
          tap_x:       nx,
          tap_y:       ny,
          passed:      reaction_ms >= 30 && reaction_ms <= 4500,
          color:       DOT_PALETTE[ch.colorIdx].label,
        })
      }
    }

    // ── Challenge dot animation loop ───────────────────────────────────────────
    const animateChallenge = () => {
      const ch = challengeRef.current
      if (!ch.active) return
      const elapsed = Date.now() - ch.shown_at

      if (elapsed > CHALLENGE_TIMEOUT_MS) {
        resolveChallenge({
          dot_x:       ch.dot_x,
          dot_y:       ch.dot_y,
          shown_at_ms: ch.shown_at - gestureStartRef.current,
          reaction_ms: null,
          tap_x:       null,
          tap_y:       null,
          passed:      false,
          color:       DOT_PALETTE[ch.colorIdx].label,
        })
        return
      }

      redrawTrace(ctx, canvas)
      const phase = (elapsed % 800) / 800
      drawChallengeDot(ctx, ch.cx, ch.cy, phase, ch.colorIdx)
      animFrameRef.current = requestAnimationFrame(animateChallenge)
    }

    // ── Schedule first challenge dot ───────────────────────────────────────────
    const scheduleChallenge = () => {
      const total = CHALLENGE_COUNT_MIN +
        Math.floor(Math.random() * (CHALLENGE_COUNT_MAX - CHALLENGE_COUNT_MIN + 1))
      const ch = challengeRef.current
      ch.total     = total
      ch.index     = 0
      ch.completed = []
      ch.colorIdx  = -1  // no previous color
      setDotTotal(total)
      setDotsHit(0)

      const delay = CHALLENGE_DELAY_MIN + Math.random() * (CHALLENGE_DELAY_MAX - CHALLENGE_DELAY_MIN)
      challengeTimerRef.current = setTimeout(() => {
        if (!isDrawingRef.current) return
        showNextChallengeDot()
      }, delay)
    }

    const startPauseTimer = () => {
      if (pauseTimerRef.current) clearInterval(pauseTimerRef.current)
      pauseTimerRef.current = setInterval(() => {
        if (!isDrawingRef.current) return
        const now     = Date.now()
        const silence = now - lastRecordedRef.current
        if (silence >= PAUSE_POLL_MS && lastPosRef.current) {
          const { x, y } = lastPosRef.current
          eventsRef.current.push({ x, y, pressure: 0.5, timestamp_ms: now, pause_after_ms: silence })
          lastRecordedRef.current = now
          setPointCount(eventsRef.current.length)
        }
      }, PAUSE_POLL_MS)
    }

    const stopPauseTimer = () => {
      if (pauseTimerRef.current) { clearInterval(pauseTimerRef.current); pauseTimerRef.current = null }
    }

    const onStart = (e: MouseEvent | TouchEvent) => {
      if (disabled || isDone) return
      e.preventDefault()
      isDrawingRef.current = true
      setIsDrawing(true)
      eventsRef.current    = []
      traceRef.current     = []
      gestureStartRef.current  = Date.now()
      lastRecordedRef.current  = 0
      lastPosRef.current       = null
      challengeRef.current     = { active: false, resolved: false, dot_x: 0, dot_y: 0, cx: 0, cy: 0, shown_at: 0, colorIdx: -1, total: 1, index: 0, completed: [] }
      cancelAnimationFrame(animFrameRef.current)
      if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current)
      setPointCount(0)
      setElapsed(0)
      syncSize(canvas)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const ev = 'touches' in e ? e.touches[0] : (e as MouseEvent)
      const { cx, cy, nx, ny, pressure } = getXY(ev)
      ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(cx, cy)
      traceRef.current.push({ cx, cy, start: true })
      pushPoint(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)), pressure)
      startPauseTimer()
      scheduleChallenge()
      // Elapsed timer — updates every second for progress bar
      const elapsedTimer = setInterval(() => {
        const s = Math.floor((Date.now() - gestureStartRef.current) / 1000)
        setElapsed(s)
        if (s >= 8) clearInterval(elapsedTimer)
      }, 250)
      ;(canvas as any)._elapsedTimer = elapsedTimer
    }

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current || disabled) return
      e.preventDefault()
      const ev = 'touches' in e ? e.touches[0] : (e as MouseEvent)
      const { cx, cy, nx, ny, pressure } = getXY(ev)
      const now  = Date.now()
      const x    = Math.max(0, Math.min(1, nx))
      const y    = Math.max(0, Math.min(1, ny))

      checkChallengeTap(x, y, now)

      if (!challengeRef.current.active) {
        ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 3
        ctx.lineTo(cx, cy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, cy)
      }
      traceRef.current.push({ cx, cy, start: false })

      const dt   = now - lastRecordedRef.current
      const last = lastPosRef.current
      const dist = last ? Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2) : 1
      if (dt >= THROTTLE_MS || dist >= MIN_DIST * 3) {
        pushPoint(x, y, pressure)
      }
    }

    const onEnd = () => {
      if (!isDrawingRef.current) return
      const elapsed = Date.now() - gestureStartRef.current
      // If gesture is too short — keep drawing, show hint
      if (elapsed < 8000) {
        return  // don't stop — user needs to keep drawing
      }
      isDrawingRef.current = false
      setIsDrawing(false)
      stopPauseTimer()
      cancelAnimationFrame(animFrameRef.current)
      if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current)
      // If challenge still active when gesture ends — mark as missed
      const ch = challengeRef.current
      if (ch.active && !ch.resolved) {
        ch.completed.push({
          dot_x:       ch.dot_x,
          dot_y:       ch.dot_y,
          shown_at_ms: ch.shown_at - gestureStartRef.current,
          reaction_ms: null,
          tap_x:       null,
          tap_y:       null,
          passed:      false,
          color:       DOT_PALETTE[ch.colorIdx]?.label ?? 'yellow',
        })
        ch.active   = false
        ch.resolved = true
      }
      if (eventsRef.current.length >= 10) {
        setIsDone(true)
        onComplete(eventsRef.current, ch.completed)
      }
    }

    canvas.addEventListener('mousedown',  onStart)
    canvas.addEventListener('mousemove',  onMove)
    canvas.addEventListener('mouseup',    onEnd)
    canvas.addEventListener('mouseleave', onEnd)
    canvas.addEventListener('touchstart', onStart,  { passive: false })
    canvas.addEventListener('touchmove',  onMove,   { passive: false })
    canvas.addEventListener('touchend',   onEnd)

    return () => {
      canvas.removeEventListener('mousedown',  onStart)
      canvas.removeEventListener('mousemove',  onMove)
      canvas.removeEventListener('mouseup',    onEnd)
      canvas.removeEventListener('mouseleave', onEnd)
      canvas.removeEventListener('touchstart', onStart)
      canvas.removeEventListener('touchmove',  onMove)
      canvas.removeEventListener('touchend',   onEnd)
      stopPauseTimer()
      cancelAnimationFrame(animFrameRef.current)
      if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, isDone, onComplete])

  const reset = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    eventsRef.current    = []
    traceRef.current     = []
    challengeRef.current = { active: false, resolved: false, dot_x: 0, dot_y: 0, cx: 0, cy: 0, shown_at: 0, colorIdx: -1, total: 1, index: 0, completed: [] }
    cancelAnimationFrame(animFrameRef.current)
    if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current)
    setPointCount(0)
    setIsDone(false)
  }

  // Dot progress label above canvas
  const progressBar = isDrawing && dotTotal > 0 ? (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 10, background: '#f0fdf4', border: '1.5px solid #86efac', marginBottom: 4 }}>
      <span style={{ fontSize: 15 }}>🎯</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 3 }}>
          {dotActive
            ? `Нажми на точку! (${dotsHit + 1} из ${dotTotal})`
            : dotsHit >= dotTotal
              ? `✓ Все ${dotTotal} точки отмечены!`
              : `Жди следующую точку… (${dotsHit} из ${dotTotal} отмечено)`}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: dotTotal }).map((_, i) => (
            <div key={i} style={{
              height: 6, flex: 1, borderRadius: 99,
              background: i < dotsHit ? '#22c55e' : dotActive && i === dotsHit ? dotColor : '#d1fae5',
              transition: 'background 0.3s',
            }} />
          ))}
        </div>
      </div>
    </div>
  ) : isDrawing ? (
    <div style={{ width: '100%', padding: '7px 12px', borderRadius: 10, background: '#f8fafc', border: '1.5px solid #e2e8f0', marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
        <span>✏️ {elapsed < 8 ? 'Продолжай рисовать…' : '✓ Можно отпустить'}</span>
        <span style={{ fontWeight: 700, color: elapsed >= 8 ? '#16a34a' : '#64748b' }}>{elapsed}/8 сек</span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99,
          background: elapsed >= 8 ? '#16a34a' : '#3b82f6',
          width: `${Math.min(100, (elapsed / 8) * 100)}%`,
          transition: 'width 0.25s ease',
        }} />
      </div>
    </div>
  ) : null

  return (
    <div className="flex flex-col items-center gap-3">
      {progressBar}
      <canvas
        ref={canvasRef}
        className={[
          'gesture-canvas w-full rounded-xl',
          'border-2 transition-colors',
          disabled ? 'opacity-50 cursor-not-allowed border-slate-300 bg-slate-100' :
          isDone   ? 'border-green-500 bg-white' :
                     'border-blue-400 bg-white hover:border-blue-600',
        ].join(' ')}
        style={{ height: 'clamp(220px, 45vh, 360px)', width: '100%', maxWidth: '100%', display: 'block', boxSizing: 'border-box', touchAction: 'none' }}
      />

      {/* Dot hint — appears when challenge dot is shown */}
      {dotActive && (
        <div style={{
          width: '100%', textAlign: 'center',
          padding: '8px 14px', borderRadius: 10,
          background: `${dotColor}22`,
          border: `2px solid ${dotColor}`,
          fontSize: 14, fontWeight: 700, color: dotColor,
          animation: 'pulse-hint 0.4s ease-out',
        }}>
          👆 Нажми на цветную точку не отрывая руку!
        </div>
      )}

      <div className="w-full flex items-center justify-between text-sm">
        <span className="text-slate-500">
          {isDone
            ? `✓ ${pointCount} точек — готово`
            : pointCount > 0
              ? `${pointCount} точек...`
              : disabled ? '' : '✏️  рисуй здесь мышью или пальцем'}
        </span>
        <button
          onClick={reset}
          disabled={disabled}
          className="text-slate-500 hover:text-slate-300 underline text-xs disabled:opacity-30"
        >
          очистить
        </button>
      </div>
    </div>
  )
}
