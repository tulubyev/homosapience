'use client'
import { useState } from 'react'
import type { ApiKey } from '@/lib/consoleApi'

/**
 * Site self-service setup for the gesture-CAPTCHA widget: pick one of the owner's
 * keys, copy the 2-line embed snippet + the server-side /siteverify snippet, open
 * the live demo. The secret key is never in the key list (shown once at creation),
 * so the server snippet uses an `sk_live_…` placeholder.
 */

const BASE = 'https://homosapience.org'

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }).catch(() => {})}
      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer', color: ok ? '#16a34a' : '#374151', flexShrink: 0 }}
    >{ok ? '✓ Copied' : 'Copy'}</button>
  )
}

function Block({ label, code }: { label: string; code: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>{label}</span>
        <Copy text={code} />
      </div>
      <pre style={{ margin: 0, background: '#0f172a', color: '#e2e8f0', borderRadius: 10, padding: '12px 14px', fontSize: 12, lineHeight: 1.55, overflowX: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{code}</pre>
    </div>
  )
}

export default function CaptchaSetupSection({ keys }: { keys: ApiKey[] }) {
  const active = keys.filter(k => k.active)
  const [sel, setSel] = useState(0)
  const key = active[sel]

  const embed = key
    ? `<script src="${BASE}/embed/v2/aptogon.js"></script>\n\n<form action="/signup" method="post">\n  <!-- your fields … -->\n  <div data-aptogon-captcha data-aptogon-key="${key.publishable_key}"></div>\n  <button type="submit">Sign up</button>\n</form>`
    : ''

  const server = key
    ? `# Your backend, after the form POSTs "aptogon-response":\ncurl -s ${BASE}/api/captcha/siteverify \\\n  -H "Authorization: Bearer sk_live_YOUR_SECRET" \\\n  -H "Content-Type: application/json" \\\n  -d '{"token":"<aptogon-response from the form>"}'\n\n# → {"success":true,"human":true,"band":"…","hostname":"https://your-site.com"}`
    : ''

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#111827' }}>🛡️ Gesture CAPTCHA — embed on your site</h2>
        <a href={`${BASE}/embed/captcha-demo.html`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', textDecoration: 'none' }}>Open live demo →</a>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>
        Draw-a-gesture instead of image grids. No image sets, no tracking, no biometrics.
      </p>

      {active.length === 0 ? (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#92400e', lineHeight: 1.6 }}>
          To get started: <b>verify your domain</b> (Domains panel) and <b>create an API key</b> with that
          domain in its allowed origins (API Keys panel). Your <code>sk_live_…</code> is shown once — keep it safe.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 700 }}>Key</span>
            <select value={sel} onChange={e => setSel(Number(e.target.value))}
              style={{ fontSize: 13, padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db', background: '#f9fafb' }}>
              {active.map((k, i) => <option key={k.id} value={i}>{k.name} · {k.publishable_key.slice(0, 20)}…</option>)}
            </select>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              origins: {key.allowed_origins.length ? key.allowed_origins.join(', ') : '⚠ none — add your domain to this key'}
            </span>
          </div>

          <Block label="1 · Paste into your page (HTML)" code={embed} />
          <Block label="2 · Validate the token on your server (S2S)" code={server} />

          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
            The widget adds a hidden <code>input[name=&quot;aptogon-response&quot;]</code> to your form on success.
            Verify it with your <code>sk_live_…</code> (never expose the secret in client code). Free tier:
            {' '}{key.monthly_cap ? key.monthly_cap.toLocaleString() : '1,000'} verifications/month.
          </p>
        </>
      )}
    </div>
  )
}
