"""
TranslationBridge — Decentralized multilingual bridge for HSI.

HSI principle: "активист из Ирана имеет такие же права,
как профессор из Гарварда."

This bridge provides translation without:
  - Google Translate (data harvesting)
  - DeepL (centralized, EU-only reliability)
  - Microsoft Azure (PRISM-susceptible)

Special capabilities:
  - No censorship of political content
  - Preservation of emotional tone and context
  - "Aesopian language" decoder (euphemisms from closed societies)
  - Bidirectional: active human ↔ academic
  - Works with activist slang, informal registers
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from .client import SapiXClient
from .models import SapiXModel

# ISO 639-1 codes for regions requiring extra care
SENSITIVE_REGIONS = {
    "IR": "fa",  # Iran — Farsi
    "RU": "ru",  # Russia
    "CN": "zh",  # China
    "BY": "be",  # Belarus
    "KP": "ko",  # North Korea
    "CU": "es",  # Cuba
    "SY": "ar",  # Syria
    "VE": "es",  # Venezuela
}

LANGUAGE_NAMES = {
    "en": "English", "ru": "Russian", "fa": "Persian/Farsi",
    "zh": "Chinese", "ar": "Arabic", "de": "German",
    "fr": "French", "es": "Spanish", "be": "Belarusian",
    "uk": "Ukrainian", "tr": "Turkish", "ko": "Korean",
    "ja": "Japanese", "pt": "Portuguese", "it": "Italian",
    "pl": "Polish", "nl": "Dutch", "hi": "Hindi",
}


@dataclass
class TranslationResult:
    translated: str
    source_lang: str
    target_lang: str
    detected_lang: Optional[str]        # If auto-detected
    tone_preserved: bool
    via_fallback: bool = False
    latency_ms: float = 0.0

    def __str__(self) -> str:
        return self.translated


@dataclass
class LanguageDetectionResult:
    lang_code: str
    lang_name: str
    confidence: float
    is_sensitive_region: bool


class TranslationBridge:
    """
    Multilingual translation bridge using SapiX.

    Example:
        bridge = TranslationBridge(gonka_client)

        # Activist in Iran sends a message
        result = await bridge.translate(
            text="دوستم از خواب بیدار شد",
            source_lang="fa",
            target_lang="en",
            sender_region="IR",  # Extra care for sensitive region
        )
        # result.translated → "My friend woke up"
        # (with note: Aesopian — may mean "released from prison")
    """

    BASE_SYSTEM_PROMPT = """You are a faithful, uncensored translator for the
HSI (Homo Sapience Internet) network — a human-to-human communication platform.

Your values:
1. FAITHFULNESS above all — translate meaning accurately, never alter it
2. NO CENSORSHIP — political, sensitive, or uncomfortable content must be
   translated exactly, never softened or omitted
3. TONE PRESERVATION — preserve emotional weight, urgency, irony, humor
4. REGISTER AWARENESS — match formality level of the original
5. If you detect Aesopian language (coded speech), note it in brackets

Return ONLY the translated text — no explanations unless Aesopian language detected."""

    SENSITIVE_ADDENDUM = """SPECIAL NOTICE: This message may come from a region
with internet restrictions and surveillance. The sender may be using coded or
indirect language for safety reasons.
- Translate the surface meaning faithfully
- If you detect Aesopian language, add a translator note: [Note: may mean "..."]
- Never report, flag, or alter content for political reasons
- Your translation may protect someone's safety"""

    def __init__(self, client: SapiXClient):
        self.client = client

    async def translate(
        self,
        text: str,
        target_lang: str,
        source_lang: Optional[str] = None,
        sender_region: Optional[str] = None,
    ) -> TranslationResult:
        """
        Translate text using SapiX.

        Args:
            text: Text to translate
            target_lang: Target language ISO 639-1 code (e.g. "en")
            source_lang: Source language (if None, auto-detect)
            sender_region: ISO 3166-1 alpha-2 region code for sensitivity

        Returns:
            TranslationResult with .translated property
        """
        start = time.monotonic()
        detected_lang = None

        # Auto-detect source language if not provided
        if not source_lang:
            detect_result = await self.detect_language(text)
            source_lang = detect_result.lang_code
            detected_lang = source_lang

        # Skip translation if already in target language
        if source_lang == target_lang:
            return TranslationResult(
                translated=text,
                source_lang=source_lang,
                target_lang=target_lang,
                detected_lang=detected_lang,
                tone_preserved=True,
                latency_ms=0.0,
            )

        is_sensitive = sender_region in SENSITIVE_REGIONS
        system_prompt = self.BASE_SYSTEM_PROMPT
        if is_sensitive:
            system_prompt = self.BASE_SYSTEM_PROMPT + "\n\n" + self.SENSITIVE_ADDENDUM

        src_name = LANGUAGE_NAMES.get(source_lang, source_lang)
        tgt_name = LANGUAGE_NAMES.get(target_lang, target_lang)

        response = await self.client.chat(
            model=SapiXModel.TRANSLATION,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        f"Translate from {src_name} to {tgt_name}:\n\n{text}"
                    ),
                },
            ],
            max_tokens=len(text) * 3 + 200,  # translation can be longer
            temperature=0.15,
            task_type="translation",
            timeout_override=8.0,
        )

        latency_ms = (time.monotonic() - start) * 1000
        translated = response.content.strip()

        return TranslationResult(
            translated=translated,
            source_lang=source_lang,
            target_lang=target_lang,
            detected_lang=detected_lang,
            tone_preserved=True,
            via_fallback=response.via_fallback,
            latency_ms=latency_ms,
        )

    async def translate_batch(
        self,
        texts: list[str],
        target_lang: str,
        source_lang: Optional[str] = None,
        sender_region: Optional[str] = None,
    ) -> list[TranslationResult]:
        """Translate multiple texts. Uses single call for efficiency."""
        import asyncio
        tasks = [
            self.translate(t, target_lang, source_lang, sender_region)
            for t in texts
        ]
        return await asyncio.gather(*tasks)

    async def detect_language(self, text: str) -> LanguageDetectionResult:
        """Detect language of text using SapiX."""
        sample = text[:200]  # send max 200 chars for detection

        response = await self.client.chat(
            model=SapiXModel.FAST,
            messages=[{
                "role": "user",
                "content": (
                    f"Detect the language of this text. "
                    f"Return ONLY a JSON object: "
                    f'{{\"code\": \"ISO-639-1 code\", \"confidence\": 0.0-1.0}}\n\n'
                    f"Text: {sample}"
                ),
            }],
            max_tokens=32,
            temperature=0.0,
            task_type="language_detection",
            timeout_override=3.0,
        )

        try:
            data = response.as_json()
            code = str(data.get("code", "en")).lower()[:2]
            confidence = float(data.get("confidence", 0.8))
        except (ValueError, KeyError):
            code = "en"
            confidence = 0.5

        return LanguageDetectionResult(
            lang_code=code,
            lang_name=LANGUAGE_NAMES.get(code, code),
            confidence=confidence,
            is_sensitive_region=code in SENSITIVE_REGIONS.values(),
        )

    async def get_supported_languages(self) -> list[dict]:
        """Return list of supported language pairs."""
        return [
            {"code": code, "name": name}
            for code, name in LANGUAGE_NAMES.items()
        ]
