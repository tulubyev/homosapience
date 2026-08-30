export type ContentBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; text: string; author?: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'callout'; text: string }
  | { type: 'divider' }
  | { type: 'link'; text: string; href: string }

export type Post = {
  slug: string
  title: string
  subtitle: string
  date: string
  category: string
  series: string
  readingTime: string
  color: string
  content: ContentBlock[]
}

export const POSTS: Post[] = [
  {
    slug: 'why-captcha-is-broken',
    title: 'Why CAPTCHA Is Broken in 2025',
    subtitle: 'AI agents solve image challenges with 99%+ accuracy. Audio CAPTCHAs fall to speech recognition. The friction arms race is over — and bots won.',
    date: '2025-11-14',
    category: 'The Bot Problem',
    series: 'The Bot Problem',
    readingTime: '7 min',
    color: '#7c3aed',
    content: [
      { type: 'p', text: 'CAPTCHA was born in 2000 as a clever idea: make the test hard for machines and easy for humans. For a decade, it worked. Squiggly text, skewed letters, and noisy backgrounds were trivial for human eyes and impossible for the OCR engines of the time.' },
      { type: 'p', text: "That era is over. Today, AI vision models solve Google's reCAPTCHA image challenges at 99.8% accuracy. Audio CAPTCHAs are transcribed by speech recognition in under a second. And when AI fails, human CAPTCHA farms in Eastern Europe and Southeast Asia solve thousands of challenges per hour for $1 per thousand. Bots don't need to defeat CAPTCHA — they just outsource it." },
      { type: 'h2', text: 'The Arms Race Nobody Wins' },
      { type: 'p', text: "CAPTCHA providers haven't sat still. reCAPTCHA v3 moved away from challenges entirely, scoring users based on behavioral signals — mouse movements, scrolling patterns, typing cadence. Cloudflare Turnstile went further, using a combination of JavaScript environment checks, TLS fingerprinting, and proof-of-work to assess bot likelihood without visible friction." },
      { type: 'p', text: 'The problem is structural. Every improvement in bot detection is met by a targeted countermeasure. Headless Chrome gained stealth plugins that fake the JS environment variables Turnstile checks. Browser automation tools like Playwright and Puppeteer now have human-like mouse movement libraries. Browser farms — real Chrome instances running on real operating systems — render environment fingerprinting useless because there is no fake environment to detect.' },
      { type: 'callout', text: '40% of all internet traffic is non-human — bots, scrapers, and automated scripts. Among that 40%, a growing fraction is specifically designed to evade detection systems.' },
      { type: 'h2', text: "What CAPTCHA Was Never Testing" },
      { type: 'p', text: 'The deeper issue is that CAPTCHA tests the wrong thing. "Can you solve this visual puzzle?" is not the same as "Are you a unique human?" A CAPTCHA proves computational capability — which AI now has in abundance. It never proved identity, uniqueness, or physical presence.' },
      { type: 'p', text: 'Consider what actually matters to the businesses deploying CAPTCHA:' },
      { type: 'ul', items: [
        'A survey platform needs to know each respondent is a distinct person — not whether they can identify fire hydrants in a photo grid',
        'A community forum needs to know a new account belongs to a human who wasn\'t just banned — not whether they can type distorted text',
        'A DAO governance vote needs one-person-one-vote — not whether the voter can click the right images',
        'An airdrop needs to reach real humans, not wallet farms — not whether each wallet solved a CAPTCHA',
      ]},
      { type: 'p', text: 'CAPTCHA addresses none of these needs. It is a speed bump, not a gate.' },
      { type: 'h2', text: 'The Invisible CAPTCHA Era' },
      { type: 'p', text: "The industry's response to CAPTCHA fatigue was to make the challenge invisible — shifting the burden from explicit puzzles to passive behavioral analysis. This is better UX. It is not better security." },
      { type: 'p', text: 'Behavioral fingerprinting scores users on signals like mouse trajectory, scroll patterns, and typing rhythm. The assumption is that bots move differently than humans. This was true in 2015. In 2025, machine learning models trained on millions of human interaction recordings can generate synthetic mouse movements that are statistically indistinguishable from real ones. Tools like ghost-cursor exist precisely for this.' },
      { type: 'p', text: 'More fundamentally: even if you perfectly detect a bot session, you have no mechanism to link that session to a persistent identity. The bot just opens a new session. IP rotation is cheap. Browser fingerprints are resettable. Email addresses are free. The detection window is per-session; the attacker\'s cost is near-zero.' },
      { type: 'h2', text: 'What Actually Works' },
      { type: 'p', text: "The only defenses that hold are those that impose costs that can't be parallelized across fake identities:" },
      { type: 'ul', items: [
        'Device binding — tying an identity to specific hardware, so a single physical device can only be one person',
        'On-chain credentials — a cryptographic proof anchored to the Aptos blockchain, unforgeable and auditable',
        'Behavioral biometrics at the muscle level — not "did the mouse move," but "does the neuromuscular signature of this gesture match a human"',
        'Social graph clustering — isolated identities with no human vouching are statistically suspicious',
      ]},
      { type: 'p', text: "CAPTCHA's fundamental design premise — that cognitive tasks discriminate humans from machines — is broken. The solution isn't a harder puzzle. It's a different test entirely." },
      { type: 'h2', text: "APTOGON's Approach" },
      { type: 'p', text: 'APTOGON asks users to perform a short gesture challenge — not to test cognitive ability, but to capture the neuromuscular signature of a real human performing a deliberate physical movement. The challenge is different every session (preventing replay), hardware-bound (preventing scale-out), and verified server-side (preventing injection).' },
      { type: 'p', text: 'The result is written to the Aptos blockchain as a HumanCredential — a permanent, auditable, tamper-proof record that this specific device was operated by a human at a specific time. Unlike a CAPTCHA score, this credential is portable: once verified, platforms can check it instantly without re-running the challenge.' },
      { type: 'p', text: "CAPTCHA is broken not because bots got smarter, but because it was measuring the wrong thing from the start. The question was never 'can you solve this?' — it was always 'are you one unique human?'" },
    ],
  },
  {
    slug: 'aptogon-vs-verifyyou',
    title: 'APTOGON vs VerifyYou: No Biometrics vs. Facial Recognition',
    subtitle: 'Both claim to solve the same problem. They make fundamentally different bets on privacy, compliance, and threat models. Here\'s how to choose.',
    date: '2025-11-21',
    category: 'APTOGON vs.',
    series: 'APTOGON vs.',
    readingTime: '8 min',
    color: '#0891b2',
    content: [
      { type: 'p', text: "VerifyYou is one of the closest things to a real competitor in the human-verification space. Founded by Marty Weiner (ex-CTO of Reddit) and well-funded, it targets the same verticals — market research, AI labeling, community platforms. It's worth taking seriously as a comparison, because the differences between APTOGON and VerifyYou reveal fundamental design choices about privacy, compliance, and what \"verification\" actually means." },
      { type: 'h2', text: 'What VerifyYou Does' },
      { type: 'p', text: "VerifyYou's core mechanism is facial recognition — specifically a selfie match combined with phone number verification and behavioral signals. The user takes a photo or short video; VerifyYou's system compares it against its database to check for duplicates and synthetic faces. It's fast (~15 seconds) and demonstrably reduces fraud in market research panels." },
      { type: 'p', text: 'The biometric approach has real advantages. Facial geometry is highly unique — more so than device fingerprints or behavioral patterns. If your primary threat model is humans running multiple accounts, biometrics is a powerful discriminant. VerifyYou claims meaningful fraud reduction across its customer base, and those numbers appear credible.' },
      { type: 'h2', text: 'The Biometric Tradeoff' },
      { type: 'p', text: "Here's where the design philosophies diverge sharply. Storing biometric data creates risks that compound over time:" },
      { type: 'ul', items: [
        'A database breach exposes data you literally cannot change — you can reset a password, but not your face',
        'GDPR Article 9 and CCPA classify biometric data as "sensitive personal information" requiring explicit consent, right-to-erasure compliance, and data protection impact assessments',
        'NIST studies have documented accuracy disparities across demographic groups — facial recognition performs differently across ethnicities and genders',
        'Users in privacy-sensitive regions (EU, Brazil, Illinois) often refuse biometric consent entirely, reducing your coverage',
        'VerifyYou retains biometric data for 3 years by default — a multi-year liability window',
      ]},
      { type: 'p', text: "This doesn't mean VerifyYou is doing something wrong — it means biometric verification comes with a compliance and liability cost that doesn't show up in the $0.01–$0.03/verification price tag." },
      { type: 'h2', text: "APTOGON's Zero-PII Architecture" },
      { type: 'p', text: "APTOGON achieves sybil resistance without storing biometrics. The verification chain works like this:" },
      { type: 'ul', items: [
        'A device-bound DID (Decentralized Identifier) is generated from hardware characteristics and stored on the device — never on APTOGON servers',
        'A gesture challenge captures neuromuscular behavior in real-time; the raw signal is processed and discarded — only a behavioral hash is retained',
        'The device-bound credential is checked for cluster membership (are multiple DIDs correlated to the same physical hardware?)',
        'A SHA3-256 hash of the verification is written to the Aptos blockchain as a HumanCredential',
      ]},
      { type: 'p', text: "Nothing in this chain requires storing a face, a name, or a government ID. The anti-sybil guarantee comes from hardware binding (one physical device = one DID) and cluster detection, not biometric uniqueness." },
      {
        type: 'table',
        headers: ['', 'APTOGON', 'VerifyYou'],
        rows: [
          ['Core mechanism', 'Gesture + device-bound DID', 'Facial recognition + phone'],
          ['Biometrics stored', '✗ None', '✓ 3-year retention'],
          ['Govt ID required', '✗', '✗'],
          ['On-chain proof', '✓ Aptos blockchain', '✗'],
          ['GDPR sensitive data', '✗ Not applicable', '✓ Article 9 compliance required'],
          ['Open-source', '✓ AGPL-3.0', '✗ Proprietary'],
          ['Trust bands', 'newcomer | community | trusted', '✗ Not exposed'],
          ['Price/check', '~$0.01', '$0.01–$0.03'],
          ['Speed', '~10 sec', '~15 sec'],
          ['Portable credential', '✓ Cross-platform', '✗ Per-platform'],
        ],
      },
      { type: 'h2', text: 'Different Threat Models' },
      { type: 'p', text: "The honest answer is that these systems solve overlapping but not identical problems." },
      { type: 'p', text: "VerifyYou is stronger if your threat is the same human creating multiple accounts with different devices. Biometrics can catch this because the face doesn't change. Device binding cannot catch someone who owns 10 phones." },
      { type: 'p', text: "APTOGON is stronger if your threat is cloud-based automation at scale — bot farms, synthetic identities, AI agents, click farms. Hardware-bound DIDs and gesture liveness are extremely resistant to automation. And for the 10-phones attacker, cluster detection on the bond graph flags isolated high-volume DIDs." },
      { type: 'p', text: "For most market research and community platform use cases, the dominant threat is automation, not the determined human with 10 devices. APTOGON's threat model covers the 99% case." },
      { type: 'h2', text: 'Who Should Use Which' },
      { type: 'p', text: "Choose VerifyYou if: your regulatory environment allows biometric data collection, your threat model specifically includes humans with multiple physical devices, and you need biometric identity confidence (not just uniqueness)." },
      { type: 'p', text: "Choose APTOGON if: you need GDPR/CCPA-compatible sybil resistance with no biometric data liability, you want portable on-chain credentials your users can carry across platforms, or you're operating in Web3 where an on-chain HumanCredential is directly usable in smart contracts." },
      { type: 'p', text: "The right answer depends on what you're actually protecting against — and what compliance obligations you're willing to take on." },
    ],
  },
  {
    slug: 'how-gesture-verification-detects-ai-agents',
    title: 'How Gesture Verification Detects AI Agents',
    subtitle: 'Browser automation tools have gotten very good at mimicking human behavior. Here\'s why they still fail at gesture verification — and the layers that make it stick.',
    date: '2025-11-28',
    category: 'How It Works',
    series: 'How It Works',
    readingTime: '9 min',
    color: '#059669',
    content: [
      { type: 'p', text: 'AI agents using browser automation — Playwright, Puppeteer, Selenium, GPT-4V with computer-use — have gotten remarkably good at impersonating humans. They solve text CAPTCHAs, navigate complex UIs, and generate plausible form submissions. A naive "is this a bot?" check based on JavaScript environment variables or mouse movement alone will fail against a well-configured headless browser.' },
      { type: 'p', text: "Gesture verification works on a different premise: don't try to detect a bot environment. Instead, verify that a human hand performed a specific physical movement at a specific time, and make that verification cryptographically unforgeable." },
      { type: 'h2', text: 'Layer 1: Canvas Fingerprinting' },
      { type: 'p', text: "When a browser renders a WebGL canvas, the output varies subtly based on the GPU driver, operating system font renderer, and hardware. These variations are deterministic — the same hardware produces the same fingerprint — but differ measurably across hardware configurations." },
      { type: 'p', text: "Headless Chrome running in a cloud VM produces a different canvas fingerprint than Chrome on a physical MacBook or Android device. Even when bots spoof the User-Agent and JS environment, they can't change how the GPU driver rasterizes WebGL geometry. This gives us a hardware-correlated signal before the gesture even begins." },
      { type: 'h2', text: 'Layer 2: Neuromuscular Gesture Biometrics' },
      { type: 'p', text: "A human performing a gesture leaves a characteristic signature in the raw touch/pointer data: velocity curves, acceleration peaks, micro-tremors, pressure variation (on touch devices), and the specific timing of segment transitions. This signature reflects the neuromuscular control of a human hand — not cognitive ability, but physical biomechanics." },
      { type: 'p', text: 'AI agents fail here in two ways:' },
      { type: 'ul', items: [
        'Synthetic mouse movement libraries (like ghost-cursor) generate Bézier-curve-based trajectories that look smooth and human-like to the eye — but their velocity distributions don\'t match real human jitter at a statistical level',
        'Touch pressure and timing on mobile devices requires actual hardware contact; cloud-based agents operating through browser APIs cannot generate real pressure events — they either omit them entirely (detectable) or generate implausible uniform pressure (also detectable)',
      ]},
      { type: 'p', text: "The gesture backend runs the raw pointer event stream through a classifier trained on millions of real human gestures. Synthetic inputs cluster differently in feature space — consistently enough that they can be flagged in real-time." },
      { type: 'h2', text: 'Layer 3: Device-Bound DID' },
      { type: 'p', text: 'The DID (Decentralized Identifier) is derived from hardware characteristics and stored in a platform keystore (TPM on Windows, Secure Enclave on iOS/macOS, StrongBox on Android). The private key never leaves the secure element.' },
      { type: 'p', text: "This matters because: even if a bot successfully mimics the gesture biometrics, the verification request must be signed with the DID's private key. The private key is non-exportable hardware-bound material. A cloud-based bot doesn't have a hardware Secure Enclave — it has a software key store that, when inspected, lacks the hardware attestation certificates." },
      { type: 'p', text: 'For non-mobile environments (desktop browsers without TEE access), the DID is derived from a stable combination of hardware identifiers and stored encrypted in IndexedDB. It\'s not as strong as hardware attestation, but it is stable across sessions and correlated with specific hardware — making it costly to rotate.' },
      { type: 'h2', text: 'Layer 4: Challenge Freshness' },
      { type: 'p', text: 'Each verification request contains a server-generated nonce and a timestamp valid for 60 seconds. The gesture data is signed over the nonce — preventing replay attacks where a bot records a valid human gesture and reuses it.' },
      { type: 'code', lang: 'json', text: `{
  "challenge": {
    "nonce": "7f4a2c9e...",
    "expires_at": 1732801234,
    "gesture_path": [3, 1, 4, 1, 5, 9]
  }
}` },
      { type: 'p', text: 'The gesture path specifies which segments to trace — a different pattern each session. A bot cannot pre-compute or cache a valid gesture because the required path changes every request.' },
      { type: 'h2', text: 'Layer 5: Bond Graph Clustering' },
      { type: 'p', text: "A DID that passes all the above checks in isolation might still be suspicious if it exists in a vacuum. APTOGON's bond graph tracks social connections between verified humans — explicit vouching relationships, shared community membership, interaction history." },
      { type: 'p', text: 'A newly created DID with no social connections, no history, and a suspicious canvas fingerprint is assigned a lower trust score even if its gesture verification passes. This is analogous to how email spam filters use sender reputation alongside content analysis.' },
      { type: 'p', text: "Legitimate new users build trust through normal activity. Bot farms can't replicate years of organic social interaction at scale." },
      { type: 'h2', text: 'Why This Combination Holds' },
      { type: 'p', text: "Each layer individually is bypassable with enough effort. The combination is not, for a simple economic reason: the cost of defeating all five layers simultaneously exceeds the value of a single fake verification." },
      { type: 'table', headers: ['Layer', 'What bots must fake', 'Cost to fake'], rows: [
        ['Canvas fingerprint', 'Real GPU hardware', 'High (dedicated physical hardware per DID)'],
        ['Gesture biometrics', 'Human neuromuscular pattern', 'High (human in the loop, or ML model that still clusters as synthetic)'],
        ['Device-bound DID', 'Hardware Secure Enclave with real attestation cert', 'Extremely high (requires physical hardware)'],
        ['Challenge freshness', 'Real-time human response within 60 sec', 'High (removes async/batch operation)'],
        ['Bond graph', 'Years of organic social history', 'Near-impossible at scale'],
      ]},
      { type: 'p', text: "The goal isn't zero false negatives — it's making fraud economically unviable. When the cost of a fake verification exceeds its value, the attack stops." },
      { type: 'p', text: "For platforms that need it, the on-chain HumanCredential provides a final anchor: the Aptos blockchain provides an immutable, auditable record that a specific DID passed verification at a specific time. Even if an attacker eventually gets past all five layers, they've expended so many resources that they've proven their operation isn't scalable." },
    ],
  },
  {
    slug: 'aptogon-vs-worldcoin',
    title: 'APTOGON vs Worldcoin: No Iris Scanner Required',
    subtitle: 'Worldcoin collects eyeball scans from millions of people. APTOGON achieves the same sybil resistance without touching your biometrics. Here\'s how the math works.',
    date: '2025-12-05',
    category: 'APTOGON vs.',
    series: 'APTOGON vs.',
    readingTime: '9 min',
    color: '#7c3aed',
    content: [
      { type: 'p', text: "Worldcoin is the highest-profile attempt at global human verification — and it has a striking premise: scan every human's iris, issue a cryptographic credential, achieve one-person-one-vote for the entire world. The ambition is legitimate. The approach raises serious questions." },
      { type: 'p', text: "APTOGON solves the same core problem — sybil resistance at scale — through a fundamentally different mechanism. Understanding why these approaches differ helps clarify what human verification actually requires, and what it doesn't." },
      { type: 'h2', text: "What Worldcoin Collects" },
      { type: 'p', text: "Worldcoin's Orb — a silver ball roughly the size of a bowling ball — captures a high-resolution image of your iris. The raw image is processed into an \"IrisCode\": a 2048-bit binary representation of iris patterns. The raw image is discarded (per Worldcoin's protocol); the IrisCode is stored in their database and used to check for duplicates." },
      { type: 'p', text: "This is biometric verification in its most literal form. The IrisCode is the biometric — it cannot be changed, it uniquely identifies a person, and it can be used to match against other iris scans. Worldcoin argues that because raw images are deleted, privacy is preserved. Critics point out that IrisCodes themselves are biometric data under GDPR Article 9, and a database of hundreds of millions of IrisCodes is an unprecedented concentration of biometric identifiers." },
      { type: 'callout', text: "Worldcoin has collected iris scans from over 6 million people as of 2024. GDPR regulators in Germany, France, and Kenya have suspended or investigated its operations for biometric data compliance failures." },
      { type: 'h2', text: "The Privacy Trade-off" },
      { type: 'ul', items: [
        'Worldcoin stores IrisCodes indefinitely — required for duplicate detection. A breach exposes data users cannot change.',
        'Regulators in multiple jurisdictions classify IrisCodes as sensitive biometric data requiring explicit consent and data protection impact assessments.',
        'Facial recognition systems have documented accuracy disparities across demographic groups; iris recognition is more consistent but not immune.',
        'Worldcoin requires physical presence at an Orb location — unavailable in most of the world, creating geographic exclusion.',
        'The World ID credential is non-transferable across ecosystems — it exists in Worldcoin\'s own infrastructure, not as a portable open standard.',
      ]},
      { type: 'h2', text: "APTOGON's Different Bet" },
      { type: 'p', text: "APTOGON's anti-sybil guarantee comes from hardware binding and behavioral verification, not biometrics. The device-bound DID ties a credential to specific physical hardware — not to a face or an iris. The gesture verification confirms a human is present without capturing or storing any biometric template." },
      { type: 'p', text: "The key insight: sybil resistance requires making fake identities expensive to create, not identifying who you are. Worldcoin's approach ties the credential to the person's body. APTOGON ties it to their hardware. For most use cases, hardware binding is sufficient — and it doesn't create a global database of biometric identifiers." },
      {
        type: 'table',
        headers: ['', 'APTOGON', 'Worldcoin'],
        rows: [
          ['Core mechanism', 'Gesture + device-bound DID', 'Iris scan (IrisCode)'],
          ['Biometric stored', '✗ None', '✓ IrisCode (2048-bit iris hash)'],
          ['Physical hardware required', '✓ User\'s own device', '✓ Worldcoin Orb (must visit)'],
          ['GDPR Article 9', '✗ Not applicable', '✓ Required (biometric data)'],
          ['Trust bands', 'newcomer | community | trusted', '✗ Binary (verified / not)'],
          ['On-chain credential', '✓ Aptos blockchain', '✓ World Chain (own L2)'],
          ['Open-source', '✓ AGPL-3.0', '✓ Partially'],
          ['Self-hostable', '✓', '✗ Orb required'],
          ['Portable across ecosystems', '✓', '✗ World ID only'],
          ['Biometric breach risk', '✗ None', '✓ IrisCode database'],
        ],
      },
      { type: 'h2', text: "Where Worldcoin Wins" },
      { type: 'p', text: "Worldcoin's model does have a genuine advantage in one specific scenario: the same person owning multiple physical devices. If someone owns 10 phones, APTOGON's device binding produces 10 different DIDs — which our cluster detection flags as suspicious, but doesn't eliminate with certainty. Worldcoin's iris scan would catch this because the person has only one iris regardless of how many devices they own." },
      { type: 'p', text: "For the specific use case of global UBI distribution (Worldcoin's original goal), biometric uniqueness is arguably necessary. You need absolute certainty that each person receives exactly one distribution, and device binding doesn't provide that. For this narrow use case, biometric verification is the right tool." },
      { type: 'h2', text: "For Everything Else" },
      { type: 'p', text: "Market research, community platforms, DAO governance, AI data labeling, survey integrity — the dominant threat in all these contexts is automated scale, not the same person operating 10 physical devices. Cloud-based bot farms don't have physical hardware to bind to. Synthetic identities don't have Secure Enclaves." },
      { type: 'p', text: "For these use cases, APTOGON provides sybil resistance without requiring users to physically visit a hardware kiosk, without storing any biometric data, and without creating GDPR Article 9 liability for every platform that integrates it." },
      { type: 'p', text: "The choice between these approaches is fundamentally about what you're actually protecting against — and how much biometric data collection you're willing to require from your users." },
    ],
  },
  {
    slug: 'sybil-problem-in-web3-governance',
    title: 'The Sybil Problem in Web3 Governance',
    subtitle: 'Token-weighted voting was supposed to make governance fair. Instead it created a new attack surface: one actor, thousands of wallets, infinite influence. Here\'s the math.',
    date: '2025-12-12',
    category: 'The Bot Problem',
    series: 'The Bot Problem',
    readingTime: '8 min',
    color: '#0891b2',
    content: [
      { type: 'p', text: "Decentralized governance promised to give communities control over their protocols. Instead, most DAO governance votes are decided by a small number of large token holders, with participation rates often below 10%. Worse, the votes that do happen are increasingly vulnerable to a specific attack that the system was never designed to prevent: sybil attacks." },
      { type: 'h2', text: "What a Sybil Attack Looks Like in Practice" },
      { type: 'p', text: "A sybil attack in governance is simple: one actor creates many wallets, acquires tokens across them (or farms tokens through multiple accounts), and votes multiple times on proposals they want to influence. The term comes from the 1973 psychiatric case study of a woman with 16 distinct personalities — each wallet is a \"personality\", but all controlled by one actor." },
      { type: 'p', text: "This isn't theoretical. Documented sybil incidents in major DAOs include:" },
      { type: 'ul', items: [
        'Compound governance attack (2022): a single actor coordinated across multiple addresses to push through a proposal that redirected treasury funds to themselves before the community detected it',
        'Uniswap airdrop farming: thousands of addresses received UNI tokens that were then consolidated into a small number of controlling wallets, concentrating governance power',
        'Arbitrum grant farming: projects created multiple wallet addresses to receive multiple grant allocations from the same governance decision',
        'Snapshot vote manipulation: off-chain governance systems are particularly vulnerable because there\'s no on-chain cost to creating and voting from new addresses',
      ]},
      { type: 'h2', text: "Why Token-Weighted Voting Doesn't Fix This" },
      { type: 'p', text: "The instinct is to say: \"sybil attacks don't matter because you need tokens to vote.\" This is partially true for treasury attacks (acquiring a governance majority requires buying a lot of tokens), but fails for several common governance patterns:" },
      { type: 'ul', items: [
        'Quadratic voting: intentionally reduces the power of large token holders by using the square root of holdings. This makes sybil attacks directly profitable — split one large holding across many wallets and your aggregate voting power increases.',
        'One-wallet-one-vote mechanisms: explicitly vulnerable to sybil attacks by design.',
        'Snapshot (off-chain) governance: many DAOs use snapshot voting for lower-stakes decisions. No on-chain cost to creating addresses, so sybil attacks are essentially free.',
        'Airdrop eligibility: a class of wallets that meet criteria (e.g. active traders, early users) can be replicated by Sybil attackers who simulate the qualifying behavior at scale.',
      ]},
      { type: 'callout', text: "Gitcoin Grants, the largest open-source funding mechanism in Web3, runs on quadratic funding. In 2020, they estimated that sybil attacks were distorting approximately 15% of all grant allocations. They have since deployed sophisticated but imperfect heuristics to detect them." },
      { type: 'h2', text: "Current Mitigations and Why They Fall Short" },
      { type: 'p', text: "The Web3 ecosystem has developed several approaches to sybil resistance. Each has significant limitations:" },
      { type: 'ul', items: [
        'Proof of Humanity (PoH): requires a video of your face + a vouching chain from existing members. Video can be deepfaked. The vouching chain creates a social attack surface and is slow to scale.',
        'BrightID: graph-based identity where humans meet in video calls and vouch for each other. Requires active participation in a social graph. Excludes people without social connections in the network.',
        'Gitcoin Passport: an aggregation of "stamps" from various identity providers (GitHub, Twitter, ENS, etc.). Sybil attackers can acquire stamps by creating platform accounts — the underlying platforms also have sybil problems.',
        'Token staking for participation: raises the cost of sybil attacks but also excludes small token holders from governance, concentrating power.',
      ]},
      { type: 'h2', text: "What One-Human-One-Vote Actually Requires" },
      { type: 'p', text: "The fundamental requirement for sybil-resistant governance is a credential that is: (1) provably linked to a unique human, (2) not transferable between humans, and (3) not replicable by automation." },
      { type: 'p', text: "APTOGON's HumanCredential satisfies all three conditions. It is device-bound (tied to hardware the human controls), non-exportable (the private key lives in a hardware secure element), and gesture-verified (confirmed that a human performed a real-time physical interaction). The credential is written to the Aptos blockchain as an immutable, auditable record." },
      { type: 'code', lang: 'solidity', text: `// Example: Using APTOGON HumanCredential in governance
// DAO smart contract checks credential before recording vote
function castVote(uint256 proposalId, bool support, bytes calldata credentialProof) external {
    // Verify the credential proof against APTOGON's on-chain record
    require(
        IHumanCredential(APTOGON_REGISTRY).isVerified(msg.sender, credentialProof),
        "Valid HumanCredential required"
    );
    // One human = one vote, regardless of how many wallets they control
    require(!hasVoted[proposalId][credentialProof.didHash], "Already voted");
    hasVoted[proposalId][credentialProof.didHash] = true;

    votes[proposalId][support ? 0 : 1]++;
    emit VoteCast(msg.sender, proposalId, support);
}` },
      { type: 'h2', text: "The Trust Band Advantage" },
      { type: 'p', text: "Unlike binary verification systems, APTOGON returns a trust band (newcomer, community, or trusted) that DAOs can use to weight governance participation by verification quality. A recently verified newcomer might get 0.5× vote weight; a trusted member with an established bond graph gets 1× weight. This creates a spectrum of participation that mirrors how real communities work — new members earn influence over time." },
      { type: 'p', text: "Sybil attacks become economically unviable because: (1) each fake identity requires real physical hardware, (2) the credential is non-transferable, and (3) gaming the trust band requires years of organic social activity that can't be faked at scale." },
      { type: 'p', text: "Decentralized governance has a sybil problem that token economics alone cannot solve. The solution is a credential layer that proves humanity without compromising privacy — and that integrates with existing smart contract governance frameworks without requiring a new blockchain." },
    ],
  },
  {
    slug: 'integrating-aptogon-in-30-minutes',
    title: 'Integrating APTOGON in 30 Minutes',
    subtitle: 'A step-by-step walkthrough: from zero to verified human in your web app. Includes React, plain JavaScript, and server-side verification in Node.js and Python.',
    date: '2025-12-19',
    category: 'Developer Guide',
    series: 'Developer Guide',
    readingTime: '10 min',
    color: '#059669',
    content: [
      { type: 'p', text: "This is a practical guide — no theory, just code. By the end you'll have a working verification flow: the user opens your page, proves they're human, and your server receives a confirmed `human: true` signal with a `trust_band` and anonymous `did_hash`. Total integration time: 20–30 minutes." },
      { type: 'h2', text: 'Prerequisites' },
      { type: 'ul', items: [
        'An APTOGON account and API keys (get them at /console)',
        'A web application — any framework works; examples use React and vanilla JS',
        'A server-side component — examples in Node.js and Python',
      ]},
      { type: 'h2', text: 'Step 1: Get Your Keys' },
      { type: 'p', text: "In the APTOGON console, create an API key pair. You'll receive two keys:" },
      { type: 'ul', items: [
        '`pk_live_…` — the publishable key. Safe to include in browser code.',
        '`sk_live_…` — the secret key. Server-side only. Shown once at creation — save it immediately.',
      ]},
      { type: 'p', text: "Also register your domain in the console. Verification requests from unregistered origins are rejected." },
      { type: 'h2', text: 'Step 2: Add the Widget (Browser)' },
      { type: 'p', text: "The fastest integration is the drop-in script. Add one script tag and one div:" },
      { type: 'code', lang: 'html', text: `<!-- Add before </body> -->
<script src="https://homosapience.org/embed/v1/aptogon.js"
        data-aptogon-key="pk_live_YOUR_KEY"></script>

<!-- Place where you want the button -->
<div
  data-aptogon-verify
  data-on-success="handleVerified"
></div>

<script>
  // Called when user completes verification
  function handleVerified({ token, trust_band, did_hash }) {
    // Send the token to your server for confirmation
    fetch('/api/confirm-human', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(r => r.json()).then(result => {
      if (result.human) {
        // Unlock the protected action
        document.getElementById('protected-content').style.display = 'block'
      }
    })
  }
</script>` },
      { type: 'h2', text: 'Step 2 (Alternative): React Component' },
      { type: 'code', lang: 'tsx', text: `import { useEffect, useRef } from 'react'

declare global {
  interface Window { Aptogon: { verify: (opts: object) => Promise<VerifyResult> } }
}

type VerifyResult = {
  token: string
  trust_band: 'newcomer' | 'community' | 'trusted'
  did_hash: string
}

export function HumanVerifyButton({ onVerified }: { onVerified: (r: VerifyResult) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://homosapience.org/embed/v1/aptogon.js'
    script.setAttribute('data-aptogon-key', process.env.NEXT_PUBLIC_APTOGON_KEY!)
    document.head.appendChild(script)
    return () => { document.head.removeChild(script) }
  }, [])

  const handleClick = async () => {
    const result = await window.Aptogon.verify({
      publishableKey: process.env.NEXT_PUBLIC_APTOGON_KEY!,
    })
    onVerified(result)
  }

  return (
    <button ref={ref} onClick={handleClick}
      style={{ padding: '12px 28px', background: '#7c3aed', color: '#fff',
               borderRadius: 10, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
      ✍️ Verify I'm human
    </button>
  )
}` },
      { type: 'h2', text: 'Step 3: Confirm Server-Side (Node.js)' },
      { type: 'p', text: "The token the browser receives is short-lived (60 seconds) and must be confirmed server-side with your secret key. Never skip this step — client-side signals can be forged." },
      { type: 'code', lang: 'javascript', text: `// pages/api/confirm-human.js  (Next.js) or Express route

export default async function handler(req, res) {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'token required' })

  const response = await fetch('https://homosapience.org/api/embed/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${process.env.APTOGON_SECRET_KEY}\`,
    },
    body: JSON.stringify({ token }),
  })

  if (!response.ok) {
    return res.status(400).json({ human: false, error: 'verification failed' })
  }

  const { human, did_hash, trust_band } = await response.json()

  if (human) {
    // Optional: store did_hash to enforce one-action-per-human
    // await db.recordHumanAction(did_hash, 'survey_response')
  }

  return res.json({ human, trust_band, did_hash })
}` },
      { type: 'h2', text: 'Step 3 (Alternative): Python / FastAPI' },
      { type: 'code', lang: 'python', text: `import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os

app = FastAPI()
APTOGON_SECRET = os.environ["APTOGON_SECRET_KEY"]

class VerifyRequest(BaseModel):
    token: str

@app.post("/api/confirm-human")
async def confirm_human(body: VerifyRequest):
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://homosapience.org/api/embed/verify",
            headers={
                "Authorization": f"Bearer {APTOGON_SECRET}",
                "Content-Type": "application/json",
            },
            json={"token": body.token},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="verification failed")

    data = resp.json()
    # data = { "human": True, "did_hash": "sha3...", "trust_band": "community" }
    return data` },
      { type: 'h2', text: 'Step 4: Using did_hash for One-Human-One-Action' },
      { type: 'p', text: "The `did_hash` is an anonymous fingerprint — a one-way hash with no link to real identity. Store it alongside actions to enforce uniqueness across sessions:" },
      { type: 'code', lang: 'javascript', text: `// Enforce one survey response per human
const existing = await db.query(
  'SELECT id FROM survey_responses WHERE did_hash = $1 AND survey_id = $2',
  [did_hash, surveyId]
)
if (existing.rows.length > 0) {
  return res.status(409).json({ error: 'already_submitted' })
}
await db.query(
  'INSERT INTO survey_responses (did_hash, survey_id, data) VALUES ($1, $2, $3)',
  [did_hash, surveyId, responseData]
)` },
      { type: 'h2', text: 'Step 5: Trust Band Gating (Optional)' },
      { type: 'p', text: "Different actions can require different trust levels. Use `trust_band` to gate high-stakes actions:" },
      { type: 'code', lang: 'javascript', text: `// Require 'trusted' or 'community' for governance votes
// Allow 'newcomer' for forum posting
const TRUST_REQUIREMENTS = {
  '/vote': ['trusted', 'community'],
  '/post': ['trusted', 'community', 'newcomer'],
  '/airdrop': ['trusted'],
}

const allowed = TRUST_REQUIREMENTS[action] ?? ['trusted', 'community', 'newcomer']
if (!allowed.includes(trust_band)) {
  return res.status(403).json({
    error: 'trust_band_insufficient',
    required: allowed,
    current: trust_band,
    upgrade_hint: 'Complete more verifications and connect with verified humans to build your bond graph.',
  })
}` },
      { type: 'h2', text: 'Testing in Development' },
      { type: 'p', text: "Use `pk_test_…` and `sk_test_…` keys from the console for local development. Test keys return synthetic verification results without going on-chain. The verification flow works identically — same API shape, same trust bands — but `human` is always `true` for any completed gesture." },
      { type: 'callout', text: "In production, always use live keys. Test keys accept any gesture including programmatically submitted ones — they are intentionally insecure for testing purposes." },
      { type: 'h2', text: 'Common Pitfalls' },
      { type: 'ul', items: [
        '**Secret key in browser code**: if you see `sk_live_` in client-side JavaScript, you have a critical security issue. The secret key must only exist on your server.',
        '**Skipping server-side verification**: the token returned by the widget must be verified server-side. A token alone does not prove verification — it must be redeemed with the secret key.',
        '**Caching did_hash incorrectly**: `did_hash` is stable across sessions for the same device but can change if the user resets their device or browser. Do not use it as a permanent user identifier.',
        '**Not registering your domain**: verification requests from unregistered origins return 403. Add all your domains (including `localhost` for development) in the console.',
      ]},
      { type: 'p', text: "That's the full integration. The verification flow adds roughly 10 seconds to the user experience — the gesture challenge opens in a popup and closes automatically on success. Your application receives a cryptographic proof of humanity, an anonymous identity hash, and a trust band, with zero personal data stored anywhere in the chain." },
    ],
  },
  {
    slug: 'red-team-hardening-verification',
    title: 'How We Red-Teamed Our Own Verification System',
    subtitle: 'Before trusting a security claim, you have to try to break it. We built an attack simulator and ran hundreds of spoofing attempts against APTOGON — here\'s what we learned.',
    date: '2026-06-21',
    category: 'Security',
    series: 'Security',
    readingTime: '9 min',
    color: '#dc2626',
    content: [
      { type: 'p', text: 'Security claims are cheap. Any system that validates human identity will eventually face adversarial pressure — from click farms, synthetic AI agents, replay tools, and determined researchers. The question is not whether attacks will be attempted, but whether your defenses hold when they are.' },
      { type: 'p', text: 'We decided to attack our own system before someone else did. Over several months, the APTOGON team ran a structured red-team exercise against our own production verification stack — building a dedicated attack simulator, generating thousands of spoofed verification attempts, and iterating on the defenses that emerged from each finding.' },
      { type: 'p', text: 'This post describes the methodology and what we hardened, without disclosing specific thresholds, model weights, or techniques that would help a real attacker.' },

      { type: 'h2', text: 'Why Red-Teaming a Gesture System Is Hard' },
      { type: 'p', text: 'A traditional login system can be red-teamed with standard penetration testing tools — credential stuffing, token manipulation, session hijacking. A behavioral biometrics system is different: the "lock" is a statistical model, not a secret. There is no password to steal. The attacker must produce data that the model classifies as human.' },
      { type: 'p', text: 'This creates an unusual threat model. A sophisticated attacker does not need to exploit a code vulnerability — they need to understand the decision boundary of the classifier and craft inputs that cross it. This is a machine learning adversarial attack, not a conventional one.' },
      { type: 'p', text: 'Our red-team framework therefore had two layers: traditional security testing (authentication, session integrity, rate limiting, replay prevention) and model probing (what inputs fool the behavioral classifier, and by how much?).' },

      { type: 'h2', text: 'The Attack Classes We Simulated' },
      { type: 'ul', items: [
        'Synthetic gesture generation — statistically generating gesture events with realistic timing, velocity distribution, and directional corrections, without a real human. The goal: produce a payload that looks plausible to our behavioral model.',
        'Timestamp replay — recording a real human gesture and resubmitting it with adjusted timestamps, bypassing the recency window that invalidates stale sessions.',
        'Fingerprint rotation — generating large numbers of unique device-fingerprint hashes to bypass per-device rate limits and simulate a Sybil factory.',
        'Black-box model probing — systematically varying one parameter at a time across many attempts to map the classifier\'s decision boundary without access to the model internals.',
      ]},
      { type: 'p', text: 'Each attack class was implemented as a standalone module. We ran batches of attempts against a dev instance, measured pass rates, identified which parameter ranges the classifier was most sensitive to, and adjusted defenses accordingly.' },

      { type: 'h2', text: 'What the Synthetic Generator Revealed' },
      { type: 'p', text: 'The first synthetic gesture generator used a Brownian motion model with Gaussian noise — a reasonable approximation of human movement. Early versions of the classifier were not robust against this. The generated gestures had correct statistical distributions for velocity and position, but their timing was too uniform: the inter-event intervals followed a tight distribution that real humans never produce.' },
      { type: 'p', text: 'This finding drove a significant improvement in the pattern analysis layer. Real human gestures show irregular pause clustering — brief hesitations that vary unpredictably and reflect genuine cognitive processing. We tightened the entropy threshold for inter-event timing, which substantially increased the classifier\'s rejection rate against synthetic inputs while leaving human pass rates unchanged across all our test devices.' },
      { type: 'callout', text: 'The key insight: statistical shape matters less than statistical irregularity. A human hand is not a noise generator — it is a motor system with fatigue, attention shifts, and micro-corrections. These are hard to fake convincingly.' },

      { type: 'h2', text: 'The Replay Attack and How We Stopped It' },
      { type: 'p', text: 'Timestamp replay was the most technically straightforward attack. If an attacker records a real human gesture — their own, or a stolen dataset — they can shift all timestamps forward so the last event falls within the recency window. The gesture is real; only the time is fabricated.' },
      { type: 'p', text: 'We hardened against this on multiple levels. First, the session token that authorizes a verification attempt is single-use and short-lived — a replayed payload against a spent token is rejected immediately. Second, we cross-check the reported gesture duration against the challenge issuance time: a gesture that claims to have taken 12 seconds cannot appear in a session that was open for 8. Third, the challenge dot positions — server-issued coordinates that the user must visually track and approach with the cursor — are embedded in the validation and cannot be known to an attacker who pre-recorded a gesture in a different session.' },

      { type: 'h2', text: 'Sybil Simulation and Rate Limits' },
      { type: 'p', text: 'The fingerprint rotation attack was designed to answer a specific question: how many fake verifications can a single IP address produce per hour, and how many unique DIDs can it generate?' },
      { type: 'p', text: 'The answer depends on two rate-limiting layers working together. The per-IP limit caps the number of verification attempts within a rolling window. The per-fingerprint limit caps how many successful verifications any single device hash can produce over a longer window. Together, these create a practical ceiling on Sybil production from a single physical machine, regardless of how many fake fingerprints are generated.' },
      { type: 'p', text: 'Our simulation revealed that the limits were well-calibrated for legitimate users but left some headroom for coordinated attacks using IP rotation. We tightened the backoff curve for failed attempts, so a pattern of rapid sequential failures from the same IP triggers a progressive cooldown, not just a hard cap.' },

      { type: 'h2', text: 'Black-Box Model Probing' },
      { type: 'p', text: 'The most time-consuming part of the exercise was the parameter sweep. By varying one metric — rhythm irregularity, velocity standard deviation, correction count, gesture duration — across many attempts with different device fingerprints, we built an empirical map of where the classifier drew its lines.' },
      { type: 'p', text: 'We are not publishing those numbers. What we can say is that the exercise confirmed the classifier has meaningful separation between the human cluster and the synthetic cluster on all five primary metrics, and that no single metric is decisive — an input that scores well on velocity but poorly on pause entropy will still be rejected. This multi-axis approach is intentional: fooling one dimension at once is tractable; fooling all five simultaneously is not.' },

      { type: 'h2', text: 'Authentication and Session Integrity' },
      { type: 'p', text: 'Beyond the behavioral layer, we tested the session and authentication infrastructure. Key findings and the fixes applied:' },
      { type: 'ul', items: [
        'Trust score was being read from localStorage by the client and could be spoofed. Fixed: trust score is now resolved exclusively from the server-side database; the client receives it as a read-only value and has no write path.',
        'Key export files did not detect tampering. Fixed: export files now include an HMAC integrity hash derived from a server-side secret; any field modification invalidates the hash and triggers a tamper warning on import.',
        'The challenge verification warning on key export was displayed only in the UI language, not the user\'s preferred locale. Fixed: warning messages now follow the verified locale stored in the user\'s credential.',
        'Automated clients were not consistently rejected at the API layer. Fixed: client signal analysis (navigator.webdriver, CDP presence, headless UA strings, missing browser APIs) now runs as an early gate and short-circuits the rest of the verification pipeline.',
      ]},

      { type: 'h2', text: 'What We Did Not Find' },
      { type: 'p', text: 'The red-team exercise did not surface any token forging vulnerabilities, blockchain proof tampering paths, or server-side injection issues in the verification pipeline. The challenge–response protocol — where the server issues a session token that the client cannot predict or reuse — held up under all simulated attacks. The on-chain proof mechanism, which writes a SHA3-256 hash of each verification to the Aptos blockchain, provides a tamper-evident audit trail that is independent of our server infrastructure entirely.' },

      { type: 'h2', text: 'The Program Going Forward' },
      { type: 'p', text: 'Red-teaming is not a one-time event. The attack simulator we built is now part of our ongoing development cycle: new changes to the verification pipeline are tested against the full suite of simulated attacks before deployment. We also run the simulator periodically against production to confirm that defenses have not regressed.' },
      { type: 'p', text: 'We have also opened a bug bounty program. If you find a genuine bypass or vulnerability in the APTOGON verification system, we want to know about it before anyone else does. The program covers the verification endpoint, the on-chain credential mechanism, and the device-binding infrastructure. Contact details are in the security section of our documentation.' },
      { type: 'callout', text: 'Security is an ongoing process, not a certification. Every attack we simulate today is an attack that cannot be used against our users tomorrow.' },

      { type: 'h2', text: 'Takeaways for Developers Building Similar Systems' },
      { type: 'ul', items: [
        'Behavioral classifiers need to be tested against synthetic inputs generated from their own feature distributions — not just evaluated on held-out real data.',
        'Multi-axis rejection is more robust than single-threshold rejection. An attacker who knows one threshold can tune for it; an attacker who must simultaneously satisfy five independent criteria cannot.',
        'Session integrity and behavioral analysis are complementary layers. A gesture that passes the model but uses an expired or replayed token still fails. Defense-in-depth applies here as much as anywhere.',
        'Rate limits need to be tested adversarially, not just configured theoretically. Our simulation revealed that the theoretical limits and the practical attack ceiling differed in non-obvious ways.',
        'Trust state must live server-side. Any value the client can read and write is a value an attacker controls.',
      ]},
      { type: 'p', text: 'The APTOGON verification protocol was built with adversarial inputs in mind from the start. The red-team exercise confirmed the architecture is sound, identified specific parameter tuning improvements, and produced the hardened production system we run today.' },
    ],
  },
  {
    slug: 'human-delegated-agent-authentication',
    title: 'Human-Delegated Agent Authentication: Proving the Human Behind Your AI Agent',
    subtitle: "AI agents shop, code, and browse on our behalf now. Every bot-detection system asks 'how does this agent behave?' We think that's the wrong question.",
    date: '2026-07-01',
    category: 'How It Works',
    series: 'How It Works',
    readingTime: '7 min',
    color: '#d97706',
    content: [
      { type: 'p', text: "Shopping assistants, coding agents, research bots, browser-automation copilots — AI agents acting autonomously on a person's behalf are no longer a novelty. They are becoming a default part of how people use the internet. And every major bot-management vendor has responded the same way: by trying to classify agent behavior more accurately. Better fingerprinting, better session heuristics, better ML models trained to spot the tells of automation." },
      { type: 'p', text: 'That approach answers the question "is this agent behaving like a bot?" It never answers a more basic one: who is this agent acting for, and who is accountable if it misbehaves? An agent that behaves perfectly humanlike is still, from a trust perspective, a black box — a piece of software with no owner attached, no reputation attached, and nothing at stake if it lies, scrapes, or defrauds.' },
      { type: 'h2', text: 'A Different Question' },
      { type: 'p', text: "APTOGON already solves proof-of-humanity for people: a short gesture, an anonymous DID anchored on Aptos, zero biometrics, zero PII. Human-Delegated Agent Authentication (HDAA) extends that same credential to the agents people deploy. Instead of asking a site to judge an agent's behavior in isolation, HDAA lets a verified human vouch for it directly — cryptographically, with an expiry, and revocable at any time." },
      { type: 'p', text: "The idea is simple: an agent inherits trust from its owner, the same way a company employee acts under the company's authority rather than needing to independently prove their own credibility to every vendor they contact. If the human is real and in good standing, the agent they delegate to should be able to prove that — without the agent itself needing to pass a behavioral Turing test, and without exposing who that human actually is." },
      { type: 'h2', text: 'How It Works' },
      { type: 'p', text: 'The flow has four steps, and none of them require the agent to store or transmit anything about the human beyond a signed, expiring, revocable token:' },
      { type: 'ul', items: [
        'A human completes gesture verification at homosapience.org/verify — the usual anonymous, zero-PII flow, producing a DID anchored on Aptos.',
        'The verified human requests a delegation token for their agent (agent_id, a permission scope like ["read","search"], and an expiry) via POST /api/agent/delegate.',
        'The agent presents that token to any third-party service, which checks it via a public, unauthenticated GET /api/agent/verify — no API key, no enterprise contract.',
        'The human can revoke the delegation at any time; every subsequent verify call for that token immediately returns invalid.',
      ]},
      { type: 'code', lang: 'bash', text: `curl "https://homosapience.org/api/agent/verify?token=<token>"
→ {
  "valid": true,
  "human_trust_score": 0.95,
  "human_trust_label": "community_verified",
  "agent_id": "my-shopping-assistant",
  "permissions": ["read", "search"],
  "expires_at": "2026-07-24T10:00:00+00:00"
}` },
      { type: 'p', text: "Notice what's missing from that response: the human's DID. A relying party learns that a real, verified human — with a specific trust level — stands behind this agent, and exactly what it's permitted to do. It never learns which human. Privacy and accountability aren't in tension here; the credential is designed so you get both at once." },
      { type: 'h3', text: 'Verified at runtime, not just once' },
      { type: 'p', text: "This isn't a one-time stamp checked at signup and forgotten. Every single /api/agent/verify call re-checks expiry and revocation against the server, live. If an agent is compromised or simply no longer trusted, the human owner revokes the delegation once, and every subsequent call — from every site the agent touches — fails immediately. There's no need to rotate the underlying DID, and no window where a revoked agent keeps working somewhere because a check was cached." },
      { type: 'h2', text: 'Why Behavioral Detection Alone Falls Short' },
      { type: 'p', text: "Behavioral bot-management is a real, useful layer — and we're not arguing it should disappear. But it has a structural ceiling: it can flag an agent as suspicious, and it can score confidence that a session is automated, but it fundamentally cannot answer 'who owns this, and what happens if I'm wrong to trust it?' A perfectly-behaving malicious agent looks identical to a well-behaved legitimate one under pure behavioral analysis. Human accountability is a different axis entirely, and it composes with behavioral analysis rather than replacing it." },
      { type: 'table', headers: ['', 'Behavioral analysis', 'Human credential (HDAA)'], rows: [
        ['Who is trusted?', 'The agent, if it acts right', 'The verified human owner'],
        ['Revocation', 'No concept of an owner to revoke', 'Instant, by the human, at any time'],
        ['Privacy', 'Collects and scores behavioral data', 'Zero PII — anonymous DID only'],
        ['Portability', 'Site-specific, re-evaluated everywhere', 'One token, verifiable by any relying party'],
        ['Price', 'Enterprise contracts, $100K–$2M/yr', 'Free, open API'],
      ]},
      { type: 'h2', text: "This Isn't a Niche Problem Anymore" },
      { type: 'p', text: 'Industry signals point the same direction we do. The inaugural Non-Human Identity (NHI) Pavilion at Identiverse 2025 dedicated sessions specifically to "When AI Agents Inherit Risk" and "Securing AI Agents in RunTime," framing agent identity as, in the organizers\' words, one of the biggest challenges the security industry is currently facing. Separately, at least one major bot-management vendor has already shipped a dedicated "AI Agent Trust" product line, treating agent identity as important enough to warrant its own product, not a footnote feature bolted onto existing bot defense.' },
      { type: 'callout', text: "Neither of those answers the accountability question the way a cryptographic, human-tied credential does — they still evaluate the agent's behavior in isolation. HDAA is APTOGON's answer to a gap the rest of the industry is only just starting to name." },
      { type: 'h2', text: 'Try It' },
      { type: 'p', text: "HDAA is live today, free, and open — no waitlist. If you're building or operating an AI agent and want a way for the sites it touches to trust it without a $100K enterprise bot-management contract, the full walkthrough, token format, and API reference are on the Agent Passport page." },
      { type: 'link', text: 'Read the full HDAA developer guide →', href: '/agent-passport' },
    ],
  },
  {
    slug: 'why-aptogon-runs-on-gonka',
    title: 'Why APTOGON Runs on Gonka — and What That Buys You',
    subtitle: "Every gesture we analyze is processed by a decentralized network of independent GPU operators, not one company's servers. Here's why that's not just an implementation detail — and why half our name comes from it.",
    date: '2026-07-02',
    category: 'How It Works',
    series: 'How It Works',
    readingTime: '5 min',
    color: '#7c3aed',
    content: [
      { type: 'p', text: "Every gesture verification APTOGON runs depends on an AI classification step — deciding whether the motion pattern we captured looks human. That inference has to run somewhere. We chose to run it on Gonka, a decentralized network of independently-operated GPUs, instead of routing every request through a single centralized AI vendor. This wasn't an incidental infrastructure choice; it's directly tied to why the product is built the way it is." },
      { type: 'h2', text: 'The Name Is Not a Coincidence' },
      { type: 'p', text: 'APTOGON is a portmanteau: Aptos — the blockchain where every HumanCredential is anchored — plus Gonka — the decentralized AI network that classifies every gesture. Two decentralized layers, one product name. If either layer were a single company\'s black box, the "no single point of control" story we tell about identity would have a hole in it.' },
      { type: 'h2', text: 'Why Decentralized Compute, Not Big Tech' },
      { type: 'p', text: "Today's AI inference runs almost entirely through four companies — OpenAI, Google, Anthropic, Meta. That concentration is a real risk for any product that depends on it: a single company can raise prices unilaterally, restrict access by region, or go down entirely and take every dependent service with it. Export restrictions on advanced GPUs also mean entire countries can be physically locked out of AI compute, regardless of ability to pay. Gonka routes inference across thousands of independently-operated GPUs instead of one company's data centers, which means no single entity can price us out, cut us off, or shut us down." },
      { type: 'h2', text: 'How the Network Actually Works' },
      { type: 'ul', items: [
        'ML-nodes — GPU-equipped servers that run inference for whichever request the network assigns them.',
        'Transfer Agents — intermediary nodes that route each request to available compute, wherever it physically is.',
        'Sprint Consensus — the network confirms, in real time, which computation actually happened while serving live requests.',
        'Proof of Computation — a slice of every request is independently re-computed by a different node specifically to catch dishonest results.',
      ]},
      { type: 'p', text: "The security model backing this isn't just \"trust the network\": cryptographic signatures verify each computation in under 10 milliseconds, a node caught cheating loses a share of its staked collateral — a real financial cost for dishonesty — and the entire codebase is open-source and has been independently audited by CertiK." },
      { type: 'h2', text: "Why 'Cheap' Matters — Not Just for Us" },
      { type: 'p', text: "Gonka's inference cost runs at a small fraction of a centralized provider's list price for comparable models, because no single company's margin is baked into every request. That matters concretely for APTOGON: gesture verification has to run at scale, for free-tier users, without our costs scaling in lockstep with a Big Tech price list we don't control. Cheap, distributed compute is what makes a genuinely free verification tier possible in the first place." },
      { type: 'callout', text: "This is the same principle behind APTOGON's own architecture: zero-PII, on-chain proof, no single company holding the keys to whether you can prove you're human. We picked Gonka because it's built on that principle too." },
      { type: 'p', text: "Respect to the Gonka team and community for building infrastructure that makes this possible — we're glad to be running on it." },
      { type: 'link', text: 'Read more about Gonka at gonka.ai →', href: 'https://gonka.ai' },
    ],
  },
]

export function getPost(slug: string): Post | undefined {
  return POSTS.find(p => p.slug === slug)
}
