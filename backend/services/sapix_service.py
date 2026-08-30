"""aptogon/sapix_service.py — SapiX (без изменений, это ядро системы)."""

import os
import sys

# sapix/ находится в корне проекта (рядом с backend/)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../"))

try:
    from sapix.client import SapiXClient
    from sapix.expression_engine import ExpressionEngine, TouchEvent
    from sapix.antibot_firewall import AntiBotFirewall, RequestRecord
    from sapix.translation_bridge import TranslationBridge
    from sapix.bond_matcher import BondMatcher, CandidateProfile, RequesterProfile
    GONKA_AVAILABLE = True
except ImportError:
    GONKA_AVAILABLE = False
    print("⚠️  sapix-пакет не найден — используется stub режим")


class GonkaService:
    def __init__(self):
        if GONKA_AVAILABLE:
            self.client = SapiXClient()
            self.expression = ExpressionEngine(self.client)
            self.antibot = AntiBotFirewall(self.client)
            self.translation = TranslationBridge(self.client)
            self.bond_matcher = BondMatcher(self.client)
        else:
            self._stub_mode = True

    def set_db(self, db) -> None:
        """Attach DB for persistent usage logging."""
        if not GONKA_AVAILABLE or not hasattr(self, 'client'):
            return
        async def _log(task_type, model, usage, latency_ms, via_fallback):
            await db.log_gonka_usage(
                task_type=task_type,
                model=model,
                tokens_in=usage.prompt_tokens,
                tokens_out=usage.completion_tokens,
                tokens_total=usage.total_tokens,
                latency_ms=latency_ms,
                via_fallback=via_fallback,
            )
        self.client._usage_callback = _log

    # Types для роутеров
    if GONKA_AVAILABLE:
        TouchEvent = TouchEvent
        RequestRecord = RequestRecord
        CandidateProfile = CandidateProfile
        RequesterProfile = RequesterProfile
