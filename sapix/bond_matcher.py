"""
BondMatcher — AI-powered guarantor matching for HSI P2P bonds.

HSI principle: Доверие строится на действиях, не на паспортах.

This module selects the best guarantors for a new HSI member.
Selection criteria (in order of importance):
  1. High reputation score (proven track record)
  2. Recent bonding activity (actively participating)
  3. Network diversity (spread across different sub-networks)
  4. Appropriate depth (not too central, not isolated)

What is NEVER used as selection criteria:
  - Geography / country
  - Language
  - Demographics
  - Social status
  - Number of followers
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Optional

from .client import SapiXClient
from .models import SapiXModel


# ── Data Types ────────────────────────────────────────────────────────────────

@dataclass
class CandidateProfile:
    """
    Anonymized profile of a potential guarantor.
    Contains only behavioral/reputation metrics — no identity.
    """
    did_hash: str                    # Full hash for internal use
    reputation_score: int            # 0–1000
    bond_count: int                  # Total bonds given
    successful_bonds: int            # Bonds that held
    revoked_bonds: int               # Bonds that were revoked (bot found)
    last_bond_days_ago: int          # Recency of bonding activity
    network_depth: int               # Degrees of separation from core network
    active_hours_per_week: float     # Activity level
    joined_days_ago: int             # Account age


@dataclass
class RequesterProfile:
    """Profile of the person requesting bonds."""
    expression_confidence: float     # From ExpressionEngine
    verification_stage: str          # "new", "retry", "revalidation"
    previous_attempts: int           # Previous failed attempts


@dataclass
class BondMatchResult:
    selected_candidates: list[CandidateProfile]
    reasoning: str
    diversity_score: float           # How spread across network (0–1)
    estimated_approval_rate: float   # Likelihood candidates will approve
    via_fallback: bool = False


# ── Bond Matcher ───────────────────────────────────────────────────────────────

class BondMatcher:
    """
    Selects optimal guarantors for a new HSI bond using SapiX reasoning.

    The AI is given only anonymized profiles and asked to select the best
    combination that maximizes:
      - Reliability (reputation, success rate)
      - Diversity (spread across network)
      - Availability (recent activity)
      - Fairness (not always the same people)

    Example:
        matcher = BondMatcher(gonka_client)
        result = await matcher.find_guarantors(
            requester=RequesterProfile(...),
            candidates=pool_of_100,
            n_select=10,
        )
        # result.selected_candidates → top 10 to send bond requests to
    """

    SYSTEM_PROMPT = """You are selecting guarantors for a new member of the HSI
(Homo Sapience Internet) trust network.

Your goal: select the best N candidates from the pool to maximize:
1. RELIABILITY: high reputation, few revocations, proven bonds
2. DIVERSITY: different network_depth values, not all the same cohort
3. AVAILABILITY: recently active, bonded recently
4. FAIRNESS: spread the bonding work, don't overload top users

STRICT RULES:
- NEVER consider or mention geography, language, or demographics
- Penalize candidates with any revoked_bonds (bot was found in their network)
- Prefer candidates with last_bond_days_ago < 30 (recently active)
- Include some newer members (joined < 180 days) for diversity
- reputation_score range: 0-1000, higher is better
- bond_success_rate = successful_bonds / bond_count

