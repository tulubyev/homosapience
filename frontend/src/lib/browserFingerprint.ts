/**
 * browserFingerprint.ts — pre-gesture browser signal collection.
 *
 * Collects raw device characteristics before gesture capture starts.
 * These supplement the risk-score signals in riskSignals.ts with raw values
 * (WebGL vendor/renderer, audio hash, screen properties) useful for future
 * ML classification and logging.
 *
 * The `webdriver` field is the only field that triggers an immediate server-side
 * block. All other fields are logged for analysis and never used for blocking.
 *
 * Zero-PII: no IP, no user identity, no location. All values are device-local.
 */

export interface BrowserFingerprint {
  webgl_vendor:         string | null   // UNMASKED_VENDOR_WEBGL
  webgl_renderer:       string | null   // UNMASKED_RENDERER_WEBGL
  audio_hash:           string | null   // OfflineAudioContext fingerprint hash (8 hex chars)
  hardware_concurrency: number          // navigator.hardwareConcurrency (0 if unavailable)
  device_memory:        number | null   // navigator.deviceMemory (GB, null if unavailable)
  timezone_offset:      number          // new Date().getTimezoneOffset() (minutes)
  touch_points:         number          // navigator.maxTouchPoints
  webdriver:            boolean         // navigator.webdriver or Selenium/CDP residue
  color_depth:          number          // screen.colorDepth (bits)
  pixel_ratio:          number          // window.devicePixelRatio
}

// ── WebGL ──────────────────────────────────────────────────────────────────────

function collectWebGL(): { webgl_vendor: string | null; webgl_renderer: string | null } {
  try {
    const canvas = document.createElement('canvas')
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl) return { webgl_vendor: null, webgl_renderer: null }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return { webgl_vendor: null, webgl_renderer: null }
    return {
      webgl_vendor:   gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string,
      webgl_renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string,
    }
  } catch {
    return { webgl_vendor: null, webgl_renderer: null }
  }
}

// ── Audio fingerprint ──────────────────────────────────────────────────────────

async function computeAudioHash(): Promise<string | null> {
  try {
    const ctx = new OfflineAudioContext(1, 44100, 44100)
    const oscillator = ctx.createOscillator()
    const compressor = ctx.createDynamicsCompressor()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(10000, ctx.currentTime)
    compressor.threshold.setValueAtTime(-50, ctx.currentTime)
    compressor.knee.setValueAtTime(40, ctx.currentTime)
    compressor.ratio.setValueAtTime(12, ctx.currentTime)
    compressor.attack.setValueAtTime(0, ctx.currentTime)
    compressor.release.setValueAtTime(0.25, ctx.currentTime)
    oscillator.connect(compressor)
    compressor.connect(ctx.destination)
    oscillator.start(0)
    const buffer = await ctx.startRendering()
    const samples = buffer.getChannelData(0).subarray(4500, 5000)
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hashBuffer))
      .slice(0, 4)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

// ── Webdriver / automation detection ──────────────────────────────────────────

function detectWebdriver(): boolean {
  try {
    if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return true
    const residues = [
      '__selenium_unwrapped', '__webdriver_evaluate', '__driver_evaluate',
      '__webdriver_unwrapped', '__driver_unwrapped', '_Selenium_IDE_Recorder',
      'calledSelenium', '__puppeteer_evaluation_script__', '__playwright_target__',
      '__cdc_asdjflasutopfhvcZLmcfl_',
    ]
    return residues.some(key => key in window)
  } catch {
    return false
  }
}

// ── Main collector ─────────────────────────────────────────────────────────────

export async function collectBrowserFingerprint(): Promise<BrowserFingerprint> {
  const { webgl_vendor, webgl_renderer } = collectWebGL()
  const audio_hash = await computeAudioHash()

  return {
    webgl_vendor,
    webgl_renderer,
    audio_hash,
    hardware_concurrency: navigator.hardwareConcurrency ?? 0,
    device_memory:        (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    timezone_offset:      new Date().getTimezoneOffset(),
    touch_points:         navigator.maxTouchPoints ?? 0,
    webdriver:            detectWebdriver(),
    color_depth:          screen.colorDepth,
    pixel_ratio:          window.devicePixelRatio ?? 1,
  }
}
