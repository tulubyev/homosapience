# HSI Gonka Integration Package
# Decentralized AI layer for Human Sapience Internet
#
# Usage:
#   from sapix import SapiXClient
#   client = SapiXClient(api_key="your_key")

from .client import SapiXClient
from .expression_engine import ExpressionEngine, TouchEvent, TouchPattern, ExpressionResult
from .antibot_firewall import AntiBotFirewall, BehaviorProfile, BotCheckResult
from .translation_bridge import TranslationBridge, TranslationResult
from .bond_matcher import BondMatcher, CandidateProfile, BondMatchResult
from .models import SapiXModel

__version__ = "0.1.0"
__all__ = [
    "SapiXClient",
    "ExpressionEngine", "TouchEvent", "TouchPattern", "ExpressionResult",
    "AntiBotFirewall", "BehaviorProfile", "BotCheckResult",
    "TranslationBridge", "TranslationResult",
    "BondMatcher", "CandidateProfile", "BondMatchResult",
    "SapiXModel",
]