Return ONLY valid JSON with no markdown."""

    def __init__(self, client: SapiXClient):
        self.client = client

    async def find_guarantors(
        self,
        candidates: list[CandidateProfile],
        requester: RequesterProfile,
        n_select: int = 10,
    ) -> BondMatchResult:
        """
        Select the best guarantor candidates for a new bond.

        Args:
            requester: Profile of the person needing bonds
            candidates: Pool of available verified humans
            n_select: How many to select (will contact top N, need 3+ responses)

        Returns:
            BondMatchResult with .selected_candidates
        """
        start = time.monotonic()

        if len(candidates) <= n_select:
            # Not enough candidates — return all
            return BondMatchResult(
                selected_candidates=candidates,
                reasoning="Pool smaller than requested count — returning all",
                diversity_score=1.0,
                estimated_approval_rate=0.7,
            )

        # Build anonymized candidate summaries
        # Use short IDs (first 8 chars) — full hashes not needed for selection
        anon_candidates = [
            {
                "id": c.did_hash[:8],
                "reputation": c.reputation_score,
                "success_rate": round(
                    c.successful_bonds / max(1, c.bond_count), 3
                ),
                "revocations": c.revoked_bonds,
                "last_bond_days": c.last_bond_days_ago,
                "network_depth": c.network_depth,
                "activity_hrs_week": round(c.active_hours_per_week, 1),
                "account_age_days": c.joined_days_ago,
            }
            for c in candidates
        ]

        prompt = self._build_prompt(requester, anon_candidates, n_select)

        response = await self.client.chat(
            model=SapiXModel.BOND_MATCHING,
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=1024,
            temperature=0.2,
            task_type="bond_matching",
            timeout_override=15.0,
        )

        try:
            data = response.as_json()
            selected_ids = [str(s) for s in data.get("selected_ids", [])]
            reasoning = str(data.get("reasoning", ""))
            diversity = float(data.get("diversity_score", 0.5))
            approval_rate = float(data.get("estimated_approval_rate", 0.6))
        except (ValueError, KeyError):
            # Fallback: rule-based selection
            return self._rule_based_selection(candidates, n_select)

        # Map short IDs back to full CandidateProfile objects
        id_to_candidate = {c.did_hash[:8]: c for c in candidates}
        selected = [
            id_to_candidate[sid]
            for sid in selected_ids
            if sid in id_to_candidate
        ]

        # If AI returned too few, pad with rule-based selection
        if len(selected) < n_select:
            remaining = [c for c in candidates if c.did_hash[:8] not in selected_ids]
            extra = self._rule_based_sort(remaining)[:n_select - len(selected)]
            selected.extend(extra)

        return BondMatchResult(
            selected_candidates=selected[:n_select],
            reasoning=reasoning,
            diversity_score=diversity,
            estimated_approval_rate=approval_rate,
            via_fallback=response.via_fallback,
        )

    def _build_prompt(
        self,
        requester: RequesterProfile,
        candidates: list[dict],
        n_select: int,
    ) -> str:
        return f"""Select the best {n_select} guarantors for a new HSI member.

Requester context:
- expression_confidence: {requester.expression_confidence:.2f}
- stage: {requester.verification_stage}
- previous_attempts: {requester.previous_attempts}

Candidate pool ({len(candidates)} candidates):
{json.dumps(candidates, indent=2)}

Return JSON:
{{
  "selected_ids": ["id1", "id2", ...],
  "reasoning": "explanation of selection strategy",
  "diversity_score": 0.0-1.0,
  "estimated_approval_rate": 0.0-1.0
}}"""

    def _rule_based_selection(
        self, candidates: list[CandidateProfile], n_select: int
    ) -> BondMatchResult:
        """Fallback rule-based selection when SapiX unavailable."""
        sorted_candidates = self._rule_based_sort(candidates)
        return BondMatchResult(
            selected_candidates=sorted_candidates[:n_select],
            reasoning="Rule-based fallback: sorted by reputation × recency",
            diversity_score=0.5,
            estimated_approval_rate=0.6,
            via_fallback=True,
        )

    def _rule_based_sort(
        self, candidates: list[CandidateProfile]
    ) -> list[CandidateProfile]:
        """Score = reputation × recency_factor × (1 - revocation_penalty)."""
        def score(c: CandidateProfile) -> float:
            recency = max(0.1, 1.0 - c.last_bond_days_ago / 90)
            revocation_penalty = min(0.8, c.revoked_bonds * 0.2)
            success_rate = c.successful_bonds / max(1, c.bond_count)
            return (
                c.reputation_score *
                recency *
                success_rate *
                (1.0 - revocation_penalty)
            )
        return sorted(candidates, key=score, reverse=True)
