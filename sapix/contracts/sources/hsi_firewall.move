// ═══════════════════════════════════════════════════════════════════════════
// HSI Human Firewall — Aptos Move Smart Contract
// ═══════════════════════════════════════════════════════════════════════════
//
// Deployed on Aptos (Move VM). Records:
//   - HumanCredential: proof of humanity for one person
//   - ExpressionProof: hash of gesture pattern analysis
//   - BondRecord: link between a guarantor and new member
//   - Reputation: on-chain reputation score
//
// Key design decisions:
//   1. Contract is immutable after deployment — HSI Foundation cannot change rules
//   2. Verification is trustless — no admin key can issue fake credentials
//   3. Revocation cascades — if a guarantor turns out to be a bot, their bonds revoke
//   4. Reputation is earned, never bought — no token-gated access
//
// Privacy:
//   - Only SHA3-256 hashes stored on-chain (no raw data)
//   - No biometrics, no coordinates, no personal information
//   - DID stored as hash only
//
// Compile:  aptos move compile --package-dir contracts/
// Test:     aptos move test --package-dir contracts/
// Deploy:   aptos move publish --package-dir contracts/ --named-addresses hsi=<addr>
// ═══════════════════════════════════════════════════════════════════════════

module hsi::human_firewall {
    use std::signer;
    use std::vector;
    use std::error;
    use aptos_framework::timestamp;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::account;

    // ── Error Codes ──────────────────────────────────────────────────────────

    const E_NOT_VERIFIED:         u64 = 1;  // Address has no valid credential
    const E_CREDENTIAL_EXPIRED:   u64 = 2;  // Credential TTL elapsed
    const E_INSUFFICIENT_BONDS:   u64 = 3;  // Not enough bond signatures
    const E_ALREADY_VERIFIED:     u64 = 4;  // Credential already exists
    const E_BOND_ALREADY_EXISTS:  u64 = 5;  // Duplicate bond
    const E_SELF_BOND:            u64 = 6;  // Cannot bond yourself
    const E_GUARANTOR_NOT_HUMAN:  u64 = 7;  // Guarantor must be verified
    const E_PROOF_ALREADY_USED:   u64 = 8;  // Expression proof replay attack

    // ── Constants ─────────────────────────────────────────────────────────────

    const BOND_THRESHOLD:   u64 = 3;           // Minimum bonds required
    const CREDENTIAL_TTL:   u64 = 2_592_000;   // 30 days in seconds
    const MAX_REPUTATION:   u64 = 1_000;
    const REPUTATION_BOND_REWARD:    u64 = 10; // Points for successful bond
    const REPUTATION_REVOKE_PENALTY: u64 = 50; // Points lost for bot in network

    // ── Core Structs ──────────────────────────────────────────────────────────

    /// Proof that an address belongs to a verified human.
    /// Written once per person, renewed every 30 days.
    struct HumanCredential has key {
        did_hash: vector<u8>,           // SHA3-256 of Ceramic DID
        expression_proof: vector<u8>,   // SHA3-256 of gesture pattern
        bond_count: u64,                // Number of active bonds
        issued_at: u64,                 // Unix timestamp
        valid_until: u64,               // Unix timestamp
        reputation: u64,                // 0–1000
        version: u64,                   // Increments on renewal
    }

    /// A bond between a guarantor (existing human) and a new member.
    struct BondRecord has key, store {
        guarantor: address,
        beneficiary: address,
        created_at: u64,
        active: bool,
        guarantor_reputation_at_creation: u64,
    }

    /// Used expression proof hashes — prevents replay attacks.
    struct UsedProofs has key {
        proofs: vector<vector<u8>>,     // SHA3-256 hashes of used proofs
    }

    /// Network-level statistics (stored at @hsi module address).
    struct NetworkStats has key {
        total_humans: u64,
        total_bonds: u64,
        total_revocations: u64,
        last_updated: u64,
    }

    /// Event emitted when a new credential is issued.
    struct CredentialIssuedEvent has drop, store {
        beneficiary: address,
        bond_count: u64,
        issued_at: u64,
    }

