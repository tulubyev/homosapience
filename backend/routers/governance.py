"""governance.py — /api/governance — Governance proposals and voting."""

import time
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

_proposals: dict[str, dict] = {}


class ProposalCreate(BaseModel):
    title: str
    description: str
    proposal_type: str = "text"   # text | parameter | ai_model | upgrade | constitution


class VoteCast(BaseModel):
    proposal_id: str
    voter_did: str
    option: str   # yes | no | abstain | veto


@router.get("/proposals")
async def list_proposals(status: Optional[str] = None):
    proposals = list(_proposals.values())
    if status:
        proposals = [p for p in proposals if p["status"] == status]
    return proposals


@router.post("/proposals")
async def create_proposal(body: ProposalCreate, request: Request):
    """Создать предложение (нужен human credential)."""
    proposer = getattr(request.state, "human_address", "anon")
    voting_days = {"text": 3, "parameter": 7, "ai_model": 7, "upgrade": 14, "constitution": 21}
    days = voting_days.get(body.proposal_type, 7)

    proposal = {
        "id": str(uuid.uuid4()),
        "title": body.title,
        "description": body.description,
        "type": body.proposal_type,
        "proposer": proposer[:8],
        "status": "deposit",
        "supporters": [],
        "votes": {"yes": 0, "no": 0, "abstain": 0, "veto": 0},
        "created_at": int(time.time()),
        "voting_end": int(time.time()) + days * 86400,
    }
    _proposals[proposal["id"]] = proposal
    return proposal


@router.post("/proposals/{proposal_id}/support")
async def support_proposal(proposal_id: str, supporter_did: str):
    """Поддержать предложение в deposit period (нужно 100 поддержек)."""
    p = _proposals.get(proposal_id)
    if not p:
        raise HTTPException(404, "Proposal not found")
    if supporter_did not in p["supporters"]:
        p["supporters"].append(supporter_did)
    if len(p["supporters"]) >= 100:
        p["status"] = "voting"
    return {"supporters": len(p["supporters"]), "status": p["status"]}


@router.post("/vote")
async def cast_vote(body: VoteCast, request: Request):
    """Проголосовать за предложение (1 человек = 1 голос)."""
    p = _proposals.get(body.proposal_id)
    if not p:
        raise HTTPException(404, "Proposal not found")
    if p["status"] != "voting":
        raise HTTPException(400, f"Proposal is in '{p['status']}' stage, not voting")
    if body.option not in ("yes", "no", "abstain", "veto"):
        raise HTTPException(400, "Invalid vote option")

    p["votes"][body.option] += 1
    total = sum(p["votes"].values())

    # Проверка veto (>33% veto = отклонено)
    if p["votes"]["veto"] / max(1, total) > 0.33:
        p["status"] = "rejected_vetoed"

    return {"votes": p["votes"], "total": total, "status": p["status"]}


@router.get("/proposals/{proposal_id}/tally")
async def tally(proposal_id: str):
    """Подсчёт голосов."""
    p = _proposals.get(proposal_id)
    if not p:
        raise HTTPException(404, "Proposal not found")
    total = sum(p["votes"].values())
    yes = p["votes"]["yes"]
    veto = p["votes"]["veto"]
    yes_ratio = yes / max(1, yes + p["votes"]["no"])
    veto_ratio = veto / max(1, total)
    thresholds = {"text": 0.50, "parameter": 0.60, "ai_model": 0.66, "upgrade": 0.66, "constitution": 0.75}
    threshold = thresholds.get(p["type"], 0.60)
    return {
        "votes": p["votes"], "total": total,
        "yes_ratio": round(yes_ratio, 3),
        "veto_ratio": round(veto_ratio, 3),
        "threshold": threshold,
        "passed": yes_ratio >= threshold and veto_ratio <= 0.33,
    }
