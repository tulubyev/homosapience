// HSI Verified Human — Background Service Worker
// Manages credential state and communicates with content scripts

const HSI_API = 'https://homosapience.org';

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CREDENTIAL') {
    getCredential().then(sendResponse);
    return true; // keep channel open for async
  }

  if (message.type === 'SYNC_CREDENTIAL') {
    // Content script found credential in localStorage — save to extension storage
    if (message.cred) {
      chrome.storage.local.set({
        hsi_credential: message.cred,
        hsi_did: message.did || null,
      }, () => {
        updateBadgeIcon(true);
      });
    }
    return false;
  }

  if (message.type === 'VERIFY_ON_CHAIN') {
    verifyOnChain(message.did).then(sendResponse);
    return true;
  }

  if (message.type === 'OPEN_VERIFY_PAGE') {
    chrome.tabs.create({ url: 'https://homosapience.org/verify' });
  }
});

// Retrieve and validate credential from extension storage
async function getCredential() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['hsi_credential', 'hsi_did'], (result) => {
      const credRaw = result.hsi_credential;
      const did = result.hsi_did;

      if (!credRaw) {
        resolve({ status: 'none' });
        return;
      }

      let cred;
      try {
        cred = typeof credRaw === 'string' ? JSON.parse(credRaw) : credRaw;
      } catch {
        resolve({ status: 'invalid' });
        return;
      }

      // Check expiry
      const expires = cred.expirationDate
        ? new Date(cred.expirationDate).getTime()
        : 0;
      const now = Date.now();

      if (expires && now > expires) {
        resolve({ status: 'expired', did, cred });
        return;
      }

      const confidence = cred.credentialSubject?.confidence ?? 0;
      const txHash = cred.credentialSubject?.txHash;
      const expressionProof = cred.credentialSubject?.expressionProof;
      const issuanceDate = cred.issuanceDate;

      resolve({
        status: 'valid',
        did: did || cred.credentialSubject?.id,
        confidence,
        txHash,
        expressionProof,
        issuanceDate,
        expirationDate: cred.expirationDate,
        daysLeft: expires ? Math.ceil((expires - now) / 86400000) : null,
      });
    });
  });
}