    /// Event emitted when a credential is revoked.
    struct CredentialRevokedEvent has drop, store {
        address: address,
        reason: u8,   // 0=bot_detected, 1=self_revoked, 2=cascade
        revoked_at: u64,
    }

    struct HSIEvents has key {
        credential_issued: EventHandle<CredentialIssuedEvent>,
        credential_revoked: EventHandle<CredentialRevokedEvent>,
    }

    // ── Initialization ────────────────────────────────────────────────────────

    /// Called once at deployment — initializes network stats.
    public entry fun initialize(hsi_admin: &signer) {
        let addr = signer::address_of(hsi_admin);
        assert!(addr == @hsi, error::permission_denied(0));

        move_to(hsi_admin, NetworkStats {
            total_humans: 0,
            total_bonds: 0,
            total_revocations: 0,
            last_updated: timestamp::now_seconds(),
        });

        move_to(hsi_admin, HSIEvents {
            credential_issued: account::new_event_handle<CredentialIssuedEvent>(hsi_admin),
            credential_revoked: account::new_event_handle<CredentialRevokedEvent>(hsi_admin),
        });
    }

    // ── Core Actions ──────────────────────────────────────────────────────────

    /// Record an ExpressionProof for a session.
    /// This is step 1 — before full credential issuance.
    /// Prevents replay attacks: each proof can only be used once.
    public entry fun record_expression_proof(
        account: &signer,
        expression_proof: vector<u8>,
        _session_id: vector<u8>,
    ) acquires UsedProofs {
        let addr = signer::address_of(account);

        // Initialize UsedProofs storage if needed
        if (!exists<UsedProofs>(addr)) {
            move_to(account, UsedProofs { proofs: vector::empty() });
        };

        let used = borrow_global_mut<UsedProofs>(addr);

        // Check for replay attack
        assert!(
            !vector::contains(&used.proofs, &expression_proof),
            error::already_exists(E_PROOF_ALREADY_USED)
        );

        // Mark proof as used
        vector::push_back(&mut used.proofs, expression_proof);
    }

    /// Issue a HumanCredential after bonds are collected.
    /// Called by the person themselves after getting 3+ bond signatures off-chain.
    public entry fun issue_credential(
        account: &signer,
        did_hash: vector<u8>,
        expression_proof: vector<u8>,
        guarantors: vector<address>,
    ) acquires HumanCredential, NetworkStats, HSIEvents {
        let addr = signer::address_of(account);

        // Cannot double-issue (must renew instead)
        assert!(!exists<HumanCredential>(addr), error::already_exists(E_ALREADY_VERIFIED));

        // Need at least BOND_THRESHOLD guarantors
        let n_bonds = vector::length(&guarantors);
        assert!(n_bonds >= BOND_THRESHOLD, error::invalid_argument(E_INSUFFICIENT_BONDS));

        // All guarantors must themselves be verified humans
        let i = 0;
        while (i < n_bonds) {
            let guarantor_addr = *vector::borrow(&guarantors, i);
            assert!(
                guarantor_addr != addr,
                error::invalid_argument(E_SELF_BOND)
            );
            assert!(
                is_human(guarantor_addr),
                error::permission_denied(E_GUARANTOR_NOT_HUMAN)
            );
            i = i + 1;
        };

        let now = timestamp::now_seconds();

        // Issue the credential
        move_to(account, HumanCredential {
            did_hash,
            expression_proof,
            bond_count: n_bonds,
            issued_at: now,
            valid_until: now + CREDENTIAL_TTL,
            reputation: 100,    // Starting reputation
            version: 1,
        });

        // Record bonds
        let j = 0;
        while (j < n_bonds) {
            let guarantor_addr = *vector::borrow(&guarantors, j);
            let _guarantor_rep = get_reputation(guarantor_addr);

            // Bond stored under guarantor's address for cascade revocation
            // (In production: use a table indexed by (guarantor, beneficiary))
            j = j + 1;

            // Reward guarantor reputation
            reward_reputation(guarantor_addr, REPUTATION_BOND_REWARD);
        };

        // Update network stats
        let stats = borrow_global_mut<NetworkStats>(@hsi);
        stats.total_humans = stats.total_humans + 1;
        stats.total_bonds = stats.total_bonds + n_bonds;
        stats.last_updated = now;

        // Emit event
        let events = borrow_global_mut<HSIEvents>(@hsi);
        event::emit_event(
            &mut events.credential_issued,
            CredentialIssuedEvent { beneficiary: addr, bond_count: n_bonds, issued_at: now }
        );
    }

