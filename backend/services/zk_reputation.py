# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2025-2026 Alexander K. Tulubyev and APTOGON contributors.
"""
zk_reputation — STUB for unlinkable reputation transfer (Shielded Human, phase 2).

NOT IMPLEMENTED. This module fixes the *interface* only. The actual zero-knowledge
construction is a separate, security-critical work item — it must go through its own
brainstorm → spec → TDD → external audit cycle (a crypto bug here is a silent total
compromise). Do not implement it inline as part of the Shielded mode feature work.

Goal (phase 2): let a Shielded credential prove "some DID I control holds trust ≥ X"
WITHOUT revealing which DID — so an anonymous, rotating pseudonym can carry earned
reputation without becoming linkable. Candidate schemes: BBS+ / anonymous credentials,
or a SNARK over a membership set. See docs/strategy/anti-deanonymization.md §7/§9 and
the "Вынесено в отдельные циклы" section of the implementation plan.

Until implemented, Shielded credentials stay at newcomer trust (enforced in
routers/bond.py and routers/verify.py).
"""
from __future__ import annotations

from typing import Protocol


class ReputationProof(Protocol):
    """A zero-knowledge proof that the holder controls *some* credential whose
    trust_score meets a threshold, without identifying which credential."""
    threshold: float
    proof_bytes: bytes


def prove_trust_at_least(threshold: float) -> "ReputationProof":
    """Produce an unlinkable proof that the caller holds trust ≥ threshold.

    STUB — raises NotImplementedError. Implement only via the dedicated crypto cycle.
    """
    raise NotImplementedError(
        "zk_reputation.prove_trust_at_least is a phase-2 stub — implement via the "
        "dedicated brainstorm→spec→TDD→audit cycle (see anti-deanonymization plan)."
    )


def verify_trust_proof(proof: "ReputationProof", threshold: float) -> bool:
    """Verify an unlinkable trust proof against a threshold.

    STUB — raises NotImplementedError.
    """
    raise NotImplementedError(
        "zk_reputation.verify_trust_proof is a phase-2 stub — implement via the "
        "dedicated brainstorm→spec→TDD→audit cycle (see anti-deanonymization plan)."
    )
