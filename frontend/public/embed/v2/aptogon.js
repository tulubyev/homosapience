/* APTOGON gesture-CAPTCHA loader — https://homosapience.org/embed/v2/aptogon.js
   Dependency-free. Injects an inline iframe (draw-a-gesture instead of image grids)
   and hands your page a short-lived token to verify server-side via
   POST https://homosapience.org/api/captcha/siteverify (Bearer sk_live_…).

   Declarative:
     <script src="https://homosapience.org/embed/v2/aptogon.js"></script>
     <form ...>
       <div data-aptogon-captcha data-aptogon-key="pk_live_xxx"></div>
     </form>
   On success a hidden <input name="aptogon-response" value="TOKEN"> is added to
   the enclosing form; your backend POSTs that token to /siteverify.

   Programmatic:  window.AptogonCaptcha.render(el, { key, onVerified, onError }) */
(function () {
  'use strict';

  var SIGNER_BASE = 'https://homosapience.org';

  function buildUrl(base, pk, challengeId) {
    var root = String(base).replace(/\/+$/, '');
    var u = root + '/embed/verify?pk=' + encodeURIComponent(pk) + '&v=2';
    if (challengeId) u += '&c=' + encodeURIComponent(challengeId);
    return u;
  }

  function isVerifiedMsg(event, iframeWin) {
    return !!event && event.origin === SIGNER_BASE && event.source === iframeWin
      && !!event.data && event.data.type === 'aptogon:verified';
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { buildUrl: buildUrl, isVerifiedMsg: isVerifiedMsg };
    }
    return;
  }

  function ensureHiddenInput(container, token) {
    // Put the token into a hidden field inside the enclosing <form> (if any) so a
    // normal form submit carries it to the customer's backend.
    var form = container.closest ? container.closest('form') : null;
    var scope = form || container;
    var input = scope.querySelector('input[data-aptogon-response]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'aptogon-response';
      input.setAttribute('data-aptogon-response', '1');
      scope.appendChild(input);
    }
    input.value = token || '';
  }

  function render(target, opts) {
    opts = opts || {};
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('aptogon: target element not found');
    var pk = opts.key || el.getAttribute('data-aptogon-key');
    if (!pk) throw new Error('aptogon: missing site key');

    var iframe = document.createElement('iframe');
    iframe.src = buildUrl(SIGNER_BASE, pk, opts.challengeId);
    iframe.title = 'Human verification';
    iframe.setAttribute('scrolling', 'no');
    // Height is a starting guess only — the iframe reports its real content height
    // via an 'aptogon:resize' message (the gesture stage is tall, the result short).
    iframe.style.cssText = 'width:100%;max-width:340px;height:320px;border:1px solid #e2e8f0;'
      + 'border-radius:12px;background:#fff;display:block';
    el.replaceChildren();      // clear container (no untrusted HTML — just the iframe)
    el.appendChild(iframe);

    function onMsg(event) {
      // Handshake: reply to the iframe's ready ping with our origin.
      if (event.source === iframe.contentWindow && event.origin === SIGNER_BASE
          && event.data && event.data.type === 'aptogon:ready') {
        iframe.contentWindow.postMessage({ type: 'aptogon:host', origin: window.location.origin }, SIGNER_BASE);
        return;
      }
      // Content height report — clamped so a hostile/broken frame can't take over the page.
      if (event.source === iframe.contentWindow && event.origin === SIGNER_BASE
          && event.data && event.data.type === 'aptogon:resize') {
        var h = Number(event.data.height);
        // Lower bound is small so the post-verification result (a single line, no
        // canvas) collapses the iframe instead of leaving a tall empty box.
        if (h > 0) iframe.style.height = Math.min(Math.max(h, 60), 600) + 'px';
        return;
      }
      if (!isVerifiedMsg(event, iframe.contentWindow)) return;
      var d = event.data;
      if (d.error) {
        var onErr = opts.onError || (el.getAttribute('data-on-error') && window[el.getAttribute('data-on-error')]);
        if (typeof onErr === 'function') onErr(new Error(d.error));
        return;
      }
      ensureHiddenInput(el, d.token);
      var cb = opts.onVerified
        || (el.getAttribute('data-callback') && window[el.getAttribute('data-callback')]);
      if (typeof cb === 'function') cb(d.token, { human: d.human, band: d.band });
    }
    window.addEventListener('message', onMsg);
    return { destroy: function () { window.removeEventListener('message', onMsg); el.replaceChildren(); } };
  }

  function initDeclarative() {
    var nodes = document.querySelectorAll('[data-aptogon-captcha]');
    Array.prototype.forEach.call(nodes, function (el) {
      if (el.getAttribute('data-aptogon-init')) return;
      el.setAttribute('data-aptogon-init', '1');
      try { render(el, {}); } catch (e) { /* missing key etc. */ }
    });
  }

  window.AptogonCaptcha = { render: render };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeclarative);
  } else {
    initDeclarative();
  }
})();
