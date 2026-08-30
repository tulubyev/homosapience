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
  challenge_token?: string // Phase 3: server-issued one-shot token
}

export interface GestureLabels {
  dotTap: (current: number, total: number) => string
  dotAllDone: (total: number) => string
  dotWait: (done: number, total: number) => string
  keepDrawing: string
  release: string
  tapHint: string
  pointsDone: (count: number) => string
  pointsCount: (count: number) => string
  drawHint: string
  sec: string
  clear: string
  lifted: string
  restarted: string
}

export const DEFAULT_LABELS: GestureLabels = {
  dotTap:      (c, t) => `Tap the dot! (${c} of ${t})`,
  dotAllDone:  (t)    => `✓ All ${t} dots hit!`,
  dotWait:     (d, t) => `Waiting for next dot… (${d} of ${t} hit)`,
  keepDrawing: 'Keep drawing…',
  release:     '✓ You can release now',
  tapHint:     '👆 Tap the colored dot without lifting your hand!',
  pointsDone:  (c)    => `✓ ${c} points — done`,
  pointsCount: (c)    => `${c} points…`,
  drawHint:    '✏️ draw here with mouse or finger',
  sec:         'sec',
  clear:       'clear',
  lifted:      '✋ Paused — touch the pad again to carry on',
  restarted:   '↻ That pause was too long — starting over',
}

interface Props {
  onComplete: (events: TouchEventData[], challenges: ChallengeResult[]) => void
  disabled?: boolean
  labels?: GestureLabels
  /** Render the progress bars BELOW the canvas instead of above it. The bars only
   *  appear once drawing starts; placed above, their sudden height pushes the
   *  canvas down mid-stroke, so the point under the cursor jumps out from under it.
   *  Below the canvas, the canvas stays put and only the content beneath it grows.
   *  Both surfaces now pass it: /verify kept the bars on top and hit exactly that
   *  jump — ~169px of bars appearing on first contact, dragging the canvas out
   *  from under the pointer so the stroke started somewhere the user did not aim.
   *  Reserving the space instead just traded the jump for a block of blank page. */
  progressBelowCanvas?: boolean
  /** Hide the "clear" reset button (compact embed): a failed check restarts the
   *  whole gesture from the parent, so an in-canvas reset is redundant. */
  hideClear?: boolean
}

// Record a point at most every THROTTLE_MS ms
const THROTTLE_MS    = 45
const MIN_DIST       = 0.004
const PAUSE_POLL_MS  = 120

// ── Pen lifts ────────────────────────────────────────────────────────────────
// Lifting the finger/cursor mid-gesture is HUMAN behaviour, not a failure: bots
// synthesising an event stream emit one unbroken line. So a lift suspends the
// gesture instead of silently wiping it, and — critically — the pause timer
// stops fabricating points while the pen is up. Those fabricated points used to
// land at a fixed coordinate on a flat 120ms cadence, which reads as zero
// corrections + zero velocity + regular timing: the exact bot signature the
// classifier looks for (sapix/expression_engine.py). A real lift now surfaces
// as ONE honest large pause_after_ms on the resume point, which the backend
// already treats as a human signal.
const LIFT_ABANDON_MS   = 10_000  // a single lift longer than this abandons the gesture
const MAX_LIFTS         = 8       // anti-abuse: cap how many lifts one gesture may contain
const MAX_TOTAL_LIFT_MS = 20_000  // anti-abuse: cumulative lift budget per gesture
const RESTART_NOTICE_MS = 7_000   // how long "we restarted you" stays readable

// Server-enforced floor (routers/verify.py). Drawing past it is allowed — the
// gesture ends when the pen is released — but the counter stops climbing, since
// "12/8 sec" reads as a broken widget rather than as extra credit.
const MIN_GESTURE_SEC   = 8

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

