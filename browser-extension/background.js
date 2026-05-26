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

// ── R1-D4: Alert push — poll /api/console/alerts/unread every 5 minutes ──────

const ALERTS_POLL_INTERVAL = 5 * 60 * 1000;  // 5 minutes in ms
const APTOGON_API = 'https://aptogon.network'; // adjust if needed

let _lastAlertCount = 0;

async function pollAlerts() {
  try {
    const { hsi_did: did, aptogon_key: key } =
      await chrome.storage.local.get(['hsi_did', 'aptogon_key']);
    if (!did) return;

    const headers = { 'X-APTOGON-DID': did };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const res = await fetch(`${APTOGON_API}/api/console/alerts/unread`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;

    const { count } = await res.json();
    if (count > 0 && count !== _lastAlertCount) {
      chrome.notifications.create(`aptogon-alerts-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'APTOGON',
        message: `${count} new alert${count > 1 ? 's' : ''} for your API keys`,
        priority: 1,
      });
    }
    _lastAlertCount = count;
  } catch {
    // network errors are expected when offline — silent fail
  }
}

// Start polling loop
(async function alertPollLoop() {
  await pollAlerts();
  setInterval(pollAlerts, ALERTS_POLL_INTERVAL);
})();