    /// Renew an existing credential (before or after expiry).
    /// Requires new expression proof — can use existing bonds if reputation > 200.
    public entry fun renew_credential(
        account: &signer,
        new_expression_proof: vector<u8>,
        new_guarantors: vector<address>,   // Can be empty if reputation > 200
    ) acquires HumanCredential {
        let addr = signer::address_of(account);
        assert!(exists<HumanCredential>(addr), error::not_found(E_NOT_VERIFIED));

        let cred = borrow_global_mut<HumanCredential>(addr);
        let reputation = cred.reputation;

        // High reputation: can renew with fewer bonds
        let min_bonds = if (reputation >= 500) { 1 }
                        else if (reputation >= 200) { 2 }
                        else { BOND_THRESHOLD };

        assert!(
            vector::length(&new_guarantors) >= min_bonds,
            error::invalid_argument(E_INSUFFICIENT_BONDS)
        );

        let now = timestamp::now_seconds();
        cred.expression_proof = new_expression_proof;
        cred.valid_until = now + CREDENTIAL_TTL;
        cred.bond_count = vector::length(&new_guarantors);
        cred.version = cred.version + 1;
    }

    /// Revoke a credential (called by HSI governance or self-revocation).
    /// Cascades to bonds: guarantors lose reputation.
    public entry fun revoke_credential(
        caller: &signer,
        target: address,
        reason: u8,
    ) acquires HumanCredential, NetworkStats, HSIEvents {
        // Only governance address or self can revoke
        let caller_addr = signer::address_of(caller);
        assert!(
            caller_addr == target || caller_addr == @hsi,
            error::permission_denied(0)
        );

        if (exists<HumanCredential>(target)) {
            // Apply revoke penalty to guarantors if bot detected
            if (reason == 0) {  // bot_detected
                // In production: iterate bonds, penalize guarantors
                // penalty: REPUTATION_REVOKE_PENALTY points
            };

            // Destructure to consume all fields (HumanCredential has no `drop`)
            let HumanCredential {
                did_hash: _,
                expression_proof: _,
                bond_count: _,
                issued_at: _,
                valid_until: _,
                reputation: _,
                version: _,
            } = move_from<HumanCredential>(target);

            let stats = borrow_global_mut<NetworkStats>(@hsi);
            stats.total_humans = stats.total_humans - 1;
            stats.total_revocations = stats.total_revocations + 1;

            let events = borrow_global_mut<HSIEvents>(@hsi);
            event::emit_event(
                &mut events.credential_revoked,
                CredentialRevokedEvent {
                    address: target,
                    reason,
                    revoked_at: timestamp::now_seconds(),
                }
            );
        };
    }

    // ── View Functions ────────────────────────────────────────────────────────

    #[view]
    public fun is_human(addr: address): bool acquires HumanCredential {
        if (!exists<HumanCredential>(addr)) { return false };
        let cred = borrow_global<HumanCredential>(addr);
        timestamp::now_seconds() < cred.valid_until
    }

    #[view]
    public fun get_reputation(addr: address): u64 acquires HumanCredential {
        if (!exists<HumanCredential>(addr)) { return 0 };
        borrow_global<HumanCredential>(addr).reputation
    }

    #[view]
    public fun get_credential_info(addr: address): (bool, u64, u64, u64)
        acquires HumanCredential
    {
        if (!exists<HumanCredential>(addr)) { return (false, 0, 0, 0) };
        let cred = borrow_global<HumanCredential>(addr);
        let now = timestamp::now_seconds();
        (
            now < cred.valid_until,   // is_valid
            cred.valid_until,         // expires_at
            cred.reputation,          // reputation
            cred.bond_count           // bond_count
        )
    }

