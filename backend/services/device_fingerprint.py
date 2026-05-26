"""
DeviceFingerprintStore — защита от Sybil-атаки (Вариант C).

Хранит SHA-256 хэши device fingerprint и ограничивает число верификаций
с одного устройства/браузера за скользящее окно.

Принципы zero-PII:
  - Бэкенд получает только хэш (64 hex символа) — необратим, не содержит PII
  - Хранится связь fp_hash → [{"ts": unix, "did_hash_short": "aabbcc..."}]
  - IP-адрес НЕ хранится

Production: заменить _store на PostgreSQL (таблица device_fingerprints).
Dev: in-memory dict (по умолчанию, если не задан DATABASE_URL).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Optional

# Конфигурация через env
FP_WINDOW_DAYS = int(os.getenv("SYBIL_FP_WINDOW_DAYS", "30"))
FP_MAX_VERIFICATIONS = int(os.getenv("SYBIL_FP_MAX_VERIFICATIONS", "3"))


@dataclass
class FingerprintRecord:
    fp_hash: str
    verifications: list[dict] = field(default_factory=list)
    # каждый элемент: {"ts": int, "did_hash_short": str}


@dataclass
class FingerprintCheckResult:
    allowed: bool
    count: int
    limit: int
    next_allowed_at: Optional[int]   # unix timestamp когда снова можно
    window_days: int


class DeviceFingerprintStore:
    """
    Rate-limiter для верификаций по device fingerprint.

    Пример использования:
        fp_store = DeviceFingerprintStore()
        result = fp_store.check_and_record("a3f2b1...", "did_hash_short")
        if not result.allowed:
            raise HTTPException(429, ...)
    """

    def __init__(self) -> None:
        self._store: dict[str, FingerprintRecord] = {}

    def check_and_record(
        self,
        fp_hash: str,
        did_hash_short: str = "pending",
    ) -> FingerprintCheckResult:
        """
        Проверить лимит и, если разрешено, записать новую верификацию.
        Атомарная операция (для in-memory версии потокобезопасность не нужна,
        asyncio — однопоточный).

        Args:
            fp_hash:        SHA-256 от device fingerprint (64 символа hex)
            did_hash_short: Первые 12 символов SHA3-256(did), записывается
                            в журнал (анонимно). "pending" — если DID ещё
                            не создан (проверка происходит до генерации DID).

        Returns:
            FingerprintCheckResult с allowed=True/False
        """
        now = int(time.time())
        window_start = now - FP_WINDOW_DAYS * 86400

        rec = self._store.setdefault(
            fp_hash, FingerprintRecord(fp_hash=fp_hash)
        )

        # Отсекаем устаревшие записи (скользящее окно)
        rec.verifications = [
            v for v in rec.verifications if v["ts"] > window_start
        ]

        count = len(rec.verifications)

        if count >= FP_MAX_VERIFICATIONS:
            oldest_ts = min(v["ts"] for v in rec.verifications)
            next_allowed = oldest_ts + FP_WINDOW_DAYS * 86400
            return FingerprintCheckResult(
                allowed=False,
                count=count,
                limit=FP_MAX_VERIFICATIONS,
                next_allowed_at=next_allowed,
                window_days=FP_WINDOW_DAYS,
            )

        # Записываем
        rec.verifications.append({"ts": now, "did_hash_short": did_hash_short})
        return FingerprintCheckResult(
            allowed=True,
            count=count + 1,
            limit=FP_MAX_VERIFICATIONS,
            next_allowed_at=None,
            window_days=FP_WINDOW_DAYS,
        )

    def update_did_hash(self, fp_hash: str, did_hash_short: str) -> None:
        """
        Обновить did_hash_short для последней записи (вызывается после
        генерации DID, когда fp_hash был записан как "pending").
        """
        rec = self._store.get(fp_hash)
        if not rec or not rec.verifications:
            return
        last = rec.verifications[-1]
        if last.get("did_hash_short") == "pending":
            last["did_hash_short"] = did_hash_short

    def stats(self) -> dict:
        """Диагностика (для /api/health или debug-эндпоинта)."""
        return {
            "total_fingerprints": len(self._store),
            "total_verifications": sum(
                len(r.verifications) for r in self._store.values()
            ),
            "window_days": FP_WINDOW_DAYS,
            "max_verifications": FP_MAX_VERIFICATIONS,
        }
