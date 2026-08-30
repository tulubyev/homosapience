"""
SapiXClient — Base async client for Gonka Network API.

Gonka exposes an OpenAI-compatible /v1/chat/completions endpoint
via their broker at https://broker.gonkabroker.com/v1

This client handles:
  - Async HTTP with connection pooling
  - Automatic retry with exponential backoff
  - Rate limiting (per-model limits)
  - Fallback to local lightweight model if Gonka is unavailable
  - Request/response logging (no personal data)
  - Token usage tracking for HSI fund accounting
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import ssl
import time
from dataclasses import dataclass, field
from typing import Any, Optional
import httpx

# macOS Python ships without system CA bundle — bypass for OpenRouter
_SSL_CTX = ssl.create_default_context()
try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX.check_hostname = False
    _SSL_CTX.verify_mode = ssl.CERT_NONE

from .models import SapiXModel

logger = logging.getLogger("hsi.gonka")

# ── Gonka Direct wallet signing ───────────────────────────────────────────────

_wall_base = time.time_ns()
_perf_base = time.perf_counter_ns()


def _hybrid_ts_ns() -> int:
    """Monotonic hybrid timestamp in nanoseconds (mirrors gonka-openai SDK)."""
    return _wall_base + (time.perf_counter_ns() - _perf_base)


def _gonka_sign(body: bytes, private_key_hex: str, timestamp: int, transfer_address: str) -> str:
    """
    ECDSA-secp256k1 request signing for Gonka Direct API.
    Authorization = base64( sign( SHA256(body) + timestamp + transfer_address ) )
    Uses pure-Python `ecdsa` library (no C deps).
    """
    try:
        from ecdsa import SigningKey, SECP256k1  # type: ignore
    except ImportError as e:
        raise RuntimeError("pip install ecdsa  — required for GONKA_PROVIDER=gonka_direct") from e

    pk_hex = private_key_hex[2:] if private_key_hex.startswith("0x") else private_key_hex
    sk = SigningKey.from_string(bytes.fromhex(pk_hex), curve=SECP256k1)

    payload_hash = hashlib.sha256(body).hexdigest()
    sig_input = (payload_hash + str(timestamp) + transfer_address).encode()

    def _low_s(r: int, s: int, order: int) -> bytes:
        if s > order // 2:
            s = order - s
        return r.to_bytes(32, "big") + s.to_bytes(32, "big")

    sig = sk.sign_deterministic(sig_input, hashfunc=hashlib.sha256, sigencode=_low_s)
    return base64.b64encode(sig).decode()


def _fetch_transfer_address(base_url: str) -> str:
    """Fetch node's transfer address from /v1/identity (cached per process)."""
    url = base_url.rstrip("/")
    if url.endswith("/v1"):
        url = url[:-3]
    identity_url = f"{url}/v1/identity"
    if not identity_url.startswith("https://"):
        return ""
    try:
        with httpx.Client(timeout=10, verify=_SSL_CTX) as client:
            resp = client.get(identity_url, headers={"User-Agent": "hsi-gonka/0.1.0"})
            data = resp.json()
        addr = data.get("data", {}).get("address", "")
        if addr:
            return addr
    except Exception as e:
        logger.warning("Could not fetch Gonka node identity (%s): %s", identity_url, e)
    return ""


_transfer_address_cache: dict[str, str] = {}


# ── Configuration ────────────────────────────────────────────────────────────