// Verify HumanCredential on-chain via HSI API.
// Uses /api/verify/status which resolves is_human + bond_count from the
// Aptos chain and the trust label from the backend DB.
async function verifyOnChain(did) {
  try {
    const res = await fetch(`${HSI_API}/api/verify/status?did=${encodeURIComponent(did)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { onChain: false };
    const data = await res.json();
    return {
      onChain:    data.is_human === true,
      bondCount:  data.bond_count ?? 0,
      trustScore: data.trust_score ?? null,
      trustLabel: data.trust_label ?? null,
    };
  } catch {
    return { onChain: null }; // network error, not necessarily invalid
  }
}

// Sync credential from any tab's localStorage into extension storage
// Called when user visits homosapience.org
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === 'complete' &&
    tab.url &&
    (tab.url.includes('homosapience.org') || tab.url.includes('localhost:3002') || tab.url.includes('localhost:3000'))
  ) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const cred = localStorage.getItem('hsi_credential');
        const did = localStorage.getItem('hsi_did');
        return { cred, did };
      },
    }).then((results) => {
      if (results && results[0] && results[0].result) {
        const { cred, did } = results[0].result;
        if (cred) {
          chrome.storage.local.set({
            hsi_credential: cred,
            hsi_did: did,
          });
          // Update badge icon to show verified state
          updateBadgeIcon(true);
        }
      }
    }).catch(() => {});
  }
});

function updateBadgeIcon(verified) {
  chrome.action.setBadgeText({ text: verified ? '✓' : '' });
  chrome.action.setBadgeBackgroundColor({ color: verified ? '#7c3aed' : '#6b7280' });
}

// On startup, check stored credential
chrome.runtime.onStartup.addListener(() => {
  getCredential().then((result) => {
    updateBadgeIcon(result.status === 'valid');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
//  R1-D4 — Alerts push for org owners (signed-session JWT, no key leak)
// ─────────────────────────────────────────────────────────────────────────────
//
// Architecture:
//   1. Popup syncs hsi_did + aptogon_key (raw Ed25519 priv, base64url) into
//      chrome.storage.local when the user opens it on a verified tab.
//   2. Background here NEVER sends aptogon_key over the wire. It signs a
//      server-issued nonce with WebCrypto Ed25519 and exchanges the signature
//      for a 1-hour JWT (POST /api/auth/session) — identical to the website's
//      sessionAuth.ts flow.
//   3. chrome.alarms (not setInterval — service workers get suspended) wakes
//      every 5 min to fetch /api/console/alerts/unread with the cached JWT.
//   4. New non-zero counts trigger chrome.notifications.create.
//
// CWS reviewer notes: the polling only runs when the user has actively logged
// in via the popup (hsi_did present in storage). Disabling = remove from popup
// = chrome.storage.local.clear or just uninstall.

const ALERTS_ALARM      = 'aptogon-alerts-poll';
const ALERTS_INTERVAL_M = 5;

// PKCS#8 wrapper for raw Ed25519 priv (RFC 8410) — same constant as
// crypto.js / sessionAuth.ts; duplicated here to keep service worker
// self-contained (no importScripts).
const _PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function _b64urlDecode(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
                    .padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  const bin = atob(padded);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function _b64urlEncode(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function _hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

// In-memory JWT cache. Service worker may be suspended between alarms — that's
// fine; we just re-acquire on the next tick if the cached token is missing or
// near expiry.
let _jwt        = null;
let _jwtExpires = 0;     // unix seconds
let _lastUnread = 0;

async function _signWithKey(keyB64, dataBytes) {
  const raw   = _b64urlDecode(keyB64);
  const pkcs8 = new Uint8Array(_PKCS8_PREFIX.length + raw.length);
  pkcs8.set(_PKCS8_PREFIX);
  pkcs8.set(raw, _PKCS8_PREFIX.length);
  const ck = await crypto.subtle.importKey(
    'pkcs8', pkcs8.buffer, { name: 'Ed25519' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('Ed25519', ck, dataBytes.buffer);
  return _b64urlEncode(new Uint8Array(sig));
}

async function _acquireSession(did, keyB64) {
  // Re-use cached JWT if it has >5 min left.
  const now = Math.floor(Date.now() / 1000);
  if (_jwt && _jwtExpires - now > 300) return _jwt;

  // 1. Get challenge nonce.
  const ch = await fetch(`${HSI_API}/api/auth/challenge`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!ch.ok) return null;
  const { nonce } = await ch.json();

  // 2. Sign the raw nonce bytes.
  const signature = await _signWithKey(keyB64, _hexToBytes(nonce));

  // 3. Exchange for JWT.
  const ss = await fetch(`${HSI_API}/api/auth/session`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ did, nonce, signature }),
    signal:  AbortSignal.timeout(8000),
  });
  if (!ss.ok) return null;
  const data = await ss.json();
  _jwt        = data.token;
  // Decode exp from the JWT payload to know when to refresh.
  try {
    const payload = JSON.parse(atob(_jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    _jwtExpires = payload.exp || (now + 3600);
  } catch {
    _jwtExpires = now + 3600;
  }
  return _jwt;
}

async function pollAlerts() {
  try {
    const { hsi_did: did, aptogon_key: keyB64 } =
      await chrome.storage.local.get(['hsi_did', 'aptogon_key']);
    if (!did || !keyB64) return;   // not yet verified or popup never opened

    const token = await _acquireSession(did, keyB64);
    if (!token) return;            // network or auth issue → silent

    const res = await fetch(`${HSI_API}/api/console/alerts/unread`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) return;

    const { count } = await res.json();
    if (typeof count !== 'number') return;

    // Only notify when count rises above the last seen value.
    if (count > 0 && count > _lastUnread) {
      chrome.notifications.create(`aptogon-alerts-${Date.now()}`, {
        type:     'basic',
        iconUrl:  'icons/icon128.png',
        title:    'APTOGON',
        message:  `${count} new alert${count > 1 ? 's' : ''} for your API keys`,
        priority: 1,
      });
    }
    _lastUnread = count;
  } catch {
    // Service worker can be killed mid-fetch; silently retry next alarm.
  }
}

// Use chrome.alarms instead of setInterval so the poll survives SW suspension.
chrome.alarms.create(ALERTS_ALARM, { periodInMinutes: ALERTS_INTERVAL_M });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALERTS_ALARM) pollAlerts();
});

// First-shot poll on install/startup so the user doesn't wait 5 min for the
// very first check.
chrome.runtime.onStartup.addListener(() => { pollAlerts(); });
chrome.runtime.onInstalled.addListener(() => { pollAlerts(); });
