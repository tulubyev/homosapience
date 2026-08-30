# APTOGON Verified Human — Browser Extension

Chrome/Firefox extension that shows a **✦ Human** badge on any website where you have a valid HumanCredential from [homosapience.org](https://homosapience.org).

## How It Works

1. Verify your humanity at [homosapience.org/verify](https://homosapience.org/verify) (~10 seconds, gesture-based)
2. The extension reads your HumanCredential from local storage
3. In the extension popup, under **My handles**, enter your username for each site (e.g. GitHub `alex_dev`)
4. On those sites, the `✦ Human` badge appears next to **your own** username
5. Click the badge to see your DID, AI confidence score, and expiry date

> **The badge marks _your_ verified humanity, not other people's.** A verification
> produces an anonymous DID with no link to social handles, so the extension
> cannot tell whether another user is verified — it only displays your own proof
> next to the handle you declared. Cross-user "is this account human?" is a
> platform-level concern (see the API roadmap).

## Supported Sites

The badge can appear next to your declared handle on:

| Site | Where your handle appears |
|------|---------------|
| GitHub | Profile name, issue/PR authors, comments |
| Reddit | Post and comment authors |
| Twitter / X | User display names |
| Hacker News | Username links |
| Discord Web | Usernames in chat |
| Telegram Web | Peer titles |
| Instagram | Profile and comment usernames |
| YouTube | Channel names, comment authors |
| LinkedIn | Profile name, post and comment authors |
| Substack | Article authors, comment authors |
| Stack Overflow | Question and answer authors |
| Habr | Article and comment authors |
| Mastodon | Profile and post authors (major instances) |
| Bluesky | Profile handle, post authors |
| Facebook | Profile name |
| TikTok | Profile username, comment authors |
| Pinterest | Profile username |
| Medium | Article byline, author profile |
| Dev.to | Profile, article and comment authors |
| GitLab | Profile, commit and MR authors |
| Twitch | Channel header, chat usernames |
| Quora | Answer and question authors |
| Notion | Page author (where displayed) |
| WhatsApp Web | Contact name in chat header and group messages |

More sites coming via community contributions.

## Installation (Developer Mode)

1. Clone/download this folder
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the `browser-extension` folder
5. The APTOGON icon appears in your toolbar

## Install in Firefox

Requires **Firefox 121+** (Manifest V3 with `service_worker` background).

1. Open Firefox → `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.json`

The extension uses a single cross-browser Manifest V3. The
`browser_specific_settings.gecko.id` key makes it installable in Firefox;
Chrome ignores that key. For a permanent install, the add-on must be
signed via [addons.mozilla.org](https://addons.mozilla.org).

## Privacy

- Your **private key never leaves the browser** (Ed25519, generated and held via WebCrypto with `extractable: false`)
- The extension sends only your **public DID** to `homosapience.org/api/verify/status` to confirm the credential is currently valid
- **Bond approve/reject** actions are signed locally with your private key and posted to the homosapience.org API
- The extension does **not** read page content, browsing history, or send page data anywhere
- The badge is injected client-side from a static list of CSS selectors compiled into the extension
- No analytics, no tracking pixels, no telemetry

## Credential Sync

The extension automatically syncs your credential when you visit `homosapience.org`. No manual action needed after verification.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension metadata (Manifest V3) |
| `background.js` | Service worker: credential storage & sync |
| `content.js` | Badge injection into web pages |
| `popup.html/js` | Extension popup UI |
| `badge.svg` | Badge SVG asset |
| `icons/` | Extension icons (16/48/128px) |

## Roadmap

- [ ] Firefox MV2 compatibility (`browser.storage` polyfill)
- [ ] Chrome Web Store publish
- [ ] On-chain verification check in popup
- [ ] HSI Bond display (vouching count)
- [ ] Export credential as QR code
- [ ] Dark mode for popup
- [ ] More sites: Farcaster, Lens, and community contributions