@dataclass
class SapiXConfig:
    api_key: str
    base_url: str = "https://openrouter.ai/api/v1"
    timeout: float = 30.0
    max_retries: int = 3
    retry_delay: float = 1.0       # seconds, doubles each retry
    fallback_enabled: bool = True
    log_usage: bool = True         # track tokens for fund accounting

    # Gonka Direct wallet auth (GONKA_PROVIDER=gonka_direct)
    gonka_private_key: str = ""    # hex privkey for request signing
    gonka_address: str = ""        # gonka1... address

    # Ordered model candidates for THIS provider (cross-provider failover).
    models: list = field(default_factory=list)
    provider: str = "openrouter"

    # Privacy: fields NEVER sent to Gonka
    NEVER_LOG_FIELDS: frozenset = field(default_factory=lambda: frozenset({
        "raw_coordinates", "voice_audio", "ip_address",
        "device_fingerprint", "did_full", "email", "phone"
    }))

    @classmethod
    def from_env(cls) -> "SapiXConfig":
        provider = os.getenv("GONKA_PROVIDER", "openrouter")

        if provider == "gonka_direct":
            # Wallet-based auth — no API key needed
            private_key = os.getenv("GONKA_PRIVATE_KEY", "")
            address = os.getenv("GONKA_ADDRESS", "")
            if not private_key:
                raise ValueError(
                    "GONKA_PRIVATE_KEY is required for GONKA_PROVIDER=gonka_direct. "
                    "Export from inferenced: ./inferenced keys export <name> --unarmored-hex --unsafe --yes"
                )
            return cls(
                api_key="",  # not used for wallet auth
                base_url=os.getenv("GONKA_BASE_URL", "https://node4.gonka.ai/v1"),
                timeout=float(os.getenv("GONKA_TIMEOUT", "30")),
                max_retries=int(os.getenv("GONKA_MAX_RETRIES", "3")),
                fallback_enabled=os.getenv("GONKA_FALLBACK", "true").lower() == "true",
                gonka_private_key=private_key,
                gonka_address=address,
            )

        api_key = os.getenv("GONKA_API_KEY")
        if not api_key:
            raise ValueError(
                "GONKA_API_KEY environment variable is required. "
                "Get your key at https://openrouter.ai or https://gonkagate.com"
            )
        return cls(
            api_key=api_key,
            base_url=os.getenv("GONKA_BASE_URL", "https://openrouter.ai/api/v1"),
            timeout=float(os.getenv("GONKA_TIMEOUT", "30")),
            max_retries=int(os.getenv("GONKA_MAX_RETRIES", "3")),
            fallback_enabled=os.getenv("GONKA_FALLBACK", "true").lower() == "true",
        )

    # Default broker base URLs per provider (for the cross-provider fallback).
    _DEFAULT_BASE = {
        "openrouter":  "https://openrouter.ai/api/v1",
        "joingonka":   "https://gate.joingonka.ai/v1",
        "gonka":       "https://api.gonkagate.com/v1",
        "gonka_direct":"https://node4.gonka.ai/v1",
        "together":    "https://api.together.xyz/v1",
        "ollama":      "http://localhost:11434/v1",
    }

    @classmethod
    def chain_from_env(cls) -> list["SapiXConfig"]:
        """Build the provider failover chain: the primary provider (GONKA_*) plus
        an optional secondary (GONKA_FALLBACK_*). When the primary provider is fully
        down, the client transparently switches to the secondary."""
        from .models import default_chain

        primary = cls.from_env()
        primary.provider = os.getenv("GONKA_PROVIDER", "openrouter")
        _pm = os.getenv("GONKA_MODELS", "").strip()
        primary.models = (
            [m.strip() for m in _pm.split(",") if m.strip()]
            or default_chain(primary.provider)
        )
        configs = [primary]

        fb_provider = os.getenv("GONKA_FALLBACK_PROVIDER", "").strip()
        fb_key = os.getenv("GONKA_FALLBACK_API_KEY", "").strip()
        if fb_provider and fb_key:
            fb = cls(
                api_key=fb_key,
                base_url=(os.getenv("GONKA_FALLBACK_BASE_URL", "").strip()
                          or cls._DEFAULT_BASE.get(fb_provider, cls._DEFAULT_BASE["openrouter"])),
                timeout=primary.timeout,
                max_retries=primary.max_retries,
                fallback_enabled=primary.fallback_enabled,
                provider=fb_provider,
            )
            _fm = os.getenv("GONKA_FALLBACK_MODELS", "").strip()
            fb.models = (
                [m.strip() for m in _fm.split(",") if m.strip()]
                or default_chain(fb_provider)
            )
            configs.append(fb)

        return configs


# ── Response Types ────────────────────────────────────────────────────────────

@dataclass
class ChatMessage:
    role: str
    content: str


