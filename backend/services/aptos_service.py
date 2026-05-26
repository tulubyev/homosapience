"""
aptogon/aptos_service.py — Единственный блокчейн в APTOGON.

Cosmos SDK убран полностью.
Ceramic убран полностью.
Остался только Aptos — для одной задачи:
  Хранить факт верификации человека on-chain.

Два смарт-контракта:
  hsi::credential::issue_credential(did_hash, expression_proof, bond_count)
  hsi::credential::is_human(address) → bool
  hsi::credential::revoke(address)

Всё остальное (профили, сообщения, репутация) — off-chain в PostgreSQL/Redis.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import traceback
from dataclasses import dataclass
from typing import Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


@dataclass
class CredentialRecord:
    """Запись в Aptos блокчейне."""
    address: str
    did_hash: str
    expression_proof: str
    bond_count: int
    issued_at: int
    valid_until: int
    revoked: bool = False
    # ── Sybil Protection B: Trust Score ────────────────────────────────────────
    trust_score: float = 0.1     # 0.1 = прошёл SapiX; 0.5 = 3+ bonds; 1.0 = 7+ bonds
    bond_sponsors: list = None   # did_hash_short поручителей (анонимно)

    def __post_init__(self):
        if self.bond_sponsors is None:
            self.bond_sponsors = []

    @property
    def is_valid(self) -> bool:
        return not self.revoked and time.time() < self.valid_until

    @property
    def trust_label(self) -> str:
        """Человекочитаемый уровень доверия."""
        if self.trust_score >= 1.0:
            return "trusted"
        if self.trust_score >= 0.5:
            return "community_verified"
        return "newcomer"


class AptosService:
    """
    Взаимодействие с Aptos — только для HumanCredential.

    Testnet: https://fullnode.testnet.aptoslabs.com/v1
    Explorer: https://explorer.aptoslabs.com/?network=testnet
    Faucet:   https://aptoslabs.com/testnet-faucet

    Получить тестовые APT:
        curl -X POST https://faucet.testnet.aptoslabs.com/mint \
          -d '{"address":"YOUR_ADDRESS","amount":10000}'
    """

    # TTL credential по умолчанию
    CREDENTIAL_TTL = 30 * 86400  # 30 дней

    def __init__(self):
        self.node_url = os.getenv(
            "APTOS_NODE_URL",
            "https://fullnode.testnet.aptoslabs.com/v1"
        )
        self.contract = os.getenv("APTOGON_CONTRACT", "0x1")
        self.private_key = os.getenv("APTOS_PRIVATE_KEY")
        self.signer_address = os.getenv("APTOS_SIGNER_ADDRESS")

        # In-memory fallback для MVP без реального Aptos
        self._local_store: dict[str, CredentialRecord] = {}
        self._use_local = not bool(self.private_key)

        if self._use_local:
            print("⚠️  APTOS_PRIVATE_KEY не задан — используется local store (только для MVP)")

    async def issue_credential(
        self,
        address: str,
        did_hash: str,
        expression_proof: str,
        bond_count: int = 0,
    ) -> dict:
        """
        Выдаёт HumanCredential.
        В production записывает в Aptos Move контракт.
        В MVP — хранит локально.
        """
        now = int(time.time())
        record = CredentialRecord(
            address=address,
            did_hash=did_hash,
            expression_proof=expression_proof,
            bond_count=bond_count,
            issued_at=now,
            valid_until=now + self.CREDENTIAL_TTL,
        )

        if self._use_local:
            self._local_store[address] = record
            return {
                "tx_hash": f"local:{hashlib.sha256(address.encode()).hexdigest()[:16]}",
                "network": "local_mock",
                "valid_until": record.valid_until,
                "explorer_url": None,
            }

        # Production: вызываем Aptos Move контракт
        # Модуль: hsi::human_firewall
        # record_expression_proof(account, expression_proof, session_id)
        # issue_credential вызывается позже через bond flow
        try:
            tx_hash = await self._submit_tx(
                function=f"{self.contract}::human_firewall::record_expression_proof",
                args=[expression_proof, did_hash],  # proof, session_id(=did_hash)
            )
            return {
                "tx_hash": tx_hash,
                "network": "testnet" if "testnet" in self.node_url else "mainnet",
                "valid_until": record.valid_until,
                "explorer_url": f"https://explorer.aptoslabs.com/txn/{tx_hash}",
            }
        except Exception as e:
            # Aptos недоступен — сохраняем локально
            err_msg = str(e)
            err_tb = traceback.format_exc()
            logger.error("❌ Aptos _submit_tx failed: %s\n%s", err_msg, err_tb)
            print(f"❌ APTOS ERROR: {err_msg}\n{err_tb}")
            self._local_store[address] = record
            return {
                "tx_hash": f"fallback:{hashlib.sha256(address.encode()).hexdigest()[:16]}",
                "network": "local_fallback",
                "valid_until": record.valid_until,
                "error": err_msg,
            }

    async def is_human(self, address: str) -> bool:
        """Проверяет наличие действующего credential."""
        # Сначала проверяем локальный store
        if address in self._local_store:
            return self._local_store[address].is_valid

        if self._use_local:
            return False

        # Запрос к Aptos view-function
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self._view(
                    f"{self.contract}::human_firewall::is_human",
                    [address]
                )
            )
            return bool(result)
        except Exception:
            return True  # оптимистично при недоступности ноды

    async def get_credential(self, address: str) -> Optional[CredentialRecord]:
        """Получить полную запись credential."""
        if address in self._local_store:
            return self._local_store[address]
        return None

    async def update_trust_score(
        self,
        address: str,
        new_score: float,
        bond_sponsors: Optional[list[str]] = None,
    ) -> dict:
        """
        Обновить trust_score для credential.
        В production: вызов hsi::credential::update_trust_score(address, score_u64).
        """
        new_score = round(min(1.0, max(0.0, new_score)), 2)
        if address in self._local_store:
            rec = self._local_store[address]
            rec.trust_score = new_score
            if bond_sponsors is not None:
                rec.bond_sponsors = bond_sponsors
            rec.bond_count = len(rec.bond_sponsors)
        return {"updated": True, "address": address, "trust_score": new_score}

    async def revoke(self, address: str) -> bool:
        """Отозвать credential (бот обнаружен)."""
        if address in self._local_store:
            self._local_store[address].revoked = True
            return True
        return False

    async def get_stats(self) -> dict:
        """Статистика для дашборда."""
        total = len(self._local_store)
        valid = sum(1 for r in self._local_store.values() if r.is_valid)
        return {
            "total_credentials": total,
            "valid_credentials": valid,
            "revoked": total - valid,
            "network": "local_mock" if self._use_local else "aptos_testnet",
        }

    # ── Internal ──────────────────────────────────────────────────────────────

    def _view(self, function: str, args: list):
        """Вызов view-функции Aptos."""
        url = f"{self.node_url}/view"
        payload = json.dumps({
            "function": function,
            "type_arguments": [],
            "arguments": args,
        }).encode()
        req = Request(url, data=payload,
                     headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return data[0] if data else None

    async def _submit_tx(self, function: str, args: list) -> str:
        """
        Отправить транзакцию в Aptos через REST API (без BCS от Python SDK).

        Используем /transactions/encode_submission — нода сама делает BCS-кодирование,
        мы только подписываем ed25519. Это обходит несовместимость версий aptos-sdk.
        """
        import asyncio

        # Нормализуем ключ
        raw_key = self.private_key.strip()
        if raw_key.startswith("ed25519-priv-"):
            raw_key = raw_key[len("ed25519-priv-"):]
        if raw_key.startswith("0x") or raw_key.startswith("0X"):
            raw_key = raw_key[2:]

        print(f"🔑 Loading Aptos key (len={len(raw_key)})")

        # Ed25519 подпись через cryptography (зависимость aptos-sdk, точно установлена)
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey as CryptoKey
        pk_bytes = bytes.fromhex(raw_key)
        signing_key = CryptoKey.from_private_bytes(pk_bytes)
        pub_bytes = signing_key.public_key().public_bytes_raw()
        signer = self.signer_address or ("0x" + pub_bytes.hex())
        print(f"🔑 Signer: {signer}")

        # 1. Получаем sequence_number
        acct_url = f"{self.node_url}/accounts/{signer}"
        req = Request(acct_url, headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=10) as resp:
            acct_data = json.loads(resp.read())
        seq_num = str(acct_data["sequence_number"])
        print(f"📋 Sequence number: {seq_num}")

        # 2. Аргументы vector<u8>: hex-кодируем строки
        hex_args = ["0x" + str(a).encode("utf-8").hex() for a in args]

        unsigned_tx = {
            "sender": signer,
            "sequence_number": seq_num,
            "max_gas_amount": "5000",
            "gas_unit_price": "100",
            "expiration_timestamp_secs": str(int(time.time()) + 600),
            "payload": {
                "type": "entry_function_payload",
                "function": function,
                "type_arguments": [],
                "arguments": hex_args,
            },
        }

        print(f"📡 Encoding TX: {function} args={hex_args}")

        # 3. Encode submission (нода возвращает bytes для подписи)
        encode_url = f"{self.node_url}/transactions/encode_submission"
        encode_payload = json.dumps(unsigned_tx).encode()
        req = Request(encode_url, data=encode_payload,
                      headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(req, timeout=10) as resp:
            signing_message_hex: str = json.loads(resp.read())  # "0x..."

        msg_bytes = bytes.fromhex(
            signing_message_hex[2:] if signing_message_hex.startswith("0x") else signing_message_hex
        )

        # 4. Подписываем ed25519
        signature = signing_key.sign(msg_bytes)

        # 5. Отправляем подписанную транзакцию
        signed_tx = {
            **unsigned_tx,
            "signature": {
                "type": "ed25519_signature",
                "public_key": "0x" + pub_bytes.hex(),
                "signature": "0x" + signature.hex(),
            },
        }

        submit_url = f"{self.node_url}/transactions"
        submit_payload = json.dumps(signed_tx).encode()
        req = Request(submit_url, data=submit_payload,
                      headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())

        tx_hash = result["hash"]
        print(f"✅ Aptos TX submitted: {tx_hash}")

        # 6. Ждём подтверждения (polling)
        confirmed = False
        for _ in range(20):
            await asyncio.sleep(1)
            try:
                check_url = f"{self.node_url}/transactions/by_hash/{tx_hash}"
                req = Request(check_url)
                with urlopen(req, timeout=5) as resp:
                    tx_data = json.loads(resp.read())
                if tx_data.get("success") is True:
                    confirmed = True
                    break
            except Exception:
                pass

        if confirmed:
            print(f"✅ Aptos TX confirmed: {tx_hash}")
        else:
            print(f"⚠️  Aptos TX pending: {tx_hash}")

        return tx_hash
