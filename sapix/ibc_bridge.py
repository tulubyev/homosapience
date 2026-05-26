"""
IBCBridge — Cosmos IBC integration for HSI Chain ↔ Gonka Chain payments.

Both HSI Chain and Gonka Chain are built on Cosmos SDK.
IBC (Inter-Blockchain Communication) enables trustless cross-chain messages.

Payment flow:
  1. User submits verification request to HSI
  2. HSI Chain creates an IBC packet to Gonka Chain
  3. Gonka Chain deducts GNK tokens from HSI Fund account
  4. Gonka runs the AI inference task
  5. Result returned via IBC acknowledgement
  6. HSI Chain records the ExpressionProof on-chain

HSI Fund:
  - Funded by 1% of all reputation transactions
  - Topped up by HSI governance votes
  - Users pay ZERO — all AI tasks covered by fund

This module provides the Python client for submitting IBC tasks
from HSI backend services to HSI Chain (which then sends to Gonka Chain).
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from typing import Optional
from urllib.error import URLError
from urllib.request import Request, urlopen


# ── Data Types ────────────────────────────────────────────────────────────────

@dataclass
class IBCTask:
    """A task packet to send from HSI Chain → Gonka Chain via IBC."""
    task_id: str
    task_type: str           # "expression", "antibot", "translation", "bond_match"
    payload_hash: str        # SHA3-256 of anonymized payload
    gnk_budget: int          # Max GNK tokens to spend
    timeout_blocks: int      # Timeout in blocks (~30 seconds each)


@dataclass
class IBCResult:
    task_id: str
    success: bool
    result_hash: str         # SHA3-256 of result (for verification)
    gnk_spent: int
    block_height: int
    error: Optional[str] = None


@dataclass
class FundStatus:
    balance_gnk: int
    reserved_gnk: int        # In-flight tasks
    available_gnk: int
    total_tasks_today: int
    estimated_days_remaining: float


# ── IBC Bridge Client ─────────────────────────────────────────────────────────

class IBCBridge:
    """
    Client for submitting AI tasks from HSI backend to HSI Chain,
    which relays them to Gonka Chain via IBC.

    In MVP: This talks to HSI Chain's REST API endpoint.
    In production: Uses Cosmos SDK transaction signing.

    Example:
        bridge = IBCBridge(
            hsi_chain_url="https://api.hsi-testnet.cosmos.network",
            signer_private_key=os.getenv("HSI_SIGNER_KEY"),
        )

        task = await bridge.submit_verification_task(
            task_type="expression",
            payload_hash=expression_proof_hash,
            session_id=session_uuid,
        )

        result = await bridge.wait_for_result(task.task_id, timeout=30)
        if result.success:
            # Write ExpressionProof to credential
            ...
    """

    # GNK budget per task type (from HSI Fund)
    TASK_BUDGETS = {
        "expression":  100,    # ~$0.0002
        "antibot":     20,     # ~$0.00004
        "translation": 200,    # ~$0.0004
        "bond_match":  500,    # ~$0.001
        "fine_tune":   100_000 # ~$0.2 per batch
    }

    DEFAULT_TIMEOUT_BLOCKS = 10  # ~5 minutes

    def __init__(
        self,
        hsi_chain_url: str,
        signer_address: str,
        signer_private_key: Optional[str] = None,
        network: str = "testnet",
    ):
        self.chain_url = hsi_chain_url.rstrip("/")
        self.signer_address = signer_address
        self.signer_private_key = signer_private_key
        self.network = network
        self._pending_tasks: dict[str, IBCTask] = {}

    async def submit_verification_task(
        self,
        task_type: str,
        payload_hash: str,
        session_id: str,
        budget_override: Optional[int] = None,
    ) -> IBCTask:
        """
        Submit a verification task to HSI Chain for relay to Gonka via IBC.

        Args:
            task_type: One of "expression", "antibot", "translation", "bond_match"
            payload_hash: SHA3-256 of anonymized task payload
            session_id: Anonymous session UUID
            budget_override: Override default GNK budget

        Returns:
            IBCTask — use task.task_id to poll for result
        """
        task_id = str(uuid.uuid4())
        gnk_budget = budget_override or self.TASK_BUDGETS.get(task_type, 100)

        task = IBCTask(
            task_id=task_id,
            task_type=task_type,
            payload_hash=payload_hash,
            gnk_budget=gnk_budget,
            timeout_blocks=self.DEFAULT_TIMEOUT_BLOCKS,
        )

        # Build Cosmos transaction message
        msg = {
            "typeUrl": "/hsi.gonka.MsgSubmitTask",
            "value": {
                "sender": self.signer_address,
                "taskId": task_id,
                "taskType": task_type,
                "payloadHash": payload_hash,
                "sessionId": session_id,
                "gnkBudget": str(gnk_budget),
                "timeoutBlocks": self.DEFAULT_TIMEOUT_BLOCKS,
                "ibcChannel": self._get_gonka_channel(),
            }
        }

        # Sign and broadcast (simplified — production uses cosmos SDK)
        tx_hash = await self._broadcast_tx(msg)
        task_id_with_tx = f"{task_id}:{tx_hash[:8]}"

        self._pending_tasks[task_id] = task
        return task

    async def wait_for_result(
        self,
        task_id: str,
        timeout_seconds: float = 30.0,
        poll_interval: float = 1.0,
    ) -> IBCResult:
        """
        Poll HSI Chain for IBC task result.

        Args:
            task_id: Task ID from submit_verification_task
            timeout_seconds: Max wait time
            poll_interval: Polling frequency

        Returns:
            IBCResult — check .success before using
        """
        import asyncio
        deadline = time.monotonic() + timeout_seconds

        while time.monotonic() < deadline:
            result = await self._query_task_result(task_id)
            if result is not None:
                return result
            await asyncio.sleep(poll_interval)

        return IBCResult(
            task_id=task_id,
            success=False,
            result_hash="",
            gnk_spent=0,
            block_height=0,
            error=f"Timeout after {timeout_seconds}s",
        )

    async def get_fund_status(self) -> FundStatus:
        """Query the current HSI Fund balance on Gonka Chain."""
        try:
            response = await self._query(
                f"/hsi/gonka/fund/{self.signer_address}"
            )
            data = response.get("fund", {})
            balance = int(data.get("balance", 0))
            reserved = int(data.get("reserved", 0))
            return FundStatus(
                balance_gnk=balance,
                reserved_gnk=reserved,
                available_gnk=balance - reserved,
                total_tasks_today=int(data.get("tasks_today", 0)),
                estimated_days_remaining=(
                    (balance - reserved) / max(1, int(data.get("daily_avg_spend", 1)))
                ),
            )
        except Exception:
            return FundStatus(
                balance_gnk=0, reserved_gnk=0, available_gnk=0,
                total_tasks_today=0, estimated_days_remaining=0.0,
            )

    # ── Private helpers ──────────────────────────────────────────────────────

    def _get_gonka_channel(self) -> str:
        """IBC channel ID for HSI Chain → Gonka Chain."""
        channels = {
            "testnet": "channel-0",
            "mainnet": "channel-42",  # Will be established at genesis
        }
        return channels.get(self.network, "channel-0")

    async def _broadcast_tx(self, msg: dict) -> str:
        """
        Sign and broadcast a Cosmos transaction.
        In MVP uses unsigned simulation mode.
        Production requires proper key management.
        """
        endpoint = f"{self.chain_url}/cosmos/tx/v1beta1/txs"

        # Simplified TX body (production needs proper signing)
        tx_body = {
            "tx": {
                "body": {
                    "messages": [msg],
                    "memo": "hsi-gonka-integration",
                },
                "auth_info": {
                    "signer_infos": [],
                    "fee": {"amount": [], "gas_limit": "200000"},
                },
                "signatures": [],
            },
            "mode": "BROADCAST_MODE_SYNC",
        }

        response = await self._post(endpoint, tx_body)
        tx_response = response.get("tx_response", {})

        if tx_response.get("code", 0) != 0:
            raise ValueError(
                f"TX broadcast failed: {tx_response.get('raw_log', 'unknown error')}"
            )

        return tx_response.get("txhash", "")

    async def _query_task_result(self, task_id: str) -> Optional[IBCResult]:
        """Query HSI Chain for the result of a submitted IBC task."""
        try:
            response = await self._query(f"/hsi/gonka/task/{task_id}")
            task_data = response.get("task")
            if not task_data or task_data.get("status") == "pending":
                return None

            return IBCResult(
                task_id=task_id,
                success=task_data.get("status") == "completed",
                result_hash=task_data.get("result_hash", ""),
                gnk_spent=int(task_data.get("gnk_spent", 0)),
                block_height=int(task_data.get("block_height", 0)),
                error=task_data.get("error"),
            )
        except Exception:
            return None

    async def _query(self, path: str) -> dict:
        """GET request to HSI Chain REST API."""
        import asyncio
        url = self.chain_url + path
        req = Request(url, headers={"Accept": "application/json"})
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: self._sync_get(req))

    async def _post(self, url: str, payload: dict) -> dict:
        import asyncio
        body = json.dumps(payload).encode()
        req = Request(
            url, data=body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: self._sync_post_req(req))

    def _sync_get(self, req: Request) -> dict:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())

    def _sync_post_req(self, req: Request) -> dict:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())


# ── Fund Manager ──────────────────────────────────────────────────────────────

class HSIFundManager:
    """
    Manages the HSI Fund that pays for all AI tasks on Gonka.

    Fund sources:
      - 1% of all reputation transactions on HSI Chain
      - 20% of Gonka inference revenue (per Gonka's model)
      - Community governance top-ups

    This manager monitors fund health and alerts if balance is low.
    """

    CRITICAL_BALANCE_GNK = 10_000    # Alert threshold
    DAILY_TOPUP_PROPOSAL_GNK = 100_000

    def __init__(self, bridge: IBCBridge):
        self.bridge = bridge

    async def check_health(self) -> dict:
        """Check fund health and return status report."""
        status = await self.bridge.get_fund_status()

        health = "healthy"
        alerts = []

        if status.available_gnk < self.CRITICAL_BALANCE_GNK:
            health = "critical"
            alerts.append(
                f"HSI Fund critically low: {status.available_gnk} GNK remaining. "
                f"Submit governance proposal to top up."
            )
        elif status.estimated_days_remaining < 7:
            health = "warning"
            alerts.append(
                f"HSI Fund has ~{status.estimated_days_remaining:.1f} days remaining. "
                f"Consider governance top-up proposal."
            )

        return {
            "health": health,
            "balance_gnk": status.balance_gnk,
            "available_gnk": status.available_gnk,
            "days_remaining": round(status.estimated_days_remaining, 1),
            "tasks_today": status.total_tasks_today,
            "alerts": alerts,
        }
