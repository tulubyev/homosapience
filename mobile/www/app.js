// APTOGON mobile v1 — gesture verification + HumanCredential.
// The backend generates the DID server-side and returns it, so this bundle needs
// NO client-side crypto: capture gesture (+ challenge dots for anti-bot) → POST
// /api/verify/expression → securely store {did, private_key_b64} → show credential.

const API_BASE = 'https://homosapience.org';
const MIN_POINTS = 12;
const THROTTLE_MS = 45;

// Challenge dots (reaction-time + tap-accuracy anti-bot signals; mirrors web flow)
const CH_TOTAL = 2;
const CH_DELAY1 = 1500;        // ms after gesture start → first dot
const CH_GAP = 2500;          // ms after a dot resolves → next dot
const CH_TIMEOUT = 5000;      // ms a dot stays before it's marked missed
const CH_RADIUS = 0.075;      // normalized tap tolerance
const CH_COLORS = [
  { fill: '#ef4444', label: 'red' }, { fill: '#22c55e', label: 'green' },
  { fill: '#3b82f6', label: 'blue' }, { fill: '#f59e0b', label: 'amber' },
];

// ── Secure storage (Keychain/Keystore via plugin; localStorage fallback in browser)
const Secure = (() => {
  const cap = window.Capacitor;
  const plugin = cap && cap.Plugins && cap.Plugins.SecureStoragePlugin;
  return {
    async set(key, value) {
      if (plugin) { try { await plugin.set({ key, value }); return; } catch (e) {} }
      localStorage.setItem(key, value);
    },
    async get(key) {
      if (plugin) { try { return (await plugin.get({ key })).value; } catch (e) { return null; } }
      return localStorage.getItem(key);
    },
  };
})();

const pad = document.getElementById('pad');
const ctx = pad.getContext('2d');
const hint = document.getElementById('hint');
const submitBtn = document.getElementById('submit');
const dotEl = document.getElementById('dot');

let events = [];
let drawing = false;
let startTs = 0;
let lastTs = 0;
let lastPauseTs = 0;
let sending = false;

// Challenge state
let challenges = [];           // resolved ChallengeDTOs
let chIndex = 0;
let chActive = null;           // {x,y,shownAt,color} or null
let chTimer = null;
let chTimeoutTimer = null;

function sizeCanvas() {
  const r = pad.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  pad.width = r.width * dpr; pad.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#7c3aed';
}
window.addEventListener('resize', sizeCanvas);
sizeCanvas();

function norm(e) {
  const r = pad.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
  };
}

// ── Challenge dots ──────────────────────────────────────────────────────────
function scheduleDot(delay) {
  chTimer = setTimeout(showDot, delay);
}
function showDot() {
  if (chIndex >= CH_TOTAL || !startTs) return;
  const margin = 0.15;
  const x = margin + Math.random() * (1 - margin * 2);
  const y = margin + Math.random() * (1 - margin * 2);
  const color = CH_COLORS[Math.floor(Math.random() * CH_COLORS.length)];
  chActive = { x, y, shownAt: Date.now(), color };
  dotEl.style.left = (x * 100) + '%';
  dotEl.style.top = (y * 100) + '%';
  dotEl.style.background = color.fill;
  dotEl.classList.remove('hidden');
  hint.textContent = `Tap the ${color.label} dot — without lifting your finger!`;
  chTimeoutTimer = setTimeout(() => resolveDot(null, null, null), CH_TIMEOUT);
}
function resolveDot(reaction_ms, tap_x, tap_y) {
  if (!chActive) return;
  const a = chActive;
  challenges.push({
    dot_x: +a.x.toFixed(4), dot_y: +a.y.toFixed(4),
    shown_at_ms: a.shownAt - startTs,
    reaction_ms, tap_x, tap_y, color: a.color.label,
    passed: reaction_ms != null && reaction_ms >= 30 && reaction_ms <= 4500,
  });
  chActive = null; chIndex++;
  dotEl.classList.add('hidden');
  if (chTimeoutTimer) { clearTimeout(chTimeoutTimer); chTimeoutTimer = null; }
  if (chIndex < CH_TOTAL) scheduleDot(CH_GAP);
  refreshButton();
}
function checkTap(p, now) {
  if (!chActive) return;
  const d = Math.sqrt((p.x - chActive.x) ** 2 + (p.y - chActive.y) ** 2);
  if (d <= CH_RADIUS) resolveDot(now - chActive.shownAt, +p.x.toFixed(4), +p.y.toFixed(4));
}
function challengesDone() { return chIndex >= CH_TOTAL; }

