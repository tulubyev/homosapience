// HSI Verified Human — Content Script
// Injects the Verified Human badge next to username elements on supported sites

(function () {
  'use strict';

  // On HSI pages (localhost or homosapience.org) — only sync credential, don't inject badges
  const isHsiPage = location.hostname.includes('homosapience.org') || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isHsiPage) {
    // Push credential to extension storage
    const syncCredential = (cred, did) => {
      if (!cred) return;
      try {
        chrome.runtime.sendMessage({ type: 'SYNC_CREDENTIAL', cred, did });
      } catch (e) {
        // Extension context invalidated (e.g. after reload) — ignore silently
      }
    };

    // 1. Sync immediately on page load (if already verified before)
    syncCredential(
      localStorage.getItem('hsi_credential'),
      localStorage.getItem('hsi_did')
    );

    // 2. Listen for direct event from verify page (fired right after verification)
    window.addEventListener('hsi:verified', (e) => {
      const { cred, did } = e.detail || {};
      syncCredential(cred, did);
    });

    // 3. Watch localStorage changes (e.g. from other tabs)
    window.addEventListener('storage', () => {
      syncCredential(
        localStorage.getItem('hsi_credential'),
        localStorage.getItem('hsi_did')
      );
    });
    return;
  }

  // ─── Site-specific selectors ───────────────────────────────────────────────
  const SITE_CONFIGS = [
    // GitHub
    {
      key: 'github',
      match: /github\.com/,
      selectors: [
        'span.p-nickname',        // profile @username (login)
        'span.p-name',            // profile display name
        '.author a',              // issue/PR author
        '.timeline-comment-header .author',
        'a.user-mention',
        '.commit-author',
      ],
      type: 'inline',
    },
    // Reddit (new UI)
    {
      key: 'reddit',
      match: /reddit\.com/,
      selectors: [
        'a[data-testid="post_author_link"]',
        'a[data-testid="comment_author_link"]',
        'span[data-testid="post-author-username"]',
      ],
      type: 'inline',
    },
    // Twitter / X
    {
      key: 'x',
      match: /(twitter|x)\.com/,
      selectors: [
        '[data-testid="User-Name"] span',
        '[data-testid="UserName"] span',
      ],
      type: 'inline',
    },
    // Hacker News
    {
      key: 'hackernews',
      match: /news\.ycombinator\.com/,
      selectors: ['.hnuser', 'a.hnuser'],
      type: 'inline',
    },
    // Discord web
    {
      key: 'discord',
      match: /discord\.com/,
      selectors: [
        'span[class*="username"]',
        'h3[class*="name"]',
      ],
      type: 'inline',
    },
    // Telegram web
    {
      key: 'telegram',
      match: /web\.telegram\.org/,
      selectors: [
        '.peer-title',
        '.info .peer-title',
      ],
      type: 'inline',
    },
    // Instagram
    {
      key: 'instagram',
      match: /instagram\.com/,
      selectors: [
        'header section h2',                    // profile username
        'a[role="link"] span._aacl',            // story/post username
        'div._aacl._aaco._aacu._aacx._aad7',   // comment username
        'span.x1lliihq[dir="auto"]',            // generic username span
      ],
      type: 'inline',
    },
    // Substack
    {
      key: 'substack',
      match: /substack\.com/,
      selectors: [
        'a.reader2-post-author',                // article author
        '.pencraft .name',                      // author name block
        'a[data-testid="user-profile-link"]',   // comment author
        'span.reader2-clamp-line',              // subscriber display name
        'h3.maybe-you-know-name',               // suggested author
      ],
      type: 'inline',
    },
    // YouTube
    {
      key: 'youtube',
      match: /youtube\.com/,
      selectors: [
        'ytd-channel-name a',                   // channel name in video
        '#owner #channel-name a',               // channel owner
        '#author-text span',                    // comment author
        'yt-formatted-string#text.ytd-channel-name',
      ],
      type: 'inline',
    },
    // LinkedIn
    {
      key: 'linkedin',
      match: /linkedin\.com/,
      selectors: [
        'h1.text-heading-xlarge',               // profile name
        'span.feed-shared-actor__name',         // post author
        'span.comments-post-meta__name',        // comment author
        'a.app-aware-link span[aria-hidden]',   // inline name
      ],
      type: 'inline',
    },
    // Stack Overflow / Stack Exchange
    {
      key: 'stackoverflow',
      match: /stackoverflow\.com|stackexchange\.com/,
      selectors: [
        '.user-details a',                      // post author
        '#question-header + div .user-details a',
        'a.comment-user',
      ],
      type: 'inline',
    },
    // Habr
    {
      key: 'habr',
      match: /habr\.com/,
      selectors: [
        'a.tm-user-info__username',             // article author
        'a.username',
        '.comment__author a',
      ],
      type: 'inline',
    },
    // Mastodon (major instances; other instances excluded by design for v1)
    {
      key: 'mastodon',
      match: /mastodon\.(social|online|world|cloud)|fosstodon\.org|hachyderm\.io/,
      selectors: [
        '.account__header__tabs__name h1',      // profile page display name
        '.display-name strong',                 // posts feed author
        '.status__display-name strong',         // status author
      ],
      type: 'inline',
    },
    // Bluesky
    {
      key: 'bluesky',
      match: /bsky\.app/,
      selectors: [
        '[data-testid="profileHeaderHandle"]',  // profile @handle
        '[data-testid="postAuthor"]',           // post author (may change)
      ],
      type: 'inline',
    },
    // Facebook
    {
      key: 'facebook',
      match: /facebook\.com/,
      selectors: [
        'h1[class]',                            // profile page name
        '[data-hovercard-prefer-name-as-fallback]',
      ],
      type: 'inline',
    },
    // TikTok
    {
      key: 'tiktok',
      match: /tiktok\.com/,
      selectors: [
        '[data-e2e="user-page-title"]',         // profile @username
        '[data-e2e="comment-username-1"]',      // comment author
      ],
      type: 'inline',
    },
    // Pinterest
    {
      key: 'pinterest',
      match: /pinterest\.(com|co\.uk|fr|de|es|ru)/,
      selectors: [
        '[data-test-id="profile-username"]',    // profile page username
        'h1[data-test-id]',
      ],
      type: 'inline',
    },
    // Medium
    {
      key: 'medium',
      match: /medium\.com/,
      selectors: [
        'a[rel="author"]',                      // article byline
        '[data-testid="authorName"]',           // profile page
        'h2.pw-author-name',
      ],
      type: 'inline',
    },
    // Dev.to
    {
      key: 'devto',
      match: /dev\.to/,
      selectors: [
        '.profile-header-details h1',           // profile page
        '.comment-details .username a',         // comment author
        '.article-header a.user-pic + div span',
      ],
      type: 'inline',
    },
    // GitLab
    {
      key: 'gitlab',
      match: /gitlab\.com/,
      selectors: [
        '.user-info .name',                     // profile page
        'a.author-link',                        // commit author
        '.commit-author-link',
        '.gfm-project_member',                  // @mention
      ],
      type: 'inline',
    },
    // Twitch
    {
      key: 'twitch',
      match: /twitch\.tv/,
      selectors: [
        'h1[class*="tw-title"]',                // channel header
        '.chat-author__display-name',           // chat username
        '[data-a-target="user-channel-header-item"]',
      ],
      type: 'inline',
    },
    // Quora
    {
      key: 'quora',
      match: /quora\.com/,
      selectors: [
        '[class*="UserName"]',                  // answer/question author
        'span.q-box.qu-userSelect--text',
      ],
      type: 'inline',
    },
    // Notion
    {
      key: 'notion',
      match: /notion\.so/,
      selectors: [
        '[class*="userAvatar"] + span',         // page author
        '.notion-record-icon + [class*="title"]',
      ],
      type: 'inline',
    },
    // WhatsApp Web
    {
      key: 'whatsapp',
      match: /web\.whatsapp\.com/,
      selectors: [
        '[data-testid="contact-info-subtitle"]', // contact name in info panel
        'header ._ao3e',                         // active chat header name
        'span[data-testid="author"]',            // message author in groups
      ],
      type: 'inline',
    },
  ];

  // ─── Badge SVG (inline, no external request needed) ────────────────────────
  function createBadgeElement(credential) {
    const badge = document.createElement('span');
    badge.className = 'hsi-badge';
    badge.setAttribute('title', `Verified Human · ${credential.did?.slice(0, 20)}... · Confidence: ${Math.round((credential.confidence ?? 0) * 100)}% · ${credential.daysLeft}d left`);
    badge.setAttribute('aria-label', 'Verified Human by HSI');
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-left: 5px;
      padding: 1px 6px;
      background: linear-gradient(135deg, #7c3aed, #06b6d4);
      border-radius: 20px;
      font-size: 10px;
      font-weight: 700;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      vertical-align: middle;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(124,58,237,0.3);
      line-height: 1.6;
      position: relative;
      z-index: 9999;
    `;
    badge.textContent = '✦ Human';

    // Click opens info tooltip
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showBadgeTooltip(badge, credential);
    });

    return badge;
  }

  // ─── Tooltip overlay ───────────────────────────────────────────────────────
  let activeTooltip = null;

  function showBadgeTooltip(anchor, credential) {
    if (activeTooltip) activeTooltip.remove();

    const tooltip = document.createElement('div');
    tooltip.className = 'hsi-tooltip';

    const did = credential.did ?? 'unknown';
    const shortDid = did.length > 20 ? did.slice(0, 16) + '...' + did.slice(-6) : did;
    const conf = Math.round((credential.confidence ?? 0) * 100);
    const issued = credential.issuanceDate
      ? new Date(credential.issuanceDate).toLocaleDateString()
      : '—';
    const daysLeft = credential.daysLeft ?? '?';

    tooltip.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">✦</div>
        <div>
          <div style="font-weight:800;font-size:13px;color:#111827;">Verified Human</div>
          <div style="font-size:10px;color:#7c3aed;font-weight:600;">APTOGON · homosapience.org</div>
        </div>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:11px;line-height:1.8;">
        <div><span style="color:#9ca3af;">DID:</span> <span style="font-family:monospace;color:#374151;">${shortDid}</span></div>
        <div><span style="color:#9ca3af;">Confidence:</span> <span style="color:#059669;font-weight:700;">${conf}%</span></div>
        <div><span style="color:#9ca3af;">Verified:</span> <span style="color:#374151;">${issued}</span></div>
        <div><span style="color:#9ca3af;">Valid for:</span> <span style="color:#374151;">${daysLeft} days</span></div>
      </div>
      <div style="font-size:10px;color:#9ca3af;text-align:center;">
        Gesture biometrics · Ed25519 · Aptos on-chain
      </div>
    `;

    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: white;
      border: 1.5px solid #e9d5ff;
      border-radius: 14px;
      padding: 14px 16px;
      width: 240px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      font-family: Inter, system-ui, sans-serif;
    `;

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    // Position near anchor
    const rect = anchor.getBoundingClientRect();
    const tooltipLeft = Math.min(rect.left, window.innerWidth - 260);
    const tooltipTop = rect.bottom + 8;
    tooltip.style.left = tooltipLeft + 'px';
    tooltip.style.top = tooltipTop + 'px';

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', () => {
        tooltip.remove();
        activeTooltip = null;
      }, { once: true });
    }, 0);
  }

  // ─── Main injection logic ──────────────────────────────────────────────────
  let credential = null;
  let handles = {};            // { github: 'alex_dev', reddit: 'alex', ... }
  let injectedCount = 0;
  const INJECTED_ATTR = 'data-hsi-badge';

  // Normalize a username for comparison: trim, drop leading u/ or @, lowercase.
  function normHandle(s) {
    return (s || '').trim().replace(/^u\//i, '').replace(/^@/, '').toLowerCase();
  }

  function injectBadges() {
    if (!credential || credential.status !== 'valid') return;

    const config = SITE_CONFIGS.find(c => c.match.test(location.hostname));
    if (!config) return;

    // Option A — only badge the holder's OWN username on this site.
    // Anonymous DIDs can't be mapped to arbitrary users' handles, so badging
    // everyone would be misleading. The user declares their handle per site.
    const myHandle = normHandle(handles[config.key]);
    if (!myHandle) return;

    for (const selector of config.selectors) {
      const elements = document.querySelectorAll(selector + `:not([${INJECTED_ATTR}])`);
      elements.forEach(el => {
        el.setAttribute(INJECTED_ATTR, '1');
        if (normHandle(el.textContent) !== myHandle) return;
        const badge = createBadgeElement(credential);
        el.parentNode?.insertBefore(badge, el.nextSibling);
        injectedCount++;
      });
    }
  }

  // Request credential from background, then load the user's declared handles.
  function init() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CREDENTIAL' }, (response) => {
      if (chrome.runtime.lastError) return;
      credential = response;
      if (!credential || credential.status !== 'valid') return;

      chrome.storage.local.get('hsi_handles', (res) => {
        handles = res.hsi_handles || {};
        injectBadges();

        // Watch for dynamic content (SPAs)
        const observer = new MutationObserver(() => injectBadges());
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });
    } catch (e) {
      // Extension context invalidated (e.g. after reload) — ignore silently
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
