"""
/badge — public human badge endpoints (no auth).

GET /badge/{platform}/{username}.svg   → shields.io-style SVG
GET /badge/{platform}/{username}/info  → JSON verification info
"""
import time
from html import escape
from fastapi import APIRouter, Request
from fastapi.responses import Response

from services.feature_flags import feature_enabled

router = APIRouter()

# Anti-enumeration: never let crawlers index badge URLs (they map handle→DID).
_NO_CACHE = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma":        "no-cache",
    "Expires":       "0",
    "X-Robots-Tag":  "noindex, nofollow",
}

_GREEN = "#22c55e"
_GREY  = "#94a3b8"
_DARK  = "#1e293b"


def _svg(platform: str, username: str, verified: bool,
         trust_label: str = "") -> str:
    label_text = "✦ Human"
    value_text = f"{escape(platform)} · {escape(username)}"
    if verified and trust_label:
        value_text += f"  [{escape(trust_label)}]"

    label_w = 72
    value_w = max(10 * len(value_text) + 12, 80)
    total_w  = label_w + value_w
    value_x  = label_w + value_w // 2
    color    = _GREEN if verified else _GREY

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0"   stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1"   stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="{total_w}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="{label_w}" height="20" fill="{_DARK}"/>
    <rect x="{label_w}" width="{value_w}" height="20" fill="{color}"/>
    <rect width="{total_w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="{label_w // 2}" y="15" fill="#010101" fill-opacity=".3">{label_text}</text>
    <text x="{label_w // 2}" y="14">{label_text}</text>
    <text x="{value_x}" y="15" fill="#010101" fill-opacity=".3">{value_text}</text>
    <text x="{value_x}" y="14">{value_text}</text>
  </g>
</svg>"""


async def _resolve(platform: str, username: str, db) -> dict:
    """Returns {verified, did, trust_score, trust_label, claimed_at} or {verified: False}.

    Shielded Human: when BADGE_PRIVACY is on, a private handle (is_public=False) is
    indistinguishable from a non-existent one — no existence leak, no handle→DID map."""
    handle = await db.get_handle(platform.lower(), username.lower())
    if not handle:
        return {"verified": False}
    if feature_enabled("BADGE_PRIVACY") and not handle.get("is_public", False):
        return {"verified": False}
    did = handle["did"]
    cred = await db.get_credential(did)
    now = int(time.time())
    if not cred or cred.get("revoked") or int(cred.get("valid_until", 0)) <= now:
        return {"verified": False, "did": did, "expired": True}
    return {
        "verified":     True,
        "did":          did,
        "trust_score":  cred.get("trust_score", 0.1),
        "trust_label":  cred.get("trust_label", "newcomer"),
        "claimed_at":   handle["created_at"],
        "valid_until":  cred["valid_until"],
    }


@router.get("/{platform}/{username}.svg")
async def badge_svg(platform: str, username: str, request: Request):
    username = username[:30]
    db   = request.app.state.db
    info = await _resolve(platform, username, db)
    svg  = _svg(platform, username, info["verified"], info.get("trust_label", ""))
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers=_NO_CACHE,
    )


@router.get("/{platform}/{username}/info")
async def badge_info(platform: str, username: str, request: Request):
    from fastapi.responses import JSONResponse
    db   = request.app.state.db
    info = await _resolve(platform, username, db)
    return JSONResponse(
        content=info,
        headers=_NO_CACHE,
    )