// ── Pointer handlers ────────────────────────────────────────────────────────
function onDown(e) {
  e.preventDefault();
  drawing = true;
  const now = Date.now();
  if (!startTs) { startTs = now; scheduleDot(CH_DELAY1); }
  lastPauseTs = now;
  const p = norm(e);
  checkTap(p, now);
  ctx.beginPath(); ctx.moveTo(p.x * pad.clientWidth, p.y * pad.clientHeight);
  push(p, now);
}
function onMove(e) {
  if (!drawing) return;
  e.preventDefault();
  const now = Date.now();
  if (now - lastTs < THROTTLE_MS) return;
  const p = norm(e);
  checkTap(p, now);
  ctx.lineTo(p.x * pad.clientWidth, p.y * pad.clientHeight); ctx.stroke();
  push(p, now);
}
function onUp() { drawing = false; lastPauseTs = Date.now(); refreshButton(); }

function push(p, now) {
  const pause = events.length ? Math.max(0, now - lastPauseTs) : 0;
  events.push({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), pressure: +p.pressure.toFixed(3),
                timestamp_ms: now, pause_after_ms: pause });
  lastTs = now; lastPauseTs = now;
  refreshButton();
}

function refreshButton() {
  if (sending) return;
  const ready = events.length >= MIN_POINTS && challengesDone();
  submitBtn.disabled = !ready;
  if (!startTs) { submitBtn.textContent = 'Keep drawing…'; return; }
  if (ready) { submitBtn.textContent = '✦ Verify me'; hint.textContent = 'Done — tap Verify.'; }
  else if (!challengesDone()) { submitBtn.textContent = 'Keep drawing…'; }
  else { submitBtn.textContent = 'Draw a bit more…'; }
}
setInterval(() => { if (startTs && !sending) refreshButton(); }, 400);

pad.addEventListener('pointerdown', onDown, { passive: false });
pad.addEventListener('pointermove', onMove, { passive: false });
pad.addEventListener('pointerup', onUp);
pad.addEventListener('pointercancel', onUp);
pad.addEventListener('pointerleave', onUp);

// ── Submit → /api/verify/expression ─────────────────────────────────────────────
submitBtn.addEventListener('click', verify);

async function verify() {
  if (sending) return;
  sending = true; submitBtn.disabled = true; submitBtn.textContent = 'Analyzing…';
  hint.textContent = 'Sending gesture for AI analysis…';
  try {
    const res = await fetch(`${API_BASE}/api/verify/expression`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events,
        challenges,
        session_id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
        mode: 'public',
      }),
    });
    if (res.status === 409) return showError("This device already has a credential.");
    if (res.status === 429) return showError("Too many attempts. Try again later.");
    if (!res.ok) return showError(`Server error ${res.status}. Try again.`);
    const data = await res.json();
    if (data.passed && data.did) {
      await Secure.set('aptogon_did', data.did);
      if (data.private_key_b64) await Secure.set('aptogon_key', data.private_key_b64);
      showCredential(data);
    } else {
      showError(data.reasoning || 'Not recognized as human. Draw longer, vary rhythm.');
      resetDraw();
    }
  } catch (e) {
    showError('Network error. Check your connection and try again.');
    resetDraw();
  } finally {
    sending = false;
  }
}

function resetDraw() {
  events = []; challenges = []; chIndex = 0; chActive = null; startTs = 0; sending = false;
  if (chTimer) clearTimeout(chTimer);
  if (chTimeoutTimer) clearTimeout(chTimeoutTimer);
  dotEl.classList.add('hidden');
  ctx.clearRect(0, 0, pad.width, pad.height);
  refreshButton();
}

function el(id) { return document.getElementById(id); }

function showCredential(d) {
  el('draw').classList.add('hidden');
  const r = el('result'); r.classList.remove('hidden');
  const until = d.credential && d.credential.expirationDate
    ? d.credential.expirationDate.slice(0, 10) : '~30 days';
  r.innerHTML = `
    <div style="text-align:center;font-size:40px">✦</div>
    <h2 class="ok" style="text-align:center;margin:4px 0 12px">Verified human</h2>
    <div class="row" style="flex-direction:column;gap:10px">
      <div class="field"><div class="k">DID</div><div class="v">${escapeHtml(d.did)}</div></div>
      <div class="row">
        <div class="field"><div class="k">Trust</div><div class="v">${escapeHtml(d.trust_label || 'newcomer')}</div></div>
        <div class="field"><div class="k">Valid until</div><div class="v">${escapeHtml(until)}</div></div>
      </div>
    </div>
    <p class="hint">Your key is stored securely on this device. Anchored on Aptos${d.tx_hash ? ' ✓' : ''}.</p>
  `;
}

function showError(msg) {
  hint.innerHTML = `<span class="err">${escapeHtml(msg)}</span>`;
  submitBtn.disabled = false; submitBtn.textContent = '✦ Try again';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Show existing credential if already verified on this device.
(async () => {
  const did = await Secure.get('aptogon_did');
  if (did) showCredential({ did, trust_label: 'saved', credential: {} });
})();
