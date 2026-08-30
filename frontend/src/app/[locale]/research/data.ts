// frontend/src/app/[locale]/research/data.ts
// Curated, English content for the /research page. Methodology + qualitative
// capability comparison. No invented competitor numbers (their internals are
// not publicly verifiable) — see DISCLAIMER. Our own figures are the live
// counter on the page, sourced from real risk_events.

export interface AttackClass { id: string; name: string; what: string; aptogon: string }
export interface Capability { id: string; label: string; highlight?: boolean }
export type Cell = 'yes' | 'partial' | 'no' | 'na'
export interface CompetitorRow {
  name: string
  values: Record<string, Cell>
  note?: string
}

export const ATTACK_CLASSES: AttackClass[] = [
  {
    id: 'headless',
    name: 'Headless browsers',
    what: 'Automated Chromium/Firefox (Selenium, Puppeteer, Playwright) with no real display.',
    aptogon: 'Client signals (navigator.webdriver, missing plugins, headless UA) + a human-timed gesture challenge the script cannot reproduce.',
  },
  {
    id: 'agentic_browser',
    name: 'Agentic / AI browsers',
    what: 'LLM-driven browsers that act human-like (move the mouse, scroll) but run via automation frameworks.',
    aptogon: 'We separate behaviour from artifacts: human-like motion + automation signatures (CDP, webdriver) flags the session as an AI agent, not a human.',
  },
  {
    id: 'scripted',
    name: 'Scripted requests',
    what: 'Direct API hammering / replay without a real browser.',
    aptogon: 'Per-IP rate limits, single-use nonces, and a signed short-lived token that must be redeemed server-side stop blind replay.',
  },
  {
    id: 'sybil_farm',
    name: 'Sybil farms',
    what: 'Many fake "humans" from one operator (click farms, emulators) to fake uniqueness.',
    aptogon: 'Device-fingerprint + IP velocity limits and the bond/vouch trust graph make many-identities-per-operator expensive — the uniqueness angle below.',
  },
]

export const CAPABILITIES: Capability[] = [
  { id: 'human_verification', label: 'Human verification' },
  { id: 'bot_detection',      label: 'Bot detection' },
  { id: 'sybil_resistance',   label: 'Sybil-resistance', highlight: true },
  { id: 'privacy',            label: 'Privacy (zero-PII)' },
  { id: 'portable_proof',     label: 'Portable proof' },
  { id: 'blockchain_proof',   label: 'On-chain proof', highlight: true },
  { id: 'biometrics_stored',  label: 'Biometrics stored' },
  { id: 'docs_required',      label: 'Govt ID required' },
  { id: 'open_source',        label: 'Open-source' },
  { id: 'org_integration',    label: 'Org integration' },
  { id: 'red_team',           label: 'Red-team program', highlight: true },
  { id: 'bug_bounty',         label: 'Bug bounty' },
]

// Qualitative, methodology-based. See DISCLAIMER.
export const COMPETITORS: CompetitorRow[] = [
  {
    name: 'APTOGON',
    values: {
      human_verification: 'yes', bot_detection: 'yes', sybil_resistance: 'yes',
      privacy: 'yes', portable_proof: 'yes', blockchain_proof: 'yes',
      biometrics_stored: 'no', docs_required: 'no', open_source: 'yes',
      org_integration: 'yes', red_team: 'yes', bug_bounty: 'yes',
    },
    note: 'Gesture + DID + on-chain proof (Aptos); returns a portable verifiable assertion. Zero biometrics collected or retained. Internal red-team attack simulator + active bug bounty.',
  },
  {
    name: 'Worldcoin',
    values: {
      human_verification: 'yes', bot_detection: 'partial', sybil_resistance: 'yes',
      privacy: 'no', portable_proof: 'yes', blockchain_proof: 'partial',
      biometrics_stored: 'yes', docs_required: 'no', open_source: 'partial',
      org_integration: 'partial', red_team: 'yes', bug_bounty: 'yes',
    },
    note: 'Strong uniqueness via iris biometrics — at the cost of biometric collection. ZK-proofs on Optimism. Immunefi bug bounty up to $1M for smart contracts.',
  },
  {
    name: 'BrightID',
    values: {
      human_verification: 'yes', bot_detection: 'no', sybil_resistance: 'yes',
      privacy: 'yes', portable_proof: 'yes', blockchain_proof: 'yes',
      biometrics_stored: 'no', docs_required: 'no', open_source: 'yes',
      org_integration: 'partial', red_team: 'no', bug_bounty: 'no',
    },
    note: 'Social graph-based verification — humans vouch for each other in video calls. No biometrics. Ethereum-based proof. No session/bot detection. No formal security program.',
  },
  {
    name: 'VerifyYou',
    values: {
      human_verification: 'yes', bot_detection: 'partial', sybil_resistance: 'yes',
      privacy: 'no', portable_proof: 'yes', blockchain_proof: 'no',
      biometrics_stored: 'yes', docs_required: 'partial', open_source: 'no',
      org_integration: 'yes', red_team: 'partial', bug_bounty: 'no',
    },
    note: 'Mobile-first selfie + facial recognition; optionally scans ID documents. Biometrics retained server-side for up to 3 years. No public bug bounty program.',
  },
  {
    name: 'KYC (Onfido / Persona)',
    values: {
      human_verification: 'yes', bot_detection: 'partial', sybil_resistance: 'partial',
      privacy: 'no', portable_proof: 'partial', blockchain_proof: 'no',
      biometrics_stored: 'yes', docs_required: 'yes', open_source: 'no',
      org_integration: 'yes', red_team: 'yes', bug_bounty: 'partial',
    },
    note: 'Government ID + selfie required. Gold standard for financial compliance. Onfido has a Bugcrowd responsible disclosure program; Persona has a security page without paid bounty.',
  },
  {
    name: 'Cloudflare Turnstile',
    values: {
      human_verification: 'partial', bot_detection: 'yes', sybil_resistance: 'no',
      privacy: 'partial', portable_proof: 'no', blockchain_proof: 'no',
      biometrics_stored: 'no', docs_required: 'no', open_source: 'no',
      org_integration: 'yes', red_team: 'yes', bug_bounty: 'yes',
    },
    note: 'Invisible bot score per session; not an identity layer. Cloudflare has a dedicated security research team and HackerOne bug bounty.',
  },
  {
    name: 'Roundtable',
    values: {
      human_verification: 'no', bot_detection: 'yes', sybil_resistance: 'no',
      privacy: 'partial', portable_proof: 'no', blockchain_proof: 'no',
      biometrics_stored: 'no', docs_required: 'no', open_source: 'no',
      org_integration: 'yes', red_team: 'no', bug_bounty: 'no',
    },
    note: 'Behavioural fraud/bot score per session — answers "is this a bot?", not "is this a unique human?". No public security program.',
  },
]

export const DISCLAIMER =
  "Comparison is methodological, based on publicly available product documentation. " +
  "Competitors' internal detection metrics are not independently verifiable, so we " +
  "compare capabilities, not invented percentages. APTOGON's own numbers are the live " +
  "counter below, drawn from real sessions."
