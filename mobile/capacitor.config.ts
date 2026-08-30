import type { CapacitorConfig } from '@capacitor/cli';

// APTOGON mobile (v1: verification + credential). Approach B — a self-contained
// web bundle in ./www is shipped INSIDE the app (offline-capable, passes Apple
// Guideline 4.2), not a wrapper of the live site. API calls go to the backend.
const config: CapacitorConfig = {
  appId: 'org.homosapience.aptogon',
  appName: 'APTOGON',
  webDir: 'www',
  // No server.url → bundled assets are used (offline start, native feel).
  backgroundColor: '#0f172a',
  ios: {
    contentInset: 'always',
  },
  android: {
    // Allow cleartext only in dev; prod API is https.
    allowMixedContent: false,
  },
};

export default config;
