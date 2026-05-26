/**
 * riskSignals.ts — R2 Client-side Risk Signal Collection
 *
 * Collects S2 (automation/headless), S3 (VM/emulator), and S4 (behavioral)
 * signals from the browser.  Zero-PII: no raw IP, no raw UA string stored —
 * only derived boolean flags are sent to the server.
 *
 * Usage:
 *   import { collectRiskSignals, submitRiskAssessment } from '@/lib/riskSignals';
 *
 *   // During page load — start behavioral tracking
 *   const tracker = collectRiskSignals();
 *
 *   // Before or during gesture — submit to server
 *   const result = await submitRiskAssessment(tracker.snapshot(), sessionId);
 *   // result: { risk_score, classification, signals, blocked, step_up, gesture_min_s }
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientSignals {
  // S2 — Automation / headless
  webdriver:     boolean;
  cdp_artifact:  boolean;
  no_plugins:    boolean;
  headless_ua:   boolean;
  perm_denied:   boolean;
  lang_mismatch: boolean;

  // S3 — VM / emulator
  canvas_anomaly:   boolean;
  audio_anomaly:    boolean;
  hw_concurrency_0: boolean;
  screen_anomaly:   boolean;
  pixel_ratio_0:    boolean;

  // S4 — Behavioral micro
  low_mouse_entropy: boolean;
  robotic_timing:    boolean;
  no_scroll_events:  boolean;
  instant_focus:     boolean;

  // Client-declared VPN (low-trust signal)
  vpn_proxy: boolean;

  session_id?: string;
}

export interface RiskAssessResult {
  risk_score:     number;
  classification: 'human' | 'suspicious' | 'bot' | 'ai_agent';
  signals:        string[];
  blocked:        boolean;
  step_up:        boolean;
  gesture_min_s:  number;
}

// ── S2: Automation / headless detection ──────────────────────────────────────

function detectWebdriver(): boolean {
  try {
    return !!(
      (navigator as Navigator & { webdriver?: boolean }).webdriver ||
      // Selenium residue
      ('__selenium_unwrapped' in window) ||
      ('__webdriver_evaluate' in window) ||
      ('__driver_evaluate' in window) ||
      ('__webdriver_unwrapped' in window) ||
      ('__driver_unwrapped' in window) ||
      ('_Selenium_IDE_Recorder' in window) ||
      ('calledSelenium' in window) ||
      // Puppeteer / Playwright CDP residue
      ('__puppeteer_evaluation_script__' in window) ||
      ('__playwright_target__' in window)
    );
  } catch {
    return false;
  }
}

function detectCdpArtifact(): boolean {
  try {
    return !!(
      // Chrome DevTools Protocol connection leaves Runtime.enable residue
      ('__cdc_asdjflasutopfhvcZLmcfl_' in window) ||
      ('chrome' in window &&
        (window as Window & { chrome?: { runtime?: unknown; loadTimes?: unknown } }).chrome &&
        !('loadTimes' in ((window as Window & { chrome: { loadTimes?: unknown } }).chrome))) ||
      // Playwright-specific
      ('__playwright' in window) ||
      ('__pw_manual' in window)
    );
  } catch {
    return false;
  }
}

function detectNoPlugins(): boolean {
  try {
    // Firefox and Safari legitimately have 0 plugins in modern versions
    const ua = navigator.userAgent.toLowerCase();
    const isFirefox = ua.includes('firefox');
    const isSafari = ua.includes('safari') && !ua.includes('chrome');
    if (isFirefox || isSafari) return false;
    return navigator.plugins.length === 0;
  } catch {
    return false;
  }
}

function detectHeadlessUA(): boolean {
  try {
    const ua = navigator.userAgent;
    return ua.includes('HeadlessChrome') || ua.includes('Headless');
  } catch {
    return false;
  }
}

async function detectPermDenied(): Promise<boolean> {
  try {
    if (!navigator.permissions) return false;
    const result = await navigator.permissions.query({ name: 'notifications' });
    // In real browsers notifications may be 'default' (not yet asked) or 'denied'
    // Headless browsers often return 'denied' even without user action
    return result.state === 'denied';
  } catch {
    return false;
  }
}

function detectLangMismatch(): boolean {
  try {
    const lang = navigator.language;
    const langs = Array.from(navigator.languages);
    if (!lang || langs.length === 0) return false;
    return !langs.includes(lang);
  } catch {
    return false;
  }
}

// ── S3: VM / emulator detection ───────────────────────────────────────────────

// Known headless canvas fingerprint hash prefixes (detected via canvas noise analysis)
const _HEADLESS_CANVAS_HASHES = new Set([
  '1f2d3a',  // Chrome headless (Linux)
  'a4b5c6',  // Playwright
  '000000',  // Pure black (no rendering)
]);

async function detectCanvasAnomaly(): Promise<boolean> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return true; // no canvas support → suspicious

    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('HumanFirewall', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('HumanFirewall', 4, 17);

    const data = canvas.toDataURL().slice(-20);
    const hashPrefix = data.replace(/[^a-f0-9]/g, '').slice(0, 6);
    if (_HEADLESS_CANVAS_HASHES.has(hashPrefix)) return true;

    // All pixels identical → no GPU rendering
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const firstPx = imgData.slice(0, 4).join(',');
    let allSame = true;
    for (let i = 4; i < Math.min(imgData.length, 400); i += 4) {
      if (imgData.slice(i, i + 4).join(',') !== firstPx) { allSame = false; break; }
    }
    return allSame;
  } catch {
    return false;
  }
}

async function detectAudioAnomaly(): Promise<boolean> {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return false;

    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    oscillator.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(0);

    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(data);
    oscillator.stop();
    await ctx.close();

    // All -Infinity means no audio pipeline
    const allInfinity = data.every(v => v === -Infinity || v === 0);
    return allInfinity;
  } catch {
    return false;
  }
}

function detectHwConcurrency0(): boolean {
  try {
    return navigator.hardwareConcurrency === 0;
  } catch {
    return false;
  }
}

function detectScreenAnomaly(): boolean {
  try {
    const w = screen.width, h = screen.height, d = screen.colorDepth;
    return w === 0 || h === 0 || d < 16 || (w === 800 && h === 600 && d === 24);
  } catch {
    return false;
  }
}

function detectPixelRatio0(): boolean {
  try {
    const r = window.devicePixelRatio;
    return r === 0 || r > 5;
  } catch {
    return false;
  }
}

// ── S4: Behavioral micro tracking ─────────────────────────────────────────────

interface BehaviorData {
  mouseMoves: { x: number; y: number; t: number }[];
  scrollCount: number;
  pageLoadMs: number;
  firstInteractionMs: number | null;
}

function startBehaviorTracking(): BehaviorData {
  const data: BehaviorData = {
    mouseMoves: [],
    scrollCount: 0,
    pageLoadMs: performance.now(),
    firstInteractionMs: null,
  };

  const onMouseMove = (e: MouseEvent) => {
    if (data.mouseMoves.length < 200) {
      data.mouseMoves.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (data.firstInteractionMs === null) data.firstInteractionMs = performance.now();
    }
  };
  const onScroll = () => {
    data.scrollCount++;
    if (data.firstInteractionMs === null) data.firstInteractionMs = performance.now();
  };
  const onTouch = () => {
    if (data.firstInteractionMs === null) data.firstInteractionMs = performance.now();
  };

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('touchstart', onTouch, { passive: true });

  // Cleanup after 60s to avoid memory leak
  setTimeout(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('scroll', onScroll);
    document.removeEventListener('touchstart', onTouch);
  }, 60_000);

  return data;
}

function analyzeMouseEntropy(moves: { x: number; y: number; t: number }[]): {
  low_mouse_entropy: boolean;
  robotic_timing: boolean;
} {
  if (moves.length < 10) {
    return { low_mouse_entropy: false, robotic_timing: false };
  }

  // Entropy: count distinct angles between consecutive points
  const angles: number[] = [];
  const intervals: number[] = [];
  for (let i = 1; i < moves.length; i++) {
    const dx = moves[i].x - moves[i - 1].x;
    const dy = moves[i].y - moves[i - 1].y;
    if (dx !== 0 || dy !== 0) angles.push(Math.atan2(dy, dx));
    const dt = moves[i].t - moves[i - 1].t;
    if (dt > 0) intervals.push(dt);
  }

  // Low entropy: < 5 distinct angle buckets (straight-line or grid movement)
  const buckets = new Set(angles.map(a => Math.round(a * 4) / 4));
  const low_mouse_entropy = buckets.size < 5;

  // Robotic timing: coefficient of variation of intervals < 0.05 (too regular)
  let robotic_timing = false;
  if (intervals.length >= 5) {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const std = Math.sqrt(
      intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length
    );
    const cv = mean > 0 ? std / mean : 0;
    robotic_timing = cv < 0.05;
  }

  return { low_mouse_entropy, robotic_timing };
}

// ── Main collector class ──────────────────────────────────────────────────────

export class RiskSignalCollector {
  private _behavior: BehaviorData;
  private _loadMs: number;

  constructor() {
    this._loadMs = performance.now();
    this._behavior = startBehaviorTracking();
  }

  /** Collect all signals synchronously (awaits async ones internally). */
  async snapshot(sessionId?: string): Promise<ClientSignals> {
    // Async signals
    const [perm_denied, canvas_anomaly, audio_anomaly] = await Promise.all([
      detectPermDenied(),
      detectCanvasAnomaly(),
      detectAudioAnomaly(),
    ]);

    // Behavioral
    const { low_mouse_entropy, robotic_timing } = analyzeMouseEntropy(
      this._behavior.mouseMoves
    );
    const no_scroll_events = this._behavior.scrollCount === 0;

    // Focus-to-first-interaction < 300ms
    const first = this._behavior.firstInteractionMs;
    const instant_focus = first !== null && first - this._loadMs < 300;

    return {
      webdriver:        detectWebdriver(),
      cdp_artifact:     detectCdpArtifact(),
      no_plugins:       detectNoPlugins(),
      headless_ua:      detectHeadlessUA(),
      perm_denied,
      lang_mismatch:    detectLangMismatch(),
      canvas_anomaly,
      audio_anomaly,
      hw_concurrency_0: detectHwConcurrency0(),
      screen_anomaly:   detectScreenAnomaly(),
      pixel_ratio_0:    detectPixelRatio0(),
      low_mouse_entropy,
      robotic_timing,
      no_scroll_events,
      instant_focus,
      vpn_proxy:        false,   // not client-detectable reliably; left for future
      session_id:       sessionId,
    };
  }
}

// ── API submission ─────────────────────────────────────────────────────────────

/**
 * Collect and submit risk signals to /api/risk/assess.
 * Returns RiskAssessResult or a safe default on failure.
 */
export async function submitRiskAssessment(
  collector: RiskSignalCollector,
  sessionId?: string,
): Promise<RiskAssessResult> {
  const _default: RiskAssessResult = {
    risk_score:     0,
    classification: 'human',
    signals:        [],
    blocked:        false,
    step_up:        false,
    gesture_min_s:  8,
  };

  try {
    const signals = await collector.snapshot(sessionId);
    const res = await fetch('/api/risk/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signals),
    });
    if (!res.ok) return _default;
    return (await res.json()) as RiskAssessResult;
  } catch {
    return _default;   // fail open — never block verification due to network error
  }
}

/**
 * Convenience: create collector + submit in one call.
 * Use this when you want to fire-and-forget during page load.
 */
export async function assessRisk(sessionId?: string): Promise<RiskAssessResult> {
  const collector = new RiskSignalCollector();
  // Give behavioral tracking a moment to observe mouse movement
  await new Promise(resolve => setTimeout(resolve, 500));
  return submitRiskAssessment(collector, sessionId);
}