export function GestureCanvas({ onComplete, disabled = false, labels: L = DEFAULT_LABELS, progressBelowCanvas = false, hideClear = false }: Props) {
  const canvasRef       = useRef<HTMLCanvasElement>(null)
  const eventsRef       = useRef<TouchEventData[]>([])
  const gestureStartRef = useRef<number>(0)
  const lastRecordedRef = useRef<number>(0)
  const lastPosRef      = useRef<{ x: number; y: number } | null>(null)
  // isDrawingRef = a gesture session is open (survives pen lifts).
  // penDownRef   = the finger/cursor is physically on the pad right now.
  // Keeping these apart is what lets a lift suspend the gesture rather than
  // wipe it, and what stops the pause timer fabricating points mid-lift.
  const isDrawingRef    = useRef(false)
  const penDownRef      = useRef(false)
  const pauseTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const challengeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abandonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Deliberately NOT cleared by clearTimers(): the "we restarted you" notice has
  // to outlive the next touch, or it vanishes the instant the user reacts to it.
  const restartMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animFrameRef    = useRef<number>(0)
  const sseRef          = useRef<EventSource | null>(null)
  // Active drawing time only — wall-clock would let someone hold the pen off the
  // pad to run the 8s floor down without drawing anything.
  const activeDrawMsRef = useRef(0)
  const penDownAtRef    = useRef(0)
  const liftStartRef    = useRef(0)
  const liftCountRef    = useRef(0)
  const totalLiftMsRef  = useRef(0)
  const [isDone, setIsDone]         = useState(false)
  const [pointCount, setPointCount] = useState(0)
  const [dotActive, setDotActive]   = useState(false)
  const [dotColor, setDotColor]     = useState('')
  const [dotTotal, setDotTotal]     = useState(0)
  const [dotsHit, setDotsHit]       = useState(0)
  const [isDrawing, setIsDrawing]   = useState(false)
  const [isLifted, setIsLifted]     = useState(false)
  const [wasRestarted, setWasRestarted] = useState(false)
  const [elapsed, setElapsed]       = useState(0)  // seconds of ACTIVE drawing

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
    token:     string | null  // Phase 3: server-issued challenge token
    // Multi-challenge tracking
    total:     number    // how many dots to show this gesture
    index:     number    // current dot index (0-based)
    completed: ChallengeResult[]
  }>({ active: false, resolved: false, dot_x: 0, dot_y: 0, cx: 0, cy: 0, shown_at: 0, colorIdx: 0, token: null, total: 1, index: 0, completed: [] })

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

    // ── Resolve current challenge ──────────────────────────────────────────────
    const resolveChallenge = (result: ChallengeResult) => {
      const ch = challengeRef.current
      ch.active   = false
      ch.resolved = true
      ch.completed.push({ ...result, challenge_token: ch.token ?? undefined })
      ch.index++
      ch.token    = null
      setDotActive(false)
      setDotColor('')
      if (result.reaction_ms !== null) setDotsHit(h => h + 1)
      redrawTrace(ctx, canvas)
      // If more dots remain (second dot is always client-side), schedule it
      if (ch.index < ch.total && isDrawingRef.current) {
        const margin = 0.18
        const delay  = CHALLENGE_BETWEEN_MIN + Math.random() * (CHALLENGE_BETWEEN_MAX - CHALLENGE_BETWEEN_MIN)
        challengeTimerRef.current = setTimeout(() => {
          if (!isDrawingRef.current) return
          const dot_x = margin + Math.random() * (1 - margin * 2)
          const dot_y = margin + Math.random() * (1 - margin * 2)
          showChallengeDot(dot_x, dot_y, null)
        }, delay)
      }
    }

    // ── Show challenge dot at server-provided (or fallback client) coords ─────
    const showChallengeDot = (dot_x: number, dot_y: number, token: string | null) => {
      const ch = challengeRef.current
      if (!isDrawingRef.current) return
      syncSize(canvas)
      const px = dot_x * canvas.width
      const py = dot_y * canvas.height
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
      ch.token     = token
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

    // ── Open SSE to get server-issued challenge dot ────────────────────────────
    // Phase 3: server controls timing (2.5–4.5s) and coordinates so bots
    // cannot fabricate challenge responses without a valid Redis token.
    // Falls back to a client-side dot if SSE fails (network error / no Redis).
    const openSSEChallenge = () => {
      const ch = challengeRef.current
      ch.completed = []
      ch.colorIdx  = -1
      ch.token     = null
      ch.total     = 2   // first dot from SSE, second scheduled client-side
      ch.index     = 0
      setDotsHit(0)
      setDotTotal(2)

      if (sseRef.current) { sseRef.current.close(); sseRef.current = null }

      try {
        const sse = new EventSource('/api/verify/challenge-stream')
        sseRef.current = sse

        sse.addEventListener('challenge', (e: MessageEvent) => {
          if (!isDrawingRef.current) { sse.close(); sseRef.current = null; return }
          try {
            const data = JSON.parse(e.data) as { challenge_token: string; dot_x: number; dot_y: number }
            showChallengeDot(data.dot_x, data.dot_y, data.challenge_token)
          } catch { /* malformed SSE payload — ignore */ }
          sse.close()
          sseRef.current = null
        })

        sse.onerror = () => {
          sse.close()
          sseRef.current = null
          // Fallback: client-side random dot after brief delay
          const margin = 0.18
          const delay = CHALLENGE_DELAY_MIN + Math.random() * (CHALLENGE_DELAY_MAX - CHALLENGE_DELAY_MIN)
          challengeTimerRef.current = setTimeout(() => {
            if (!isDrawingRef.current) return
            const dot_x = margin + Math.random() * (1 - margin * 2)
            const dot_y = margin + Math.random() * (1 - margin * 2)
            showChallengeDot(dot_x, dot_y, null)
          }, delay)
        }
      } catch {
        // EventSource not supported — no challenge this gesture
      }
    }

    const startPauseTimer = () => {
      if (pauseTimerRef.current) clearInterval(pauseTimerRef.current)
      pauseTimerRef.current = setInterval(() => {
        // Only while the pen is actually DOWN. A held-still finger is a real
        // pause worth sampling; a lifted one is not — fabricating points during
        // a lift buries the gesture under a fixed-coordinate, flat-cadence block
        // that scores as a bot. The lift is recorded instead as a single honest
        // pause_after_ms on the resume point.
        if (!isDrawingRef.current || !penDownRef.current) return
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

    /** Drawing time only, excluding any stretch where the pen was lifted. */
    const activeMs = () =>
      activeDrawMsRef.current + (penDownRef.current ? Date.now() - penDownAtRef.current : 0)

    const clearTimers = () => {
      stopPauseTimer()
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
      if (abandonTimerRef.current) { clearTimeout(abandonTimerRef.current); abandonTimerRef.current = null }
      if (challengeTimerRef.current) { clearTimeout(challengeTimerRef.current); challengeTimerRef.current = null }
      cancelAnimationFrame(animFrameRef.current)
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
    }

    /** Give up on the current gesture and tell the user why — the old code wiped
     *  everything silently, so a lift looked like the pad had simply forgotten. */
    const abandonGesture = () => {
      isDrawingRef.current = false
      penDownRef.current   = false
      clearTimers()
      setIsDrawing(false)
      setIsLifted(false)
      setWasRestarted(true)
      // Dismiss on a timer, never on the next touch — the user is reaching for
      // the pad exactly when they are trying to read this.
      if (restartMsgTimerRef.current) clearTimeout(restartMsgTimerRef.current)
      restartMsgTimerRef.current = setTimeout(() => setWasRestarted(false), RESTART_NOTICE_MS)
      eventsRef.current = []
      traceRef.current  = []
      setPointCount(0)
      setElapsed(0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    /** Pen came back down while a gesture was still open. */
    const resumeFromLift = (cx: number, cy: number) => {
      const now  = Date.now()
      const lift = now - liftStartRef.current
      liftCountRef.current  += 1
      totalLiftMsRef.current += lift
      if (abandonTimerRef.current) { clearTimeout(abandonTimerRef.current); abandonTimerRef.current = null }

      if (liftCountRef.current > MAX_LIFTS || totalLiftMsRef.current > MAX_TOTAL_LIFT_MS) {
        abandonGesture()
        return false
      }
      penDownRef.current  = true
      penDownAtRef.current = now
      setIsLifted(false)
      // New subpath: the pen was off the pad, so the trail must not draw a
      // straight line across the gap.
      ctx.beginPath(); ctx.moveTo(cx, cy)
      traceRef.current.push({ cx, cy, start: true })
      return true
    }

    const beginGesture = (e: MouseEvent | TouchEvent) => {
      isDrawingRef.current = true
      penDownRef.current   = true
      setIsDrawing(true)
      setIsLifted(false)
      // wasRestarted is left alone here on purpose — see restartMsgTimerRef.
      eventsRef.current    = []
      traceRef.current     = []
      gestureStartRef.current  = Date.now()
      penDownAtRef.current     = Date.now()
      activeDrawMsRef.current  = 0
      liftCountRef.current     = 0
      totalLiftMsRef.current   = 0
      lastRecordedRef.current  = 0
      lastPosRef.current       = null
      challengeRef.current     = { active: false, resolved: false, dot_x: 0, dot_y: 0, cx: 0, cy: 0, shown_at: 0, colorIdx: -1, token: null, total: 1, index: 0, completed: [] }
      clearTimers()
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
      openSSEChallenge()
      // Progress bar ticks on ACTIVE drawing time, so it visibly freezes while
      // the pen is up instead of quietly running the floor down.
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Math.min(MIN_GESTURE_SEC, Math.floor(activeMs() / 1000)))
      }, 250)
    }

    const onStart = (e: MouseEvent | TouchEvent) => {
      if (disabled || isDone) return
      e.preventDefault()
      // Pen returning after a lift resumes the gesture; only a genuinely fresh
      // start wipes the buffer.
      if (isDrawingRef.current && !penDownRef.current) {
        const ev = 'touches' in e ? e.touches[0] : (e as MouseEvent)
        const { cx, cy } = getXY(ev)
        resumeFromLift(cx, cy)
        return
      }
      beginGesture(e)
    }

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current || disabled) return
      const isTouch = 'touches' in e
      // Re-entering the pad with the button still held (the cursor left the
      // canvas and came back) never fires mousedown — resume here instead, or
      // the gesture would sit stuck in the lifted state while the user draws.
      if (!penDownRef.current) {
        const held = isTouch ? true : (e as MouseEvent).buttons > 0
        if (!held) return  // just hovering after a lift
        const evt = isTouch ? (e as TouchEvent).touches[0] : (e as MouseEvent)
        const p = getXY(evt)
        if (!resumeFromLift(p.cx, p.cy)) return
      }
      e.preventDefault()
      const ev = isTouch ? (e as TouchEvent).touches[0] : (e as MouseEvent)
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
      if (!isDrawingRef.current || !penDownRef.current) return
      // Bank the stretch that just ended before judging whether we are done.
      activeDrawMsRef.current += Date.now() - penDownAtRef.current
      penDownRef.current = false

      const allDotsDone = challengeRef.current.index >= challengeRef.current.total
      // The 8s floor is measured on active drawing time (the server re-checks it
      // from the event timestamps in routers/verify.py). Finishing the dots early
      // must not bypass it, or the gesture is rejected as gesture_too_short.
      if (!allDotsDone || activeDrawMsRef.current < 8000) {
        // Not done — this is a lift, not the end. Hold the gesture open.
        liftStartRef.current = Date.now()
        setIsLifted(true)
        abandonTimerRef.current = setTimeout(abandonGesture, LIFT_ABANDON_MS)
        return
      }
      isDrawingRef.current = false
      setIsDrawing(false)
      setIsLifted(false)
      clearTimers()
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

    /** The cursor crossing the canvas edge is NOT a pen lift — the button is
     *  still down and the person is still drawing. Counting it as one meant that
     *  drawing energetically near the edges racked up "lifts" and eventually
     *  tripped the abandon limit mid-stroke, with the pen never leaving the pad.
     *  A release outside the canvas is caught by the window-level mouseup below. */
    const onLeave = (e: MouseEvent) => {
      if (e.buttons > 0) return
      onEnd()
    }

    canvas.addEventListener('mousedown',   onStart)
    canvas.addEventListener('mousemove',   onMove)
    canvas.addEventListener('mouseup',     onEnd)
    canvas.addEventListener('mouseleave',  onLeave)
    // Releasing outside the canvas fires no mouseup on it, so listen at window
    // level too — that is the case mouseleave used to (wrongly) stand in for.
    window.addEventListener('mouseup',     onEnd)
    canvas.addEventListener('touchstart',  onStart,  { passive: false })
    canvas.addEventListener('touchmove',   onMove,   { passive: false })
    canvas.addEventListener('touchend',    onEnd)
    // touchcancel fires — and touchend does NOT — when the OS takes the gesture
    // away (incoming call, edge-swipe, palm rejection). Without this the
    // component sat in the drawing state forever.
    canvas.addEventListener('touchcancel', onEnd)

    return () => {
      canvas.removeEventListener('mousedown',   onStart)
      canvas.removeEventListener('mousemove',   onMove)
      canvas.removeEventListener('mouseup',     onEnd)
      canvas.removeEventListener('mouseleave',  onLeave)
      window.removeEventListener('mouseup',     onEnd)
      canvas.removeEventListener('touchstart',  onStart)
      canvas.removeEventListener('touchmove',   onMove)
      canvas.removeEventListener('touchend',    onEnd)
      canvas.removeEventListener('touchcancel', onEnd)
      clearTimers()
      if (restartMsgTimerRef.current) clearTimeout(restartMsgTimerRef.current)
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
    challengeRef.current = { active: false, resolved: false, dot_x: 0, dot_y: 0, cx: 0, cy: 0, shown_at: 0, colorIdx: -1, token: null, total: 1, index: 0, completed: [] }
    isDrawingRef.current    = false
    penDownRef.current      = false
    activeDrawMsRef.current = 0
    liftCountRef.current    = 0
    totalLiftMsRef.current  = 0
    cancelAnimationFrame(animFrameRef.current)
    if (challengeTimerRef.current) { clearTimeout(challengeTimerRef.current); challengeTimerRef.current = null }
    if (abandonTimerRef.current)   { clearTimeout(abandonTimerRef.current);   abandonTimerRef.current = null }
    if (elapsedTimerRef.current)   { clearInterval(elapsedTimerRef.current);  elapsedTimerRef.current = null }
    if (pauseTimerRef.current)     { clearInterval(pauseTimerRef.current);    pauseTimerRef.current = null }
    if (restartMsgTimerRef.current){ clearTimeout(restartMsgTimerRef.current); restartMsgTimerRef.current = null }
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
    setPointCount(0)
    setIsDrawing(false)
    setIsLifted(false)
    setWasRestarted(false)
    setElapsed(0)
    setIsDone(false)
  }

  // Dot progress (challenge taps) — shown above the time progress bar, not
  // instead of it: the 8s floor applies regardless of how fast dots resolve.
  const dotsBar = isDrawing && dotTotal > 0 ? (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 10, background: '#f0fdf4', border: '1.5px solid #86efac', marginBottom: 4 }}>
      <span style={{ fontSize: 15 }}>🎯</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 3 }}>
          {dotActive
            ? L.dotTap(dotsHit + 1, dotTotal)
            : dotsHit >= dotTotal
              ? L.dotAllDone(dotTotal)
              : L.dotWait(dotsHit, dotTotal)}
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
  ) : null

  // Time progress bar — always shown while drawing, underneath the dots bar.
  const timeBar = isDrawing ? (
    <div style={{ width: '100%', padding: '7px 12px', borderRadius: 10, background: '#f8fafc', border: '1.5px solid #e2e8f0', marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
        <span>✏️ {elapsed < MIN_GESTURE_SEC ? L.keepDrawing : L.release}</span>
        <span style={{ fontWeight: 700, color: elapsed >= MIN_GESTURE_SEC ? '#16a34a' : '#64748b' }}>{elapsed}/{MIN_GESTURE_SEC} {L.sec}</span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99,
          background: elapsed >= MIN_GESTURE_SEC ? '#16a34a' : '#3b82f6',
          width: `${Math.min(100, (elapsed / MIN_GESTURE_SEC) * 100)}%`,
          transition: 'width 0.25s ease',
        }} />
      </div>
    </div>
  ) : null

  // Lifting the pen used to wipe the gesture with no explanation at all. Say so
  // out loud, and say that the progress is still there.
  const liftBanner = isLifted ? (
    <div style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px', borderRadius: 10,
      background: '#fffbeb', border: '1.5px solid #fcd34d',
      fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 4,
    }}>
      {L.lifted}
    </div>
  ) : null

  const restartBanner = wasRestarted ? (
    <div style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px', borderRadius: 10,
      background: '#fef2f2', border: '1.5px solid #fca5a5',
      fontSize: 12, fontWeight: 700, color: '#b91c1c', marginBottom: 4,
    }}>
      {L.restarted}
    </div>
  ) : null

  const progressBar = (dotsBar || timeBar) ? (
    <>
      {dotsBar}
      {timeBar}
    </>
  ) : null

  return (
    <div className="flex flex-col items-center gap-3">
      {!progressBelowCanvas && progressBar}
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

      {progressBelowCanvas && progressBar}

      {/* Notices sit BELOW the canvas: over it they hid the start of the stroke,
          and above it they would push the canvas down mid-gesture. Content that
          grows downward disturbs nothing already drawn. */}
      {liftBanner}
      {restartBanner}

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
          {L.tapHint}
        </div>
      )}

      <div className="w-full flex items-center justify-between text-sm">
        <span className="text-slate-500">
          {isDone
            ? L.pointsDone(pointCount)
            : pointCount > 0
              ? L.pointsCount(pointCount)
              : disabled ? '' : L.drawHint}
        </span>
        {!hideClear && (
          <button
            onClick={reset}
            disabled={disabled}
            className="text-slate-500 hover:text-slate-300 underline text-xs disabled:opacity-30"
          >
            {L.clear}
          </button>
        )}
      </div>
    </div>
  )
}
