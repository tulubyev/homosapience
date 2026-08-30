"""
/api/handles — authenticated CRUD for platform handle declarations.

POST   /api/handles                  → declare/update handle
GET    /api/handles                  → list my handles
DELETE /api/handles/{platform}/{username} → remove handle
"""
import re
import time
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from routers._auth_helpers import require_verified_did

router = APIRouter()

SUPPORTED_PLATFORMS = {
    "github", "reddit", "x", "hackernews", "discord", "telegram",
    "instagram", "substack", "youtube", "linkedin", "stackoverflow",
    "habr", "gitlab", "bluesky", "twitch", "medium", "tiktok", "notion",
}
_USERNAME_RE = re.compile(r'^[a-zA-Z0-9_.\-]{1,50}$')


async def _reject_if_shielded(db, did: str) -> None:
    """Shielded Human: a shielded DID must never be linkable to a public handle."""
    cred = await db.get_credential(did)
    if cred and cred.get("mode") == "shielded":
        raise HTTPException(status_code=403, detail={
            "error": "shielded_no_handles",
            "message": "Shielded credentials cannot declare public handles.",
        })


class HandleBody(BaseModel):
    platform: str
    username: str
    is_public: bool = False   # Shielded Human: private-by-default; opt-in to public badge


class VisibilityBody(BaseModel):
    is_public: bool


@router.post("")
async def declare_handle(body: HandleBody, request: Request):
    platform = body.platform.lower().strip()
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail={"error": "unsupported_platform",
                                                      "message": f"Platform must be one of: {sorted(SUPPORTED_PLATFORMS)}"})
    username = body.username.strip()
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail={"error": "invalid_username",
                                                      "message": "Username must be 1-50 chars, alphanumeric + _ . -"})
    username_lc = username.lower()
    did = await require_verified_did(request)
    db = request.app.state.db
    await _reject_if_shielded(db, did)
    await db.upsert_handle(platform, username_lc, did, int(time.time()), body.is_public)
    return {"ok": True, "platform": platform, "username": username_lc,
            "is_public": body.is_public}


@router.patch("/{platform}/{username}")
async def set_visibility(platform: str, username: str, body: VisibilityBody, request: Request):
    """Toggle a handle's public visibility. Only the owning DID may change it."""
    platform = platform.lower().strip()
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail={"error": "unsupported_platform"})
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail={"error": "invalid_username"})
    did = await require_verified_did(request)
    db = request.app.state.db
    await _reject_if_shielded(db, did)
    ok = await db.set_handle_visibility(platform, username.lower(), did, body.is_public)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"ok": True, "platform": platform, "username": username.lower(),
            "is_public": body.is_public}


@router.get("")
async def list_handles(request: Request):
    did = await require_verified_did(request)
    db = request.app.state.db
    handles = await db.list_handles_for_did(did)
    return {"handles": handles}


@router.delete("/{platform}/{username}")
async def remove_handle(platform: str, username: str, request: Request):
    platform = platform.lower().strip()
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail={"error": "unsupported_platform"})
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail={"error": "invalid_username"})
    did = await require_verified_did(request)
    db = request.app.state.db
    deleted = await db.delete_handle(platform, username.lower(), did)
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"ok": True}