@dataclass
class Usage:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass
class ChatResponse:
    content: str
    model: str
    usage: Optional[Usage]
    latency_ms: float
    via_fallback: bool = False
    provider: str = ""   # which provider config actually served this (joingonka/together/…)

    def as_json(self) -> dict:
        try:
            return json.loads(self.content)
        except json.JSONDecodeError as e:
            import re
            clean = self.content
            # Strip <think>...</think> blocks (Qwen3 reasoning traces)
            clean = re.sub(r"<think>.*?</think>", "", clean, flags=re.DOTALL)
            # Strip markdown code fences
            for fence in ["```json", "```JSON", "```"]:
                clean = clean.replace(fence, "")
            clean = clean.strip()
            try:
                return json.loads(clean)
            except json.JSONDecodeError:
                raise ValueError(
                    f"Gonka response is not valid JSON: {self.content[:200]}"
                ) from e


# ── Usage Tracker ────────────────────────────────────────────────────────────

class UsageTracker:
    """
    Tracks token usage for HSI fund accounting.
    Every AI task is paid from the HSI network fund via GNK tokens.
    This tracker records usage so the fund can be replenished via IBC.
    """

    def __init__(self):
        self._records: list[dict] = []
        self._total_tokens: int = 0

    def record(self, model: str, usage: Optional[Usage], task_type: str):
        if not usage:
            return
        record = {
            "timestamp": time.time(),
            "model": model,
            "task_type": task_type,
            "tokens": usage.total_tokens,
            # No personal data — just model metrics
        }
        self._records.append(record)
        self._total_tokens += usage.total_tokens

    @property
    def total_tokens(self) -> int:
        return self._total_tokens

    def get_summary(self) -> dict:
        by_task: dict[str, int] = {}
        for r in self._records:
            by_task[r["task_type"]] = by_task.get(r["task_type"], 0) + r["tokens"]
        return {
            "total_tokens": self._total_tokens,
            "total_requests": len(self._records),
            "by_task": by_task,
            "estimated_gns_cost": self._total_tokens * 0.000002,  # rough estimate
        }


# ── Main Client ───────────────────────────────────────────────────────────────

