// APTOGON Verified Human — Popup UI

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('body');

  // i18n: pick the string table for the browser language (2-letter code),
  // falling back to English. Tables live in i18n.js (APTOGON_I18N), loaded
  // before this script.
  const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const t = (typeof APTOGON_I18N !== 'undefined' && APTOGON_I18N[lang]) || APTOGON_I18N.en;
  document.documentElement.dir = t.dir || 'ltr';

  // Set loading text
  body.innerHTML = `<div class="loading">${t.loading}</div>`;

  function loadCredential() {
    chrome.tabs.query({}, (tabs) => {
      const hsiTab = tabs.find(t =>
        t.url && (t.url.includes('localhost:3002') || t.url.includes('localhost:3000') || t.url.includes('homosapience.org'))
      );
      if (hsiTab) {
        chrome.scripting.executeScript({
          target: { tabId: hsiTab.id },
          func: () => ({
            cred: localStorage.getItem('hsi_credential'),
            did: localStorage.getItem('hsi_did'),
          }),
        }, (results) => {
          const data = results?.[0]?.result;
          if (data?.cred) {
            chrome.storage.local.set({ hsi_credential: data.cred, hsi_did: data.did }, () => {
              chrome.runtime.sendMessage({ type: 'GET_CREDENTIAL' }, (response) => {
                render(response || { status: 'none' });
              });
            });
          } else {
            chrome.runtime.sendMessage({ type: 'GET_CREDENTIAL' }, (response) => {
              render(response || { status: 'none' });
            });
          }
          if (chrome.runtime.lastError) {
            chrome.runtime.sendMessage({ type: 'GET_CREDENTIAL' }, (r) => render(r || { status: 'none' }));
          }
        });
      } else {
        chrome.runtime.sendMessage({ type: 'GET_CREDENTIAL' }, (response) => {
          render(response || { status: 'none' });
        });
      }
    });
  }

  loadCredential();
  loadPendingBondRequests();

  function syncFromActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          cred: localStorage.getItem('hsi_credential'),
          did: localStorage.getItem('hsi_did'),
        }),
      }, (results) => {
        if (chrome.runtime.lastError || !results || !results[0]) {
          body.innerHTML += `<p style="color:#ef4444;font-size:11px;text-align:center;margin-top:8px;">${t.errRead} <a href="https://homosapience.org/verify" target="_blank" style="color:#a78bfa">homosapience.org/verify</a></p>`;
          return;
        }
        const { cred, did } = results[0].result;
        if (cred) {
          chrome.storage.local.set({ hsi_credential: cred, hsi_did: did }, () => {
            window.location.reload();
          });
        } else {
          body.innerHTML += `<p style="color:#f59e0b;font-size:11px;text-align:center;margin-top:8px;">${t.errNotFound} <a href="https://homosapience.org/verify" target="_blank" style="color:#a78bfa">homosapience.org/verify</a></p>`;
        }
      });
    });
  }

  function render(cred) {
    if (cred.status === 'valid')        renderValid(cred);
    else if (cred.status === 'expired') renderExpired(cred);
    else                                renderNone();
  }

  // ── Bond requests для Gold Members ────────────────────────────────────────
  // Проверяем pending bond requests и показываем панель одобрения

  async function loadPendingBondRequests() {
    const did = localStorage.getItem('hsi_did');
    if (!did || !localStorage.getItem('aptogon_key')) return;

    try {
      const res = await fetch('https://homosapience.org/api/bond/pending-for-guarantor', {
        headers: { 'X-Approver-DID': did },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.requests && data.requests.length > 0) {
        renderBondRequestsBanner(data.requests);
      }
    } catch {}
  }

  function renderBondRequestsBanner(requests) {
    const req = requests[0]; // показываем первый
    const conf = Math.round((req.confidence || 0) * 100);
    const shortDid = req.requester_did
      ? req.requester_did.slice(0, 12) + '...' + req.requester_did.slice(-6)
      : '???';

    const banner = document.createElement('div');
    banner.style.cssText = `
      background:linear-gradient(135deg,#1e1b4b,#2d1b69);
      border-radius:14px;border:1.5px solid rgba(167,139,250,0.35);
      padding:14px 16px;margin-bottom:12px;
    `;
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:18px;">🤝</span>
        <div>
          <div style="font-weight:800;font-size:12px;color:#fff;">
            ${t.bondRequest}
            ${requests.length > 1 ? `<span style="background:rgba(167,139,250,0.3);color:#c4b5fd;border-radius:99px;padding:1px 7px;font-size:10px;margin-left:4px;">+${requests.length - 1}</span>` : ''}
          </div>
          <div style="font-size:10px;color:#a78bfa;font-family:monospace;">${shortDid}</div>
        </div>
        <div style="margin-left:auto;font-size:11px;font-weight:800;color:${conf >= 80 ? '#4ade80' : conf >= 70 ? '#facc15' : '#f87171'};">
          ${conf}%
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button id="bond-approve" style="
          flex:1;padding:9px;border-radius:10px;border:none;cursor:pointer;
          background:linear-gradient(135deg,#059669,#10b981);
          color:#fff;font-weight:700;font-size:12px;">
          ✅ ${t.vouch}
        </button>
        <button id="bond-reject" style="
          flex:1;padding:9px;border-radius:10px;border:none;cursor:pointer;
          background:rgba(255,255,255,0.1);color:#c4b5fd;
          font-weight:700;font-size:12px;border:1px solid rgba(167,139,250,0.3);">
          ❌ ${t.decline}
        </button>
      </div>
    `;

    body.insertBefore(banner, body.firstChild);

    document.getElementById('bond-approve').addEventListener('click', async () => {
      const btn = document.getElementById('bond-approve');
      btn.textContent = t.signing;
      btn.disabled = true;
      try {
        await approveBondRequest(req.id, req.requester_did);
        banner.innerHTML = `<div style="text-align:center;padding:10px;color:#4ade80;font-weight:700;font-size:12px;">
          ✅ ${t.bondApproved}
        </div>`;
        setTimeout(() => banner.remove(), 2000);
      } catch (e) {
        btn.textContent = `⚠️ ${e.message}`;
        btn.disabled = false;
      }
    });

    document.getElementById('bond-reject').addEventListener('click', async () => {
      try {
        await fetch(`https://homosapience.org/api/bond/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: req.id,
            rejecter_did: localStorage.getItem('hsi_did'),
          }),
        });
      } catch {}
      banner.remove();
    });
  }

  function renderValid(cred) {
    const did = cred.did ?? '';
    const shortDid = did.length > 16 ? did.slice(0, 14) + '...' + did.slice(-6) : did;
    const conf    = Math.round((cred.confidence ?? 0) * 100);
    const issued  = cred.issuanceDate
      ? new Date(cred.issuanceDate).toLocaleDateString(t.dateLocale)
      : '—';
    const daysLeft = cred.daysLeft ?? '?';
    const txRaw = cred.txHash ?? '';
    const txIsReal = txRaw && !txRaw.startsWith('fallback:') && !txRaw.startsWith('local:');
    const txDisplay = txIsReal
      ? `<a href="https://explorer.aptoslabs.com/txn/${txRaw}?network=testnet" target="_blank" style="color:#7c3aed;font-family:monospace;font-size:11px;">${txRaw.slice(0,10)}...</a>`
      : `<span style="color:#94a3b8;font-size:11px;">${t.testnetSoon}</span>`;

    body.innerHTML = `
      <div class="status-card valid">
        <div class="status-icon">✅</div>
        <div class="status-title valid">${t.verified}</div>
        <div class="status-sub">${t.verifiedSub}</div>
      </div>
      <div class="details">
        <div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:6px;padding-bottom:12px;">
          <span class="detail-label">DID</span>
          <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:6px;">
            <span class="detail-value" style="font-size:10px;word-break:break-all;flex:1;" title="${did}">${shortDid}</span>
            <button id="btn-copy-did" style="
              flex-shrink:0;padding:3px 10px;border-radius:7px;border:1px solid rgba(124,58,237,0.3);
              background:rgba(124,58,237,0.08);color:#7c3aed;font-weight:700;font-size:10px;
              cursor:pointer;white-space:nowrap;transition:all 0.2s;
            ">${t.copy}</button>
          </div>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.aiConf}</span>
          <span class="detail-value good">${conf}%</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.issuedOn}</span>
          <span class="detail-value">${issued}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.validFor}</span>
          <span class="detail-value ${daysLeft <= 7 ? 'warn' : 'good'}">${daysLeft} ${t.days}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Aptos TX</span>
          <span class="detail-value">${txDisplay}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.onchain}</span>
          <span class="detail-value" id="onchain-status">${t.checking}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.bonds}</span>
          <span class="detail-value" id="bond-count">…</span>
        </div>
      </div>
      <button class="btn btn-secondary" id="btn-qr">${t.didAsQr}</button>
      <button class="btn btn-secondary" id="btn-refresh">${t.refresh}</button>
    `;

    document.getElementById('btn-copy-did').addEventListener('click', () => {
      navigator.clipboard.writeText(did).then(() => {
        const btn = document.getElementById('btn-copy-did');
        if (btn) {
          btn.textContent = t.copied;
          btn.style.background = '#7c3aed';
          btn.style.color = '#fff';
          setTimeout(() => {
            btn.textContent = t.copy;
            btn.style.background = 'rgba(124,58,237,0.08)';
            btn.style.color = '#7c3aed';
          }, 2000);
        }
      });
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_VERIFY_PAGE' });
      window.close();
    });

    // QR export — render the DID as a QR code locally (no external service)
    document.getElementById('btn-qr').addEventListener('click', () => showQrModal(did));

    // On-chain status + bond count — async enrich via backend (Aptos-resolved)
    if (did) {
      chrome.runtime.sendMessage({ type: 'VERIFY_ON_CHAIN', did }, (r) => {
        const oc = document.getElementById('onchain-status');
        const bc = document.getElementById('bond-count');
        if (!oc || !bc) return;
        if (!r || r.onChain === null) {
          oc.textContent = t.offline;
          bc.textContent = '—';
          return;
        }
        if (r.onChain) {
          oc.textContent = t.verifiedShort;
          oc.className = 'detail-value good';
        } else {
          oc.textContent = t.notFound;
          oc.className = 'detail-value warn';
        }
        bc.textContent = String(r.bondCount ?? 0);
      });
    }

    renderHandlesEditor();
  }

  // ── "My handles" editor ────────────────────────────────────────────────────
  // Option A: the badge only appears next to YOUR own username. The user
  // declares their handle per site; content.js matches against it.
  const SUPPORTED_SITES = [
    ['github', 'GitHub'], ['reddit', 'Reddit'], ['x', 'X / Twitter'],
    ['hackernews', 'Hacker News'], ['discord', 'Discord'], ['telegram', 'Telegram'],
    ['instagram', 'Instagram'], ['substack', 'Substack'], ['youtube', 'YouTube'],
    ['linkedin', 'LinkedIn'], ['stackoverflow', 'Stack Overflow'], ['habr', 'Habr'],
  ];

  function renderHandlesEditor() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:4px;';

    const toggle = document.createElement('button');
    toggle.className = 'btn btn-secondary';
    toggle.textContent = t.myHandles;
    wrap.appendChild(toggle);

    const panel = document.createElement('div');
    panel.style.cssText = 'display:none;max-height:220px;overflow-y:auto;margin-top:6px;border:1px solid var(--details-border,#e9d5ff);border-radius:12px;padding:10px;';

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:var(--text-tertiary,#9ca3af);margin-bottom:8px;line-height:1.5;';
    hint.textContent = t.handlesHint;
    panel.appendChild(hint);

    chrome.storage.local.get('hsi_handles', (res) => {
      const stored = res.hsi_handles || {};
      const inputs = {};
      SUPPORTED_SITES.forEach(([key, label]) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
        const lab = document.createElement('span');
        lab.style.cssText = 'flex:0 0 86px;font-size:11px;color:var(--text-secondary,#6b7280);';
        lab.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = stored[key] || '';
        inp.placeholder = t.yourHandle;
        inp.style.cssText = 'flex:1;min-width:0;padding:5px 8px;border-radius:7px;border:1px solid var(--details-border,#e9d5ff);font-size:11px;background:var(--bg-body,#fff);color:var(--text-primary,#111827);';
        inputs[key] = inp;
        row.appendChild(lab);
        row.appendChild(inp);
        panel.appendChild(row);
      });

      const save = () => {
        const next = {};
        SUPPORTED_SITES.forEach(([key]) => {
          const v = inputs[key].value.trim();
          if (v) next[key] = v;
        });
        chrome.storage.local.set({ hsi_handles: next });
      };
      Object.values(inputs).forEach((inp) => inp.addEventListener('input', save));
    });

    toggle.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    wrap.appendChild(panel);
    body.appendChild(wrap);
  }

  // QR modal — encodes the DID locally via the bundled qrcode-generator lib.
  // Built with DOM methods (no innerHTML): the DID goes through textContent and
  // the QR SVG is parsed into a node, so no markup injection is possible.
  function showQrModal(did) {
    if (typeof qrcode === 'undefined') return;
    const qr = qrcode(0, 'M');
    qr.addData(did);
    qr.make();
    const svgString = qr.createSvgTag(4, 8);

    const overlay = document.createElement('div');
    overlay.id = 'qr-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;' +
      'align-items:center;justify-content:center;z-index:1000;padding:16px;';

    const card = document.createElement('div');
    card.style.cssText =
      'background:var(--details-bg,#fff);border:1px solid var(--details-border,#e9d5ff);' +
      'border-radius:16px;padding:20px;max-width:260px;text-align:center;';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:800;font-size:13px;margin-bottom:12px;color:var(--text-primary,#111827);';
    title.textContent = t.yourDid;

    const qrBox = document.createElement('div');
    qrBox.style.cssText = 'background:#fff;padding:10px;border-radius:10px;display:inline-block;line-height:0;';
    const svgNode = new DOMParser().parseFromString(svgString, 'image/svg+xml').documentElement;
    qrBox.appendChild(svgNode);

    const didText = document.createElement('div');
    didText.style.cssText = 'font-size:9px;font-family:monospace;color:var(--text-tertiary,#9ca3af);margin-top:10px;word-break:break-all;';
    didText.textContent = did;

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText =
      'margin-top:14px;width:100%;padding:9px;border:none;border-radius:9px;' +
      'background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;font-weight:700;font-size:12px;cursor:pointer;';
    closeBtn.textContent = t.close;

    card.append(title, qrBox, didText, closeBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
  }

  function renderExpired() {
    body.innerHTML = `
      <div class="status-card expired">
        <div class="status-icon">⏰</div>
        <div class="status-title expired">${t.expired}</div>
        <div class="status-sub">${t.expiredSub}</div>
      </div>
      <button class="btn btn-primary" id="btn-verify">${t.btnVerify}</button>
      <button class="btn btn-secondary" id="btn-sync">${t.btnSync}</button>
    `;
    document.getElementById('btn-verify').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_VERIFY_PAGE' });
      window.close();
    });
    document.getElementById('btn-sync').addEventListener('click', syncFromActiveTab);
  }

  function renderNone() {
    body.innerHTML = `
      <div class="status-card none">
        <div class="status-icon">👤</div>
        <div class="status-title none">${t.notVerified}</div>
        <div class="status-sub">${t.notVerifiedSub}</div>
      </div>
      <div style="background:#fff;border-radius:12px;border:1px solid #e9d5ff;padding:12px 14px;margin-bottom:14px;font-size:11px;color:#6b7280;line-height:1.7;">
        <strong style="color:#7c3aed;">${t.benefits}</strong><br>
        ${t.b1}<br>
        ${t.b2}<br>
        ${t.b3}<br>
        ${t.b4}
      </div>
      <button class="btn btn-primary" id="btn-verify">${t.btnVerify}</button>
      <button class="btn btn-secondary" id="btn-sync">${t.btnSync}</button>
    `;
    document.getElementById('btn-verify').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_VERIFY_PAGE' });
      window.close();
    });
    document.getElementById('btn-sync').addEventListener('click', syncFromActiveTab);
  }
});
