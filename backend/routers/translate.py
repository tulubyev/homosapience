"""translate.py — /api/translate"""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


class TranslateRequest(BaseModel):
    text: str
    target_lang: str
    source_lang: Optional[str] = None
    sender_region: Optional[str] = None


@router.post("")
async def translate(body: TranslateRequest, request: Request):
    """Перевод сообщения через SapiX (без Google/DeepL)."""
    gonka = request.app.state.gonka
    result = await gonka.translation.translate(
        text=body.text,
        target_lang=body.target_lang,
        source_lang=body.source_lang,
        sender_region=body.sender_region,
    )
    return {
        "translated": result.translated,
        "source_lang": result.source_lang,
        "target_lang": result.target_lang,
        "detected_lang": result.detected_lang,
        "via_fallback": result.via_fallback,
    }


@router.get("/languages")
async def get_languages(request: Request):
    """Список поддерживаемых языков."""
    gonka = request.app.state.gonka
    return await gonka.translation.get_supported_languages()