class SapiXClient:
    """
    Async HTTP client for Gonka Network.

    Example:
        client = SapiXClient(api_key="gk-...")
        response = await client.chat(
            model=SapiXModel.PRIMARY,
            messages=[{"role": "user", "content": "Hello"}],
            task_type="expression_analysis"
        )
        data = response.as_json()
    """

    def __init__(self, api_key: Optional[str] = None, config: Optional[SapiXConfig] = None):
        if config:
            self.configs = [config]
        elif api_key:
            self.configs = [SapiXConfig(api_key=api_key)]
        else:
            self.configs = SapiXConfig.chain_from_env()
        # self.config = primary, kept for backward compatibility
        self.config = self.configs[0]

        self.usage = UsageTracker()
        self._request_count = 0
        self._usage_callback: Optional[Any] = None  # async callable(task_type, model, usage, latency_ms, via_fallback)

    async def chat(
        self,
        model: str,
        messages: list[dict],
        *,
        max_tokens: int = 512,
        temperature: float = 0.1,
        task_type: str = "general",
        timeout_override: Optional[float] = None,
    ) -> ChatResponse:
        """
        Send a chat completion request to Gonka.

        Args:
            model: SapiXModel constant or model string
            messages: OpenAI-format message list
            max_tokens: Maximum response tokens
            temperature: 0.0=deterministic, 1.0=creative
            task_type: Label for usage tracking (e.g. "expression_analysis")
            timeout_override: Override default timeout for this request

        Returns:
            ChatResponse with .content (str) and .as_json() helper
        """
        self._request_count += 1
        timeout = timeout_override or self.config.timeout
        start = time.monotonic()

        # Sanitize messages — strip any accidentally included private fields
        safe_messages = self._sanitize_messages(messages)

        payload = {
            "model": model,
            "messages": safe_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        # Cross-provider failover: try the primary provider's model chain, then
        # each fallback provider's chain. A model 404 → next model (same provider);
        # a provider-level failure (network/auth/whole broker down) → next provider.
        last_error: Optional[Exception] = None

        for ci, cfg in enumerate(self.configs):
            # Primary provider also honors the explicitly requested model first.
            cand_models = list(cfg.models)
            if ci == 0 and model and model not in cand_models:
                cand_models = [model] + cand_models
            if not cand_models:
                cand_models = [model]

            provider_down = False
            for cand in cand_models:
                if provider_down:
                    break
                payload["model"] = cand
                delay = cfg.retry_delay

                for attempt in range(cfg.max_retries):
                    try:
                        response_data = await self._post("/chat/completions", payload, timeout, cfg)

                        latency_ms = (time.monotonic() - start) * 1000
                        content = response_data["choices"][0]["message"]["content"]
                        model_used = response_data.get("model", cand)

                        usage_data = response_data.get("usage")
                        usage = None
                        if usage_data:
                            usage = Usage(
                                prompt_tokens=usage_data.get("prompt_tokens", 0),
                                completion_tokens=usage_data.get("completion_tokens", 0),
                                total_tokens=usage_data.get("total_tokens", 0),
                            )
                            self.usage.record(model_used, usage, task_type)

                        logger.debug(
                            "Gonka %s/%s | task=%s latency=%.0fms tok=%s",
                            cfg.provider, model_used.split("/")[-1], task_type,
                            latency_ms, usage.total_tokens if usage else "?",
                        )

                        resp = ChatResponse(
                            content=content,
                            model=model_used,
                            usage=usage,
                            latency_ms=latency_ms,
                            via_fallback=(ci > 0),
                            provider=cfg.provider,
                        )
                        if self._usage_callback and usage:
                            try:
                                await self._usage_callback(
                                    task_type, model_used, usage, latency_ms, ci > 0
                                )
                            except Exception:
                                pass  # never block on logging errors
                        return resp

                    except Exception as e:
                        last_error = e
                        msg = str(e).lower()
                        provider_level = any(s in msg for s in (
                            "cannot reach", "connection", "timeout",
                            "unauthorized", "invalid api key", " 401", " 403",
                        ))
                        model_dead = any(s in msg for s in (
                            "model_unavailable", "not found",
                            "currently unavailable", "invalid_request_error",
                        ))
                        if provider_level:
                            logger.warning(
                                "Provider '%s' unavailable — switching provider (%s)",
                                cfg.provider, e,
                            )
                            provider_down = True
                            break
                        if model_dead:
                            logger.warning(
                                "Model '%s' unavailable on '%s' — next model (%s)",
                                cand, cfg.provider, e,
                            )
                            break
                        if attempt < cfg.max_retries - 1:
                            logger.warning(
                                "Gonka attempt %d/%d (%s/%s) failed: %s. Retrying in %.1fs...",
                                attempt + 1, cfg.max_retries, cfg.provider, cand, e, delay
                            )
                            await asyncio.sleep(delay)
                            delay *= 2  # exponential backoff

        # All providers + models exhausted — fail-closed fallback
        if self.config.fallback_enabled:
            logger.warning(
                "All providers exhausted (%d config(s)). Using fail-closed fallback.",
                len(self.configs),
            )
            return await self._fallback_response(messages, task_type, start)

        raise RuntimeError(
            f"Gonka request failed across all providers: {last_error}"
        )

    async def _post(self, path: str, payload: dict, timeout: float,
                    cfg: Optional["SapiXConfig"] = None) -> dict:
        """Low-level async HTTP POST against a specific provider config."""
        cfg = cfg or self.config
        url = cfg.base_url.rstrip("/") + path
        body = json.dumps(payload).encode()

        if cfg.gonka_private_key:
            # Gonka Direct: wallet-based ECDSA signing
            transfer_addr = _transfer_address_cache.get(cfg.base_url)
            if not transfer_addr:
                transfer_addr = _fetch_transfer_address(cfg.base_url)
                if transfer_addr:
                    _transfer_address_cache[cfg.base_url] = transfer_addr

            if not transfer_addr:
                raise ConnectionError("Cannot get Gonka node transfer address from /v1/identity")

            ts = _hybrid_ts_ns()
            sig = _gonka_sign(body, cfg.gonka_private_key, ts, transfer_addr)
            headers = {
                "Content-Type": "application/json",
                "Authorization": sig,
                "X-Requester-Address": cfg.gonka_address,
                "X-Timestamp": str(ts),
                "User-Agent": "hsi-gonka/0.1.0",
                "X-HSI-Request-ID": self._request_id(),
            }
        else:
            # Standard Bearer auth (OpenRouter, GonkaGate, etc.)
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {cfg.api_key}",
                "User-Agent": "hsi-gonka/0.1.0",
                "X-HSI-Request-ID": self._request_id(),
            }

        loop = asyncio.get_event_loop()
        response_data = await loop.run_in_executor(
            None,
            lambda: self._sync_post(url, body, headers, timeout)
        )
        return response_data

    def _sync_post(self, url: str, body: bytes, headers: dict, timeout: float) -> dict:
        """Synchronous HTTP call (run in executor thread)."""
        try:
            with httpx.Client(timeout=timeout, verify=_SSL_CTX) as client:
                resp = client.post(url, content=body, headers=headers)
                data = resp.json()

                if "error" in data:
                    raise ValueError(f"Gonka API error: {data['error']}")

                return data
        except httpx.ConnectError as e:
            raise ConnectionError(f"Cannot reach Gonka node: {e}") from e
        except httpx.HTTPStatusError as e:
            raise ConnectionError(f"Gonka HTTP {e.response.status_code}") from e

    async def _fallback_response(
        self, messages: list[dict], task_type: str, start: float
    ) -> ChatResponse:
        """
        Fallback when Gonka is unavailable.
        Fail-closed for verification: if AI is down, block the gesture rather
        than issue credentials without ML review. Other tasks (translation,
        bond matching) remain fail-open since they are not security gates.
        """
        latency_ms = (time.monotonic() - start) * 1000

        # Task-specific safe defaults
        fallback_content = {
            "expression_analysis": json.dumps({
                "is_human": False,
                "confidence": 0.0,
                "reasoning": "AI inference unavailable — gesture rejected (fail-closed)",
                "anomalies": ["ai_unavailable"],
                "fallback": True,
            }),
            "antibot_detection": json.dumps({
                "bot_probability": 0.0,  # don't block comms on infra failure
                "signals": [],
                "fallback": True,
            }),
            "bond_matching": json.dumps({
                "selected": [],
                "reasoning": "Matching unavailable — use random selection",
                "fallback": True,
            }),
            "translation": messages[-1].get("content", ""),  # return original
        }.get(task_type, json.dumps({"fallback": True, "status": "unavailable"}))

        resp = ChatResponse(
            content=fallback_content,
            model="fallback",
            usage=None,
            latency_ms=latency_ms,
            via_fallback=True,
            provider="rule_based",   # all providers failed — local rule-based response
        )
        if self._usage_callback:
            try:
                await self._usage_callback(
                    task_type, "fallback", Usage(0, 0, 0), latency_ms, True
                )
            except Exception:
                pass
        return resp

    def _sanitize_messages(self, messages: list[dict]) -> list[dict]:
        """
        Privacy guard: strip any accidentally included personal data.
        This is a last line of defense — callers should not include
        personal data in the first place.
        """
        safe = []
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                # Check for accidentally included sensitive patterns
                for field in self.config.NEVER_LOG_FIELDS:
                    if field in content.lower():
                        logger.warning(
                            "Potentially sensitive field '%s' found in Gonka message. "
                            "Ensure only anonymized data is sent.", field
                        )
            safe.append({"role": msg["role"], "content": content})
        return safe

    def _request_id(self) -> str:
        """Generates anonymous request ID for tracing (no personal data)."""
        data = f"{time.time()}{self._request_count}".encode()
        return hashlib.sha256(data).hexdigest()[:16]

    async def health_check(self) -> dict:
        """Check if Gonka broker is reachable."""
        try:
            start = time.monotonic()
            # Use PRIMARY for gonka_direct (FAST model returns Bad Request on small payloads)
            model = SapiXModel.PRIMARY if self.config.gonka_private_key else SapiXModel.FAST
            response = await self.chat(
                model=model,
                messages=[{"role": "user", "content": "Reply with one word: ok"}],
                max_tokens=16,
                task_type="health_check",
                timeout_override=15.0,
            )
            return {
                "status": "ok",
                "latency_ms": response.latency_ms,
                "model": response.model,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
