"""
SapiX model constants — provider routing for Gonka Network AI inference.

Choose based on latency vs accuracy tradeoff:
  - FAST      → real-time firewall checks (< 200ms target)
  - PRIMARY   → expression analysis, translation (< 3s)
  - REASONING → bond matching, complex decisions (< 10s)

Provider routing via GONKA_PROVIDER / GONKA_BASE_URL / GONKA_API_KEY:

  GonkaGate   GONKA_PROVIDER=gonka       https://api.gonkagate.com/v1
              Standard Bearer auth, USD billing — RECOMMENDED for Phase 1

  Gonka Direct GONKA_PROVIDER=gonka_direct  https://node4.gonka.ai
              Wallet-based auth (GONKA_PRIVATE_KEY + GONKA_ADDRESS)
              GNK token billing — for Phase 3 (decentralized)

  OpenRouter  GONKA_PROVIDER=openrouter  https://openrouter.ai/api/v1
              Fallback / development

  Together.ai GONKA_PROVIDER=together    https://api.together.xyz/v1
  Ollama      GONKA_PROVIDER=ollama      http://localhost:11434/v1
"""

import os

_PROVIDER = os.getenv("GONKA_PROVIDER", "openrouter")

# OpenRouter model IDs
_OPENROUTER = {
    "fast":      "qwen/qwen3-14b",
    "primary":   "qwen/qwen3-32b",
    "reasoning": "qwen/qwen3-235b-a22b",
}

# GonkaGate model IDs (Bearer auth, USD billing)
# Full list: GET https://api.gonkagate.com/v1/models
_GONKA = {
    "fast":      "qwen/qwen3-14b",
    "primary":   "qwen/qwen3-32b-fp8",
    "reasoning": "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8",
}

# Gonka Direct API model IDs (wallet auth, GNK billing)
_GONKA_DIRECT = {
    "fast":      "qwen/qwen3-14b",
    "primary":   "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8",
    "reasoning": "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8",
}

# Together.ai model IDs
_TOGETHER = {
    "fast":      "Qwen/Qwen2.5-7B-Instruct-Turbo",
    "primary":   "Qwen/Qwen3-32B",
    "reasoning": "Qwen/Qwen3-235B-A22B",
}

# Ollama local model IDs (only fast available by default)
_OLLAMA = {
    "fast":      "qwen2.5:7b",
    "primary":   "qwen2.5:7b",   # fallback to fast locally
    "reasoning": "qwen2.5:7b",
}

_MAP = {
    "openrouter":   _OPENROUTER,
    "together":     _TOGETHER,
    "gonka":        _GONKA,         # GonkaGate — Bearer, USD
    "gonka_direct": _GONKA_DIRECT,  # Gonka Direct — wallet, GNK
    "ollama":       _OLLAMA,
}

_models = _MAP.get(_PROVIDER, _OPENROUTER)


class SapiXModel:
    FAST      = _models["fast"]
    PRIMARY   = _models["primary"]
    REASONING = _models["reasoning"]
    TRANSLATE = _models["primary"]

    EXPRESSION_ANALYSIS = PRIMARY
    ANTIBOT_REALTIME    = FAST
    BOND_MATCHING       = REASONING
    TRANSLATION         = TRANSLATE
