'use client'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { GestureCanvas, GestureLabels, TouchEventData, ChallengeResult } from '@/components/GestureCanvas'
import enMessages from '../../../../messages/en.json'

// ── i18n ────────────────────────────────────────────────────────────────────
// The widget lives on third-party sites, so it should speak the VISITOR's language,
// not ours. We reuse the site's own `verify` translations (canvas_* for the gesture,
// embed_* for the widget chrome) — same strings the first-party /verify page uses —
// picked by navigator.language. English is the built-in fallback (statically
// imported so the first paint is never blank); other locales load on mount.

type Dict = Record<string, string>
const EN: Dict = enMessages.verify as unknown as Dict
const LOCALES = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'ja', 'zh', 'hi', 'ar', 'he']
const RTL = new Set(['ar', 'he'])

function pickLocale(): string {
  const langs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []
  for (const l of langs) {
    const base = String(l).toLowerCase().split('-')[0]
    if (LOCALES.includes(base)) return base
  }
  return 'en'
}

/** Minimal ICU placeholder fill: replaces {name} with params[name]. */
function fmt(s: string, p?: Record<string, string | number>): string {
  if (!s) return ''
  if (!p) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''))
}

/** Build GestureCanvas labels from a locale dict (drawHint blanked — the embed
 *  shows its own instruction above the canvas). */
function makeLabels(d: Dict): GestureLabels {
  return {
    dotTap:      (c, tot) => fmt(d.canvas_dot_tap,       { current: c, total: tot }),
    dotAllDone:  (tot)    => fmt(d.canvas_dot_all_done,  { total: tot }),
    dotWait:     (dn, tot) => fmt(d.canvas_dot_wait,     { done: dn, total: tot }),
    keepDrawing: d.canvas_keep_drawing,
    release:     d.canvas_release,
    tapHint:     d.canvas_tap_hint,
    pointsDone:  (c)      => fmt(d.canvas_points_done,   { count: c }),
    pointsCount: (c)      => fmt(d.canvas_points_count,  { count: c }),
    drawHint:    '',
    sec:         d.canvas_sec,
    clear:       d.canvas_clear,
    lifted:      d.canvas_lifted,
    restarted:   d.canvas_restarted,
  }
}

/**
 * /embed/verify — inline gesture-CAPTCHA iframe (served from OUR origin).
 *
 * A customer site's loader (public/embed/v2/aptogon.js) injects this as an
 * <iframe> and listens for the token. Because the iframe runs on our origin,
 * its fetch to /api/captcha/verify is same-origin (no bot_shield cross-origin
 * block). The PARENT site is authenticated by pk ↔ allowed_origins server-side.
 *
 * Parent origin is resolved via a postMessage handshake (loader replies with
 * its origin), falling back to document.referrer. The token is posted back with
 * window.parent (iframe), not window.opener (popup).
 */

type Stage = 'gesture' | 'verifying' | 'done' | 'failed' | 'error'

/**
 * GestureCanvas styles itself with Tailwind utility classes, but this project
 * ships no PostCSS config — the `@tailwind` directives in globals.css are never
 * compiled, so those classes are inert (the app is styled with inline styles).
 * On the main site that only costs cosmetics; inside this iframe it breaks the
 * widget: transparent canvas over the dark body, and the hint/clear row collapses
 * to `display:block` so the button overlaps the label.
 *
 * The iframe is its own document, so re-declaring the handful of utilities the
 * component needs is scoped to the widget and cannot affect any other page. The
 * canvas is also shortened here to keep the embed compact on a customer's form.
 */
const WIDGET_CSS = `
  html, body { background: #fff; }
  .flex { display: flex }
  .flex-col { flex-direction: column }
  .items-center { align-items: center }
  .justify-between { justify-content: space-between }
  .gap-3 { gap: 4px }   /* tighter canvas-to-controls spacing in the compact embed */
  .w-full { width: 100% }
  .text-sm { font-size: 12px }
  .text-xs { font-size: 11px }
  .underline { text-decoration: underline }
  .text-slate-500 { color: #64748b }
  .rounded-xl { border-radius: 12px }
  .border-2 { border-width: 2px; border-style: solid }
  .border-blue-400 { border-color: #60a5fa }
  .border-green-500 { border-color: #22c55e }
  .border-slate-300 { border-color: #cbd5e1 }
  .bg-white { background: #fff }
  .bg-slate-100 { background: #f1f5f9 }
  .opacity-50 { opacity: .5 }
  .cursor-not-allowed { cursor: not-allowed }
  .gesture-canvas { height: 190px !important }
  button:disabled { opacity: .3 }
`

