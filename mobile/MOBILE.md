# APTOGON Mobile (Capacitor) — v1: verification + credential

A native iOS + Android app that wraps a **self-contained** gesture-verification
bundle (`www/`). Approach **B**: the web bundle ships *inside* the app (offline
start, native feel, passes Apple Guideline 4.2) — it is NOT a wrapper of the live
website. Only the verification API call goes to the backend.

## Why this shape
- The Next.js web app can't be statically exported (next-intl middleware, Server
  Actions, rewrites), so we ship a small standalone bundle instead of the full app.
- The backend **generates the DID server-side** and returns `{did, private_key_b64}`
  in the verify response, so the app needs **no client-side crypto** for v1.
- v1 scope: gesture → `/api/verify/expression` → securely store keys → show
  HumanCredential. No chat / Bond / console.

## Layout
```
mobile/
  capacitor.config.ts   # appId org.homosapience.aptogon, webDir=www, bundled (no server.url)
  package.json          # Capacitor 6 + secure-storage plugin
  www/                  # the shipped app
    index.html          # gesture pad + result UI
    app.js              # capture → POST verify → secure store → render credential
```

## Build & run (on a Mac with Xcode + Android Studio)
```bash
cd mobile
npm install

# generate native projects (run once)
npx cap add ios
npx cap add android

# app icon + splash from the brand logo
npx capacitor-assets generate --assetPath ../design   # uses logo-*.svg

# after any change to www/ or config:
npx cap sync

# open in the native IDEs to run on simulator/device:
npx cap open ios       # Xcode → run on Simulator / device
npx cap open android   # Android Studio → run
```

## Configuration
- **API base**: `www/app.js` → `API_BASE` (default `https://homosapience.org`).
- **Secure key storage**: `app.js` uses `SecureStoragePlugin` (Keychain on iOS,
  Keystore on Android) when running natively; falls back to `localStorage` only in
  a plain browser (for quick UI testing). The Ed25519 private key returned by the
  server is stored under `aptogon_key`, the DID under `aptogon_did`.

## Browser smoke test (no native toolchain needed)
```bash
cd mobile/www && python3 -m http.server 8080
# open http://localhost:8080 — draw a gesture, tap Verify.
```
⚠️ Verification needs a **working AI provider** on the backend (`/api/verify/expression`
→ Gonka). If the AI provider is down, the gesture is rejected `ai_unavailable`
regardless of the app — that's a backend/provider issue, not the app.

## Store submission checklist
- **Apple** ($99/yr): App Store Connect listing; Privacy "nutrition labels" =
  *no data collected* (true — zero PII, anonymous DID); export compliance =
  standard crypto (Ed25519); take iPhone screenshots of the flow.
  Guideline **4.2** mitigations baked in: offline bundle, native secure storage,
  native gesture, splash/icon — it does real on-device work, not just load a URL.
- **Google Play** ($25 once): Data safety form (no data collected); content rating;
  screenshots.
- Reuse listing copy from `browser-extension/STORE_LISTING.md` + comparison points
  from `outreach/comparison-post.md`.

## Roadmap (post-v1)
- Client-side session auth (sign challenge) → unlock authenticated endpoints.
- App Attest (iOS) / Play Integrity (Android) to strengthen anti-bot on mobile
  (device fingerprinting is weaker than on web — no Canvas/WebGL).
- Optional: accelerometer/gyroscope as extra gesture-biometric signal.
- Shielded mode toggle (reuse backend `mode=shielded`).
