export const metadata = {
  title: 'Privacy Policy — APTOGON',
  description: 'How APTOGON handles your data: minimal collection, no tracking, on-chain pseudonymity.',
}

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: '1. Who we are',
    body: (
      <>
        <p>This privacy notice describes how APTOGON (a service operated under the
        name homosapience.org) processes personal data.</p>
        <p><strong>Data controller:</strong> Alexander Tulubyev.<br />
        <strong>Contact:</strong> alt@in2sys.fr<br />
        <strong>Effective:</strong> TBD-publish-date</p>
      </>
    ),
  },
  {
    title: '2. Summary',
    body: (
      <p>We collect the minimum data needed to verify a human and to operate the
      social features of the network. We do not request your name, email, phone
      number, or government ID. We do not use any third-party analytics or
      tracking tools. Your private cryptographic key is generated and held only
      in your browser; we never see it.</p>
    ),
  },
  {
    title: '3. What data we process',
    body: (
      <>
        <table className="prv-table">
          <thead>
            <tr><th>Data</th><th>Source</th><th>Storage</th><th>Retention</th></tr>
          </thead>
          <tbody>
            <tr><td>Public DID</td><td>Generated in your browser</td><td>Redis sessions; PostgreSQL <code>credentials</code></td><td>Until you revoke</td></tr>
            <tr><td>Private key</td><td>Generated in your browser</td><td>Browser <code>localStorage</code> (never transmitted)</td><td>Until you clear browser data</td></tr>
            <tr><td>IP address</td><td>HTTP requests</td><td>Redis session entry</td><td>~1 hour (JWT TTL + 5 min grace)</td></tr>
            <tr><td>User-Agent (first 120 chars)</td><td>HTTP requests</td><td>Redis session entry</td><td>~1 hour</td></tr>
            <tr><td>Display name (optional)</td><td>You</td><td>PostgreSQL</td><td>Until you remove</td></tr>
            <tr><td>Avatar URL (optional)</td><td>You</td><td>PostgreSQL</td><td>Until you remove</td></tr>
            <tr><td>Bond relationships</td><td>Your actions</td><td>PostgreSQL <code>bonds</code></td><td>Until you remove</td></tr>
            <tr><td>Chat messages</td><td>You</td><td>PostgreSQL <code>messages</code></td><td>Per chat module policy</td></tr>
            <tr><td>Uploaded files</td><td>You</td><td>Server filesystem</td><td>4-day warning, deleted at 5 days</td></tr>
            <tr><td>Donation amount + transaction ID</td><td>CloudTips checkout</td><td>CloudTips servers (not ours)</td><td>Per CloudTips policy</td></tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    title: '4. Legal basis (GDPR Art. 6)',
    body: (
      <>
        <table className="prv-table">
          <thead><tr><th>Processing</th><th>Basis</th></tr></thead>
          <tbody>
            <tr><td>Issuing a credential after verification</td><td>Contract (Art. 6(1)(b)) — service you requested</td></tr>
            <tr><td>Maintaining your session (IP, UA)</td><td>Legitimate interest (Art. 6(1)(f)) — abuse prevention</td></tr>
            <tr><td>Storing display name, avatar, bonds</td><td>Consent (Art. 6(1)(a)) — optional, you control</td></tr>
            <tr><td>Processing donations</td><td>Contract (Art. 6(1)(b)) — voluntary payment</td></tr>
            <tr><td>Publishing on-chain hash</td><td>Contract (Art. 6(1)(b)) — required for verification mechanism</td></tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    title: '5. What we do not process',
    body: (
      <ul>
        <li>The raw gesture trace, motion vectors, or biometric data — these are extracted and discarded in your browser within ~10 seconds.</li>
        <li>Your browsing history. The browser extension does not read page content or report which sites you visit.</li>
        <li>Your name, email address, phone number, or government identifiers.</li>
        <li>Behavioural analytics (no Google Analytics, no Meta Pixel, no Hotjar, no Sentry).</li>
      </ul>
    ),
  },
  {
    title: '6. Third parties and sub-processors',
    body: (
      <>
        <p>The following external services may receive data when you use APTOGON:</p>
        <ul>
          <li><strong>Aptos Labs</strong> (RPC fullnodes) — receives the on-chain credential lookup request and your IP. <a href="https://aptoslabs.com/privacy">aptoslabs.com/privacy</a></li>
          <li><strong>Gonka Network</strong> (decentralised GPU compute) — receives the gesture statistical vector (numeric motion features, no images, no coordinates) for human-pattern classification. <a href="https://gonka.ai">gonka.ai</a></li>
          <li><strong>OpenRouter</strong> (fallback AI inference) — receives the same statistical vector when Gonka is unavailable. Acts as a Data Processor under our instructions; a Data Processing Agreement is in progress.</li>
          <li><strong>CloudTips</strong> (donation processor) — receives standard payment data (amount, optional name) only when you voluntarily donate. CloudTips is operated from the Russian Federation. <a href="https://cloudtips.ru">cloudtips.ru</a></li>
          <li><strong>Google Chrome runtime</strong> (when using the extension) — standard Chrome storage and messaging APIs. APTOGON does not send any data to Google servers itself.</li>
        </ul>
      </>
    ),
  },
  {
    title: '7. On-chain data',
    body: (
      <>
        <p>Successful verifications are recorded as a <code>HumanCredential</code> on the
        Aptos blockchain. On-chain data is <strong>public and immutable</strong> — once
        written, it cannot be modified or deleted by us or by you.</p>

        <p><strong>What is stored on-chain:</strong></p>
        <ul>
          <li>The SHA3-256 hash of your public DID</li>
          <li>A timestamp of when verification occurred</li>
          <li>The credential&apos;s expiry timestamp</li>
        </ul>

        <p><strong>What is NOT stored on-chain:</strong></p>
        <ul>
          <li>Your name, email, IP address, or any contact information</li>
          <li>The gesture pattern, motion vectors, or any biometric data</li>
          <li>Your browsing history or pages where you displayed your badge</li>
          <li>Your private key (which never leaves your browser)</li>
        </ul>

        <p><strong>Right to erasure (GDPR Art. 17):</strong> Because of blockchain
        immutability, we cannot delete on-chain hashes once written. However:</p>
        <ul>
          <li>The credential automatically expires after 30 days and is no longer
          accepted by APTOGON services.</li>
          <li>The hash alone does not identify you — only you, holding the matching
          private key, can prove ownership.</li>
          <li>You can revoke your DID locally; without your continued cooperation,
          the on-chain hash remains a pseudonymous artefact with no link to identity.</li>
        </ul>

        <p>If you are a data subject in a jurisdiction that requires on-chain erasure,
        please contact us via the address in §10 and we will explain mitigations
        available.</p>
      </>
    ),
  },
  {
    title: '8. Retention',
    body: (
      <ul>
        <li>Authentication nonces: 60 seconds, single-use.</li>
        <li>Session entries (IP, UA, expiry): JWT TTL + 5 minutes (~1 hour 5 minutes by default).</li>
        <li>Uploaded files: warning at 4 days, automatic deletion at 5 days.</li>
        <li>Credentials, bonds, display name: kept until you revoke or remove them.</li>
        <li>On-chain hashes: permanent (see §7 for limitations).</li>
      </ul>
    ),
  },
  {
    title: '9. Your rights (GDPR Art. 12–22)',
    body: (
      <ul>
        <li><strong>Access</strong> — request a copy of what we hold about you.</li>
        <li><strong>Rectification</strong> — correct inaccurate data.</li>
        <li><strong>Erasure</strong> — delete your account-side data. On-chain hashes have the limitation described in §7.</li>
        <li><strong>Portability</strong> — receive your data in a machine-readable form.</li>
        <li><strong>Restriction</strong> — ask us to stop processing while a dispute is resolved.</li>
        <li><strong>Objection</strong> — object to processing based on legitimate interest.</li>
        <li><strong>Complaint</strong> — lodge a complaint with your local supervisory authority.</li>
      </ul>
    ),
  },
  {
    title: '10. How to exercise your rights',
    body: (
      <p>Email <a href="mailto:alt@in2sys.fr">alt@in2sys.fr</a>. We aim to respond within 30 days. If we need more time, we will tell you why.</p>
    ),
  },
  {
    title: '11. International transfers',
    body: (
      <p>Our servers are located in Latvia (European Economic Area). When you use
      APTOGON, your IP address and session data are processed within the EEA. The
      Aptos blockchain is a global public ledger; nodes are operated worldwide.
      Aptos Labs RPC infrastructure may process data outside the EEA. Donations
      via CloudTips are processed in the Russian Federation; this is a transfer
      outside the EEA, which you initiate yourself when you choose to donate.</p>
    ),
  },
  {
    title: '12. Cookies',
    body: (
      <p>We set only one cookie: <code>NEXT_LOCALE</code>, which remembers your
      chosen language. It is set for one year with <code>SameSite=Lax</code> and
      contains no personal information. We do not set any tracking or
      advertising cookies.</p>
    ),
  },
  {
    title: '13. Updates',
    body: (
      <p>This policy is versioned via the project&apos;s public git history. Material
      changes will be announced in the extension update notes and on the
      homosapience.org front page.</p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <main style={{ background: '#0a0f1a', minHeight: '100vh', padding: '60px 24px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        .prv-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0; }
        .prv-table th, .prv-table td { border: 1px solid rgba(255,255,255,0.08); padding: 8px 10px; text-align: left; vertical-align: top; color: #94a3b8; }
        .prv-table th { background: rgba(255,255,255,0.03); color: #cbd5e1; font-weight: 600; }
        .prv-table code { font-size: 12px; color: #cbd5e1; }
      `}</style>
      <div style={{ maxWidth: 760, margin: '0 auto', color: '#cbd5e1' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#f1f5f9', marginBottom: 8 }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: 13, color: '#475569', marginBottom: 48 }}>
          APTOGON / homosapience.org
        </p>

        {SECTIONS.map(({ title, body }) => (
          <section key={title} style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>
              {title}
            </h2>
            <div style={{ fontSize: 14, lineHeight: 1.75, color: '#94a3b8' }}>
              {body}
            </div>
          </section>
        ))}

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 24, marginTop: 48, fontSize: 12, color: '#334155' }}>
          APTOGON is open source — AGPL-3.0 (commercial license available) · homosapience.org
        </div>
      </div>
    </main>
  )
}