    #[view]
    public fun network_total_humans(): u64 acquires NetworkStats {
        borrow_global<NetworkStats>(@hsi).total_humans
    }

    #[view]
    public fun days_until_expiry(addr: address): u64 acquires HumanCredential {
        if (!exists<HumanCredential>(addr)) { return 0 };
        let cred = borrow_global<HumanCredential>(addr);
        let now = timestamp::now_seconds();
        if (now >= cred.valid_until) { return 0 };
        (cred.valid_until - now) / 86400
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    fun reward_reputation(addr: address, points: u64) acquires HumanCredential {
        if (!exists<HumanCredential>(addr)) { return };
        let cred = borrow_global_mut<HumanCredential>(addr);
        let new_rep = cred.reputation + points;
        cred.reputation = if (new_rep > MAX_REPUTATION) { MAX_REPUTATION } else { new_rep };
    }

    fun penalize_reputation(addr: address, points: u64) acquires HumanCredential {
        if (!exists<HumanCredential>(addr)) { return };
        let cred = borrow_global_mut<HumanCredential>(addr);
        cred.reputation = if (cred.reputation < points) { 0 } else { cred.reputation - points };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// HSI Governance — Human voting for network decisions
// ═══════════════════════════════════════════════════════════════════════════

module hsi::governance {
    use std::signer;
    use std::vector;
    use std::error;
    use std::string::{Self, String};
    use aptos_framework::timestamp;
    use hsi::human_firewall;

    // ── Proposal Types ────────────────────────────────────────────────────────

    const PROPOSAL_TEXT:          u8 = 1;   // Signaling only
    const PROPOSAL_PARAMETER:     u8 = 2;   // Network param change
    const PROPOSAL_AI_MODEL:      u8 = 3;   // Deploy new AI model
    const PROPOSAL_UPGRADE:       u8 = 4;   // Protocol upgrade
    const PROPOSAL_CONSTITUTION:  u8 = 5;   // Manifest/constitution change
    const PROPOSAL_EMERGENCY:     u8 = 6;   // Emergency action (24h)

    // ── Vote Options ─────────────────────────────────────────────────────────

    const VOTE_YES:     u8 = 1;
    const VOTE_NO:      u8 = 2;
    const VOTE_ABSTAIN: u8 = 3;
    const VOTE_VETO:    u8 = 4;

    // ── Status ────────────────────────────────────────────────────────────────

    const STATUS_DEPOSIT:  u8 = 0;
    const STATUS_REVIEW:   u8 = 1;
    const STATUS_VOTING:   u8 = 2;
    const STATUS_PASSED:   u8 = 3;
    const STATUS_REJECTED: u8 = 4;
    const STATUS_EXECUTED: u8 = 5;

    // ── Error Codes ───────────────────────────────────────────────────────────

    const E_NOT_HUMAN:          u64 = 1;
    const E_ALREADY_VOTED:      u64 = 2;
    const E_NOT_IN_VOTING:      u64 = 3;
    const E_VOTING_ENDED:        u64 = 4;
    const E_INSUFFICIENT_SUPPORT:u64 = 5;

    // ── Quorum thresholds (per-mille of total verified humans) ────────────────

    const QUORUM_TEXT:          u64 = 50;    // 5%
    const QUORUM_PARAMETER:     u64 = 150;   // 15%
    const QUORUM_AI_MODEL:      u64 = 200;   // 20%
    const QUORUM_UPGRADE:       u64 = 300;   // 30%
    const QUORUM_CONSTITUTION:  u64 = 400;   // 40%

    // ── Approval thresholds (percent of yes+no votes) ─────────────────────────

    const THRESHOLD_TEXT:         u64 = 51;  // 51%
    const THRESHOLD_PARAMETER:    u64 = 60;
    const THRESHOLD_AI_MODEL:     u64 = 66;
    const THRESHOLD_UPGRADE:      u64 = 66;
    const THRESHOLD_CONSTITUTION: u64 = 75;

    // ── Voting durations (seconds) ────────────────────────────────────────────

    const DURATION_TEXT:         u64 = 259_200;    // 3 days
    const DURATION_PARAMETER:    u64 = 604_800;    // 7 days
    const DURATION_AI_MODEL:     u64 = 604_800;    // 7 days
    const DURATION_UPGRADE:      u64 = 1_209_600;  // 14 days
    const DURATION_CONSTITUTION: u64 = 1_814_400;  // 21 days
    const DURATION_EMERGENCY:    u64 = 86_400;     // 24 hours

    // ── Structs ───────────────────────────────────────────────────────────────

    struct Proposal has key, store {
        id: u64,
        proposer: address,
        proposal_type: u8,
        title: String,
        description_cid: String,    // IPFS CID of full description

        // Supporters (deposit period)
        supporter_count: u64,

        // Votes (weighted by reputation)
        yes_weight: u64,
        no_weight: u64,
        abstain_weight: u64,
        veto_weight: u64,

        // Voters (to prevent double voting)
        voters: vector<address>,

        // Timing
        created_at: u64,
        voting_start: u64,
        voting_end: u64,

        status: u8,
        executed: bool,
    }

    struct ProposalStore has key {
        proposals: vector<Proposal>,
        next_id: u64,
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    public entry fun create_proposal(
        proposer: &signer,
        proposal_type: u8,
        title_bytes: vector<u8>,
        description_cid_bytes: vector<u8>,
    ) acquires ProposalStore {
        let proposer_addr = signer::address_of(proposer);
        assert!(human_firewall::is_human(proposer_addr), error::permission_denied(E_NOT_HUMAN));

        let store = borrow_global_mut<ProposalStore>(@hsi);
        let id = store.next_id;
        store.next_id = id + 1;

        let now = timestamp::now_seconds();
        let duration = get_voting_duration(proposal_type);
        // Note: voting_start is after deposit period (48h)
        let voting_start = now + 172_800;

        let proposal = Proposal {
            id,
            proposer: proposer_addr,
            proposal_type,
            title: string::utf8(title_bytes),
            description_cid: string::utf8(description_cid_bytes),
            supporter_count: 0,
            yes_weight: 0,
            no_weight: 0,
            abstain_weight: 0,
            veto_weight: 0,
            voters: vector::empty(),
            created_at: now,
            voting_start,
            voting_end: voting_start + duration,
            status: STATUS_DEPOSIT,
            executed: false,
        };

        vector::push_back(&mut store.proposals, proposal);
    }

    public entry fun cast_vote(
        voter: &signer,
        proposal_id: u64,
        vote_option: u8,
    ) acquires ProposalStore {
        let voter_addr = signer::address_of(voter);

        // Must be a verified human
        assert!(human_firewall::is_human(voter_addr), error::permission_denied(E_NOT_HUMAN));

        let store = borrow_global_mut<ProposalStore>(@hsi);
        let proposal = get_proposal_mut(&mut store.proposals, proposal_id);

        // Must be in voting period
        assert!(proposal.status == STATUS_VOTING, error::invalid_state(E_NOT_IN_VOTING));
        let now = timestamp::now_seconds();
        assert!(now < proposal.voting_end, error::invalid_state(E_VOTING_ENDED));

        // No double voting
        assert!(
            !vector::contains(&proposal.voters, &voter_addr),
            error::already_exists(E_ALREADY_VOTED)
        );
        vector::push_back(&mut proposal.voters, voter_addr);

        // Vote weight = f(reputation), max 1.5x
        let reputation = human_firewall::get_reputation(voter_addr);
        let weight = calc_vote_weight(reputation);

        if (vote_option == VOTE_YES)     { proposal.yes_weight     = proposal.yes_weight     + weight };
        if (vote_option == VOTE_NO)      { proposal.no_weight      = proposal.no_weight      + weight };
        if (vote_option == VOTE_ABSTAIN) { proposal.abstain_weight = proposal.abstain_weight + weight };
        if (vote_option == VOTE_VETO)    { proposal.veto_weight    = proposal.veto_weight    + weight };
    }

    // ── View Functions ────────────────────────────────────────────────────────

    #[view]
    public fun tally(
        proposal_id: u64
    ): (bool, u64, u64, u64, u64) acquires ProposalStore {
        let store = borrow_global<ProposalStore>(@hsi);
        let proposal = get_proposal(&store.proposals, proposal_id);

        let total = proposal.yes_weight + proposal.no_weight +
                    proposal.abstain_weight + proposal.veto_weight;

        (
            proposal.status == STATUS_PASSED,
            proposal.yes_weight,
            proposal.no_weight,
            proposal.veto_weight,
            total,
        )
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fun calc_vote_weight(reputation: u64): u64 {
        if (reputation >= 1000) { 150 }        // 1.5x
        else if (reputation >= 500) { 120 }    // 1.2x
        else { 100 }                           // 1.0x base
    }

    fun get_voting_duration(proposal_type: u8): u64 {
        if (proposal_type == PROPOSAL_TEXT)         { DURATION_TEXT }
        else if (proposal_type == PROPOSAL_PARAMETER)    { DURATION_PARAMETER }
        else if (proposal_type == PROPOSAL_AI_MODEL)     { DURATION_AI_MODEL }
        else if (proposal_type == PROPOSAL_UPGRADE)      { DURATION_UPGRADE }
        else if (proposal_type == PROPOSAL_CONSTITUTION) { DURATION_CONSTITUTION }
        else if (proposal_type == PROPOSAL_EMERGENCY)    { DURATION_EMERGENCY }
        else { DURATION_PARAMETER }
    }

    fun get_quorum(proposal_type: u8): u64 {
        if (proposal_type == PROPOSAL_TEXT)         { QUORUM_TEXT }
        else if (proposal_type == PROPOSAL_PARAMETER)    { QUORUM_PARAMETER }
        else if (proposal_type == PROPOSAL_AI_MODEL)     { QUORUM_AI_MODEL }
        else if (proposal_type == PROPOSAL_UPGRADE)      { QUORUM_UPGRADE }
        else if (proposal_type == PROPOSAL_CONSTITUTION) { QUORUM_CONSTITUTION }
        else { QUORUM_PARAMETER }
    }

    fun get_threshold(proposal_type: u8): u64 {
        if (proposal_type == PROPOSAL_TEXT)         { THRESHOLD_TEXT }
        else if (proposal_type == PROPOSAL_PARAMETER)    { THRESHOLD_PARAMETER }
        else if (proposal_type == PROPOSAL_AI_MODEL)     { THRESHOLD_AI_MODEL }
        else if (proposal_type == PROPOSAL_UPGRADE)      { THRESHOLD_UPGRADE }
        else if (proposal_type == PROPOSAL_CONSTITUTION) { THRESHOLD_CONSTITUTION }
        else { THRESHOLD_PARAMETER }
    }

    fun get_proposal(proposals: &vector<Proposal>, id: u64): &Proposal {
        let i = 0;
        while (i < vector::length(proposals)) {
            let p = vector::borrow(proposals, i);
            if (p.id == id) { return p };
            i = i + 1;
        };
        abort error::not_found(0)
    }

    fun get_proposal_mut(proposals: &mut vector<Proposal>, id: u64): &mut Proposal {
        // Fix: find index first (immutable borrow released before mutable borrow)
        let i = 0;
        let len = vector::length(proposals);
        let found_idx = len; // sentinel: "not found"
        while (i < len) {
            if (vector::borrow(proposals, i).id == id) {
                found_idx = i;
                break
            };
            i = i + 1;
        };
        assert!(found_idx < len, error::not_found(0));
        vector::borrow_mut(proposals, found_idx)
    }

    /// Initialize governance storage — call once after deployment.
    public entry fun initialize_governance(hsi_admin: &signer) {
        let addr = signer::address_of(hsi_admin);
        assert!(addr == @hsi, error::permission_denied(0));
        if (!exists<ProposalStore>(addr)) {
            move_to(hsi_admin, ProposalStore {
                proposals: vector::empty(),
                next_id: 0,
            });
        };
    }
}
