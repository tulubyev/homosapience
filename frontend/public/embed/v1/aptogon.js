/* APTOGON drop-in widget — https://homosapience.org/embed/v1/aptogon.js
   Dependency-free. Exposes window.Aptogon.verify(). */
(function () {
  'use strict';

  var SIGNER_BASE = 'https://homosapience.org';

  // ── Pure helpers (also exported for Node tests via UMD-lite guard) ──────────
  function buildSignerUrl(base, publishableKey, origin) {
    var root = String(base).replace(/\/+$/, '');
    return root + '/embed/signer'
      + '?pk=' + encodeURIComponent(publishableKey)
      + '&origin=' + encodeURIComponent(origin)
      + '&v=1';
  }

  function isValidMessage(event, expectedOrigin, popupRef) {
    return !!event
      && event.origin === expectedOrigin
      && event.source === popupRef
      && !!event.data
      && event.data.type === 'aptogon:result';
  }

  // ── Browser-only loader ─────────────────────────────────────────────────────
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    var loaderScript = document.currentScript;

    function defaultKey() {
      if (loaderScript && loaderScript.getAttribute('data-aptogon-key')) {
        return loaderScript.getAttribute('data-aptogon-key');
      }
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf('/embed/v1/aptogon.js') > -1) {
          return all[i].getAttribute('data-aptogon-key');
        }
      }
      return null;
    }

    function verify(opts) {
      opts = opts || {};
      var pk = opts.publishableKey || defaultKey();
      var origin = window.location.origin;
      return new Promise(function (resolve, reject) {
        if (!pk) { reject(new Error('aptogon: missing publishableKey')); return; }
        var popup = window.open(
          buildSignerUrl(SIGNER_BASE, pk, origin),
          'aptogon_signer',
          'width=440,height=660'
        );
        if (!popup) { reject(new Error('aptogon: popup blocked')); return; }

        var settled = false;
        function cleanup() {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMsg);
          clearInterval(closedTimer);
          try { if (popup && !popup.closed) popup.close(); } catch (e) {}
        }
        function onMsg(event) {
          if (!isValidMessage(event, SIGNER_BASE, popup)) return;
          cleanup();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve({ token: event.data.token, trust_band: event.data.trust_band });
        }
        window.addEventListener('message', onMsg);
        var closedTimer = setInterval(function () {
          if (popup.closed && !settled) { cleanup(); reject(new Error('aptogon: cancelled')); }
        }, 500);
      });
    }

    function initDeclarative() {
      var nodes = document.querySelectorAll('[data-aptogon-verify]');
      Array.prototype.forEach.call(nodes, function (el) {
        if (el.getAttribute('data-aptogon-init')) return;
        el.setAttribute('data-aptogon-init', '1');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = el.getAttribute('data-label') || "Verify you're human";
        btn.style.cssText = 'padding:10px 18px;border:none;border-radius:10px;'
          + 'background:#7c3aed;color:#fff;font-weight:700;font-size:14px;cursor:pointer';
        btn.addEventListener('click', function () {
          btn.disabled = true;
          verify({ publishableKey: el.getAttribute('data-aptogon-key') || undefined })
            .then(function (result) {
              var cb = el.getAttribute('data-on-success');
              if (cb && typeof window[cb] === 'function') window[cb](result);
            })
            .catch(function (err) {
              var cb = el.getAttribute('data-on-error');
              if (cb && typeof window[cb] === 'function') window[cb](err);
            })
            .then(function () { btn.disabled = false; });
        });
        el.appendChild(btn);
      });
    }

    window.Aptogon = { verify: verify };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDeclarative);
    } else {
      initDeclarative();
    }
  }

  // ── UMD-lite: expose pure helpers to Node (browser ignores — no `module`) ────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSignerUrl: buildSignerUrl, isValidMessage: isValidMessage };
  }
})();
