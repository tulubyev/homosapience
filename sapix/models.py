"""
SapiX model constants — provider routing for Gonka Network AI inference.

Choose based on latency vs accuracy tradeoff:
  - FAST      → real-time firewall checks (< 200ms target)
  - PRIMARY   → expression analysis, translation (< 3s)
  - REASONING → bond matching, complex decisions (< 10s)

Provider routing via GONKA_PROVIDER / GONKA_BASE_URL / GONKA_API_KEY:

  JoinGonka   GONKA_PROVIDER=joingonka   https://gate.joingonka.ai/v1
              Bearer auth (gp- key), GNK billing — ACTIVE production broker

  GonkaGate   GONKA_PROVIDER=gonka       https://api.gonkagate.com/v1
              Standard Bearer auth, USD billing

  Gonka Direct GONKA_PROVIDER=gonka_direct  https://node4.gonka.ai/v1
              Wallet-based auth (GONKA_PRIVATE_KEY + GONKA_ADDRESS)
              GNK token billing — requires devshard gateway setup

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

# GonkaGate model IDs — api.gonkagate.com (Bearer gp- key, GNK billing)
# Available: qwen3-235b-a22b, kimi-k2.6, minimax-m2.7 (IDs are lowercase)
# Qwen3-235B is MoE (22B active params) — fast despite 235B param count
_GONKA = {
    "fast":      "qwen/qwen3-235b-a22b-instruct-2507-fp8",
    "primary":   "qwen/qwen3-235b-a22b-instruct-2507-fp8",
    "reasoning": "qwen/qwen3-235b-a22b-instruct-2507-fp8",
}

# JoinGonka broker — gate.joingonka.ai (Bearer gp- key, GNK billing)
# Catalog drifts over time — confirm current models at the gate and override via
# GONKA_MODEL in .env if these defaults disappear.
# Available 2026-06: MiniMaxAI/MiniMax-M2.7, moonshotai/Kimi-K2.6, zai-org/GLM-5.2-FP8
_JOINGONKA = {
    "fast":      "zai-org/GLM-5.2-FP8",
    "primary":   "zai-org/GLM-5.2-FP8",
    "reasoning": "zai-org/GLM-5.2-FP8",
}

# Gonka Direct API model IDs (wallet auth, GNK billing)
_GONKA_DIRECT = {
    "fast":      "qwen/qwen3-14b",
    "primary":   "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8",
    "reasoning": "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8",
}

# Together.ai model IDs — verified live in docs.together.ai/docs/serverless-models
# (2026-07). Qwen3-32B / Qwen3-235B-A22B (previous primary/reasoning picks) are no
# longer in Together's catalog — replaced with the current Qwen3.x line.
_TOGETHER = {
    "fast":      "Qwen/Qwen2.5-7B-Instruct-Turbo",
    "primary":   "Qwen/Qwen3.5-9B",
    "reasoning": "Qwen/Qwen3.7-Plus",
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
    "joingonka":    _JOINGONKA,     # gate.joingonka.ai — Bearer gp-, GNK
    "gonka":        _GONKA,         # GonkaGate — Bearer, USD
    "gonka_direct": _GONKA_DIRECT,  # Gonka Direct — wallet, GNK
    "ollama":       _OLLAMA,
}

_models = _MAP.get(_PROVIDER, _OPENROUTER)

# Env override — when the broker's catalog changes, set GONKA_MODEL in .env to a
# currently-available model id and it wins for every tier, no code change needed.
# Optional per-tier overrides: GONKA_MODEL_FAST / _PRIMARY / _REASONING.
_OVERRIDE = os.getenv("GONKA_MODEL")
if _OVERRIDE:
    _models = {"fast": _OVERRIDE, "primary": _OVERRIDE, "reasoning": _OVERRIDE}
_models = {
    "fast":      os.getenv("GONKA_MODEL_FAST",      _models["fast"]),
    "primary":   os.getenv("GONKA_MODEL_PRIMARY",   _models["primary"]),
    "reasoning": os.getenv("GONKA_MODEL_REASONING", _models["reasoning"]),
}


# Ordered fallback chain — broker models drift / go offline ("model_unavailable").
# The client tries the requested model first, then these in order. Override the
# whole chain via GONKA_MODELS (comma-separated) in .env without a redeploy.
_FALLBACK_DEFAULTS = {
    # joingonka catalog (2026-06) — MiniMax first as the currently most stable.
    "joingonka": ["MiniMaxAI/MiniMax-M2.7", "moonshotai/Kimi-K2.6", "zai-org/GLM-5.2-FP8"],
    # Together.ai catalog (2026-07, docs.together.ai/docs/serverless-models) —
    # cheapest Qwen3.x first, then the older still-live 2.5-7B-Turbo as backstop.
    "together": ["Qwen/Qwen3.5-9B", "Qwen/Qwen3.7-Plus", "Qwen/Qwen2.5-7B-Instruct-Turbo"],
}
_env_chain = os.getenv("GONKA_MODELS", "").strip()
if _env_chain:
    _FALLBACKS = [m.strip() for m in _env_chain.split(",") if m.strip()]
else:
    _FALLBACKS = _FALLBACK_DEFAULTS.get(_PROVIDER, [])


def default_chain(provider: str) -> list[str]:
    """Ordered model candidates for any provider (primary first), de-duplicated.
    Used for cross-provider failover so each provider tries its own model ids."""
    m = _MAP.get(provider, _OPENROUTER)
    base = list(_FALLBACK_DEFAULTS.get(provider, []))   # provider known-good order
    base += [m["primary"], m["fast"], m["reasoning"]]
    out, seen = [], set()
    for x in base:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


class SapiXModel:
    FAST      = _models["fast"]
    PRIMARY   = _models["primary"]
    REASONING = _models["reasoning"]
    TRANSLATE = _models["primary"]

    # Candidate chain for automatic failover when a model is unavailable.
    FALLBACKS = _FALLBACKS

    EXPRESSION_ANALYSIS = PRIMARY
    ANTIBOT_REALTIME    = FAST
    BOND_MATCHING       = REASONING
    TRANSLATION         = TRANSLATE
