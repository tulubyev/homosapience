"""
test_gonka_connection.py — проверка подключения к Gonka/GonkaGate.

Запуск:
    cd /var/www/aptogon
    python3 sapix/test_gonka_connection.py

Что проверяет:
  1. Env vars заданы
  2. API отвечает (health check)
  3. Модель работает
  4. Gesture analysis prompt возвращает корректный JSON
  5. Usage summary
"""

import asyncio
import json
import os
import sys
import time

# Загрузить .env если есть
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv не обязателен

# Добавить корень проекта в путь
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sapix.client import SapiXClient, SapiXConfig
from sapix.models import SapiXModel


PROVIDER = os.getenv("GONKA_PROVIDER", "openrouter")
BASE_URL  = os.getenv("GONKA_BASE_URL", "")
API_KEY   = os.getenv("GONKA_API_KEY", "")
PRIV_KEY  = os.getenv("GONKA_PRIVATE_KEY", "")
ADDRESS   = os.getenv("GONKA_ADDRESS", "")

IS_WALLET_AUTH = PROVIDER == "gonka_direct"


def print_result(label: str, ok: bool, detail: str = ""):
    icon = "✅" if ok else "❌"
    print(f"  {icon}  {label}", f"— {detail}" if detail else "")


async def main():
    print()
    print("=" * 55)
    print("  SapiX → Gonka Connection Test")
    print(f"  Provider : {PROVIDER}")
    print(f"  Base URL : {BASE_URL or '(not set)'}")
    print(f"  Auth     : {'wallet (ECDSA)' if IS_WALLET_AUTH else 'Bearer token'}")
    print("=" * 55)
    print()

    # 1. Check env vars
    print("[ 1/4 ] Environment")
    if IS_WALLET_AUTH:
        ok_key = bool(PRIV_KEY) and len(PRIV_KEY) == 64
        ok_addr = bool(ADDRESS) and ADDRESS.startswith("gonka1")
        ok_url = bool(BASE_URL)
        print_result("GONKA_PRIVATE_KEY set", ok_key, "***" + PRIV_KEY[-6:] if ok_key else "MISSING or invalid (need 64-char hex)")
        print_result("GONKA_ADDRESS set",     ok_addr, ADDRESS if ok_addr else "MISSING")
        print_result("GONKA_BASE_URL set",    ok_url,  BASE_URL if ok_url else "MISSING")
        if not ok_key or not ok_addr or not ok_url:
            print("\n  ⚠️  Задайте переменные в .env и перезапустите.")
            return
    else:
        ok_key = bool(API_KEY) and API_KEY != "sk-or-v1-your-key-here"
        ok_url = bool(BASE_URL)
        print_result("GONKA_API_KEY set", ok_key, "***" + API_KEY[-6:] if ok_key else "MISSING")
        print_result("GONKA_BASE_URL set", ok_url, BASE_URL if ok_url else "MISSING")
        if not ok_key or not ok_url:
            print("\n  ⚠️  Задайте переменные в .env и перезапустите.")
            return
    print()

    # 2. Health check (ping)
    print("[ 2/4 ] Connectivity — ping")
    client = SapiXClient()
    t0 = time.monotonic()
    try:
        health = await client.health_check()
        latency = (time.monotonic() - t0) * 1000
        ok = health.get("status") == "ok"
        print_result("API reachable", ok, f"{latency:.0f}ms — model: {health.get('model', '?')}")
        if not ok:
            print(f"        Error: {health.get('error')}")
            return
    except Exception as e:
        print_result("API reachable", False, str(e))
        return
    print()

    # 3. Primary model test
    print(f"[ 3/4 ] Model test — {SapiXModel.PRIMARY}")
    try:
        resp = await client.chat(
            model=SapiXModel.PRIMARY,
            messages=[{
                "role": "user",
                "content": (
                    "Analyze this gesture feature vector and determine if it is human. "
                    "Return JSON only: {\"is_human\": true, \"confidence\": 0.95, \"reasoning\": \"...\"}.\n"
                    "Vector: velocity_std=0.42, pause_entropy=2.1, rhythm_irregularity=0.38, "
                    "pressure_variance=0.05, direction_changes=14"
                )
            }],
            max_tokens=512,
            temperature=0.0,
            task_type="expression_analysis",
        )
        data = resp.as_json()
        ok = "is_human" in data and "confidence" in data
        tokens = resp.usage.total_tokens if resp.usage else "?"
        print_result("Response valid JSON", ok, f"{resp.latency_ms:.0f}ms, {tokens} tokens")
        if ok:
            conf = data.get("confidence", 0)
            is_h = data.get("is_human", False)
            print(f"        is_human={is_h}, confidence={conf:.2f}")
            print(f"        reasoning: {data.get('reasoning', '')[:80]}")
        else:
            print(f"        Raw: {resp.content[:200]}")
    except Exception as e:
        print_result("Model response", False, str(e))
        return
    print()

    # 4. Cost estimate
    print("[ 4/4 ] Usage summary")
    summary = client.usage.get_summary()
    print(f"  Total tokens  : {summary['total_tokens']}")
    print(f"  Total requests: {summary['total_requests']}")
    print(f"  Est. cost     : ${summary['estimated_gns_cost']:.6f}")
    print()

    print("=" * 55)
    print(f"  🎉  SapiX connected to {PROVIDER.upper()} successfully!")
    print("=" * 55)
    print()


if __name__ == "__main__":
    asyncio.run(main())