function originOf(url: string): string {
  try { return new URL(url).origin } catch { return '' }
}

/**
 * A site owner debugging their own embed sees this text and nothing else — the
 * server's reason never reaches their console. A single "unavailable" string for
 * every failure makes a wrong key indistinguishable from a wrong origin, which
 * are the two mistakes an integrator actually makes.
 */
function errorMessage(d: Dict, code: string): string {
  switch (code) {
    case 'invalid_key':                return d.embed_err_invalid_key
    case 'origin_not_allowed':         return d.embed_err_origin
    case 'invalid_or_used_challenge':  return d.embed_err_expired
    case 'automation_detected':        return d.embed_err_automation
    case 'classifier_unavailable':     return d.embed_err_classifier
    default:                           return d.embed_err_default
  }
}

function CaptchaInner() {
  const params = useSearchParams()
  const pk = params.get('pk') || ''
  const challengeId = params.get('c') || undefined

  const [stage, setStage] = useState<Stage>('gesture')
  const [msg, setMsg] = useState('')
  const [dict, setDict] = useState<Dict>(EN)
  const [locale, setLocale] = useState('en')
  // Bumped on every retry to remount a fresh GestureCanvas (its internal
  // done/points state resets only on mount).
  const [attempt, setAttempt] = useState(0)

  // Pick the visitor's language and load its strings (English is the built-in
  // fallback, so nothing flashes untranslated).
  useEffect(() => {
    const loc = pickLocale()
    setLocale(loc)
    if (loc === 'en') return
    import(`../../../../messages/${loc}.json`)
      .then(m => { const v = (m.default || m).verify; if (v) setDict(v as Dict) })
      .catch(() => { /* keep English */ })
  }, [])
  // Empty until mount: this component still server-renders, and `document` does
  // not exist there (reading it during render threw on every request).
  const parentOriginRef = useRef<string>('')
  const submittingRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Handshake: tell the parent loader we're ready; pin its origin from the reply.
  useEffect(() => {
    parentOriginRef.current = originOf(document.referrer)
    function onMsg(e: MessageEvent) {
      if (e?.data?.type === 'aptogon:host' && e.origin && e.origin !== 'null') {
        parentOriginRef.current = e.origin
        sendHeight()   // origin known — the loader can size us now
      }
    }
    window.addEventListener('message', onMsg)
    // The ready ping must be wildcard: the parent's origin is exactly what this
    // handshake is asking for. It carries no data beyond "I am mounted".
    // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
    try { window.parent.postMessage({ type: 'aptogon:ready' }, '*') } catch { /* no parent */ }

    // The content changes height mid-stage (progress bars/dot hint appear) and
    // between stages (the tall canvas gives way to a one-line result). Observe the
    // widget's own root and report every change so the loader tracks it — growing
    // AND shrinking.
    const ro = new ResizeObserver(() => sendHeight())
    if (rootRef.current) ro.observe(rootRef.current)

    return () => { window.removeEventListener('message', onMsg); ro.disconnect() }
  }, [])

  /** Post a height so the loader can size the iframe to the content (no scrollbars). */
  function sendHeight() {
    const target = parentOriginRef.current
    const el = rootRef.current
    if (!target || !el) return
    // Measure the widget root, NOT document.scrollHeight: the loader stretches the
    // iframe body to the iframe's height, so scrollHeight can never report a value
    // below the current iframe height — the widget could grow but never shrink.
    const h = Math.ceil(el.getBoundingClientRect().height)
    try { window.parent.postMessage({ type: 'aptogon:resize', height: h }, target) } catch { /* ignore */ }
  }

  function send(payload: Record<string, unknown>) {
    // Never broadcast a token: without a pinned parent origin we stay silent.
    // The customer's backend is the source of truth via /siteverify anyway, and
    // a wildcard target would hand the token to any frame that embeds us.
    const target = parentOriginRef.current
    if (!target) return
    try { window.parent.postMessage({ type: 'aptogon:verified', ...payload }, target) } catch { /* ignore */ }
  }

  // Return to a clean drawing surface after a failed/errored check. Without this
  // the widget was stuck on the red message with no canvas and no way back (the
  // clear button is hidden in the embed). Remounts GestureCanvas via `attempt`.
  function retry() {
    submittingRef.current = false
    setMsg('')
    setAttempt(a => a + 1)
    setStage('gesture')
  }

  const onGesture = async (events: TouchEventData[], challenges: ChallengeResult[]) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setStage('verifying'); setMsg(dict.embed_checking)
    try {
      const res = await fetch('/api/captcha/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publishable_key: pk,
          origin: parentOriginRef.current || undefined,
          challenge_id: challengeId,
          events,
          session_id: crypto.randomUUID(),
          challenges: challenges.length ? challenges.map(c => ({
            challenge_token: c.challenge_token,
            dot_x: c.dot_x, dot_y: c.dot_y, shown_at_ms: c.shown_at_ms,
            reaction_ms: c.reaction_ms, tap_x: c.tap_x, tap_y: c.tap_y, color: c.color,
          })) : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) {
        // FastAPI nests HTTPException payloads under `detail` — read both shapes.
        const code = data?.error || data?.detail?.error || 'verification_failed'
        setStage('error'); setMsg(errorMessage(dict, code))
        send({ error: code })
        submittingRef.current = false
        return
      }
      if (data.human) {
        setStage('done'); setMsg(dict.embed_verified)
      } else {
        setStage('failed'); setMsg(dict.embed_failed)
        submittingRef.current = false
      }
      // Always hand the token to the parent; siteverify is the source of truth.
      send({ token: data.token, human: data.human, band: data.band })
    } catch {
      setStage('error'); setMsg(dict.embed_network)
      send({ error: 'network' })
      submittingRef.current = false
    }
  }

  if (!pk) {
    return <p style={{ fontFamily: 'Inter,system-ui,sans-serif', padding: 16, color: '#dc2626', fontSize: 13 }}>{dict.embed_missing_key}</p>
  }

  // Footer "Protected by {brand} · …" — split around {brand} so APTOGON stays a link.
  const [protLead, protTail] = (dict.embed_protected || 'Protected by {brand}').split('{brand}')

  return (
    <div ref={rootRef} className="aptogon-embed" dir={RTL.has(locale) ? 'rtl' : 'ltr'} style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: 8, maxWidth: 380, margin: '0 auto' }}>
      {/* Static module constant — no interpolation, no user input reaches this. */}
      <style dangerouslySetInnerHTML={{ __html: WIDGET_CSS }} />
      {stage === 'gesture' ? (
        <>
          {/* The instruction sits above the canvas so it reads before drawing;
              the canvas's own bottom hint is blanked (EMBED_LABELS) so it is not
              duplicated. It names both rules a first-time user misses: keep the
              pointer down, and tap the two dots that appear. */}
          <p style={{ fontSize: 12, color: '#475569', margin: '0 0 8px', textAlign: 'center', fontWeight: 600 }}>
            {dict.embed_instruction}
          </p>
          <GestureCanvas key={attempt} onComplete={onGesture} labels={makeLabels(dict)} progressBelowCanvas hideClear />
        </>
      ) : (
        // Result stages carry no canvas — a compact line, so the iframe can shrink
        // to it (the ResizeObserver reports the smaller height and the loader
        // resizes down). Modest vertical margin keeps the collapsed widget tight.
        <div style={{ textAlign: 'center', margin: '14px 0' }}>
          <p style={{
            fontSize: 14, fontWeight: 700, margin: 0,
            color: stage === 'done' ? '#16a34a' : stage === 'error' || stage === 'failed' ? '#dc2626' : '#475569',
          }}>{msg}</p>
          {(stage === 'error' || stage === 'failed') && (
            <button onClick={retry} style={{
              marginTop: 10, padding: '6px 16px', fontSize: 13, fontWeight: 600,
              color: '#fff', background: '#7c3aed', border: 'none', borderRadius: 8, cursor: 'pointer',
            }}>{dict.embed_try_again}</button>
          )}
        </div>
      )}
      <p style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
        {protLead}<a href="https://homosapience.org" target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed', textDecoration: 'none' }}>APTOGON</a>{protTail}
      </p>
    </div>
  )
}

export default function CaptchaPage() {
  return (
    <>
      {/* globals.css paints the document dark (body { background: var(--hsi-dark) }),
          which flashed a black box behind the Suspense fallback before the widget
          mounted. Force the embed document white at the top level so it is white
          from the first server-rendered byte — the loader's iframe background is
          white too, so there is no flash. Static constant, no interpolation. */}
      <style dangerouslySetInnerHTML={{ __html: 'html,body{background:#fff}' }} />
      <Suspense fallback={<div style={{ minHeight: 300, background: '#fff' }} />}>
        <CaptchaInner />
      </Suspense>
    </>
  )
}
