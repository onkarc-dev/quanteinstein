"""SEC Rule 15c3-5 (Market Access Rule) & SEC Reg SHO Rule 203(b)(1) Pre-Trade Risk Gateway.

Features:
- Single-order notional caps to prevent algorithmic fat-finger market disruption.
- Cumulative daily gross notional ceilings across all trading pairs.
- Runaway algorithm rate-limiting (sliding window max orders per second).
- Organizational emergency "Kill Switch" flag for immediate DMA order halts.
- Real-time price collar checks comparing limit orders to prevailing Best Bid/Offer (BBO).
- Thread-safe BorrowLocateManager enforcing SEC Reg SHO Rule 203(b)(1) borrow locate verification for short sales.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Tuple, List


@dataclass
class PreTradeRiskConfig:
    max_order_notional: float = 1_000_000.0        # $1,000,000 max single order cap
    max_daily_notional: float = 25_000_000.0       # $25,000,000 cumulative daily ceiling
    price_collar_pct: float = 0.03                 # 3.0% maximum deviation from prevailing BBO
    max_orders_per_second: int = 100               # Sliding-window rate limit against runaway algorithms
    max_intraday_drawdown_pct: float = 0.05        # 5.0% maximum intraday drawdown threshold
    kill_switch_active: bool = False               # Emergency firm-wide execution kill switch
    require_reg_sho_locates: bool = True           # Strictly enforce SEC Reg SHO short sale borrow locates


@dataclass
class BorrowLocateRecord:
    locate_id: str
    symbol: str
    available_qty: float
    allocated_qty: float = 0.0
    borrow_rate_bps: float = 25.0                  # Cost to borrow in basis points
    prime_broker: str = "GS_GSET"
    expires_at: float = field(default_factory=lambda: time.time() + 86400) # Valid 24 hours
    is_hard_to_borrow: bool = False
    created_at: float = field(default_factory=time.time)


class BorrowLocateManager:
    """Thread-safe borrow locate repository enforcing SEC Reg SHO Rule 203(b)(1).
    Before executing a short sale (Tag 54=5), the broker-dealer/fund must have reasonable grounds
    to believe that the security can be borrowed and delivered on settlement date.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._locates: Dict[str, Dict[str, BorrowLocateRecord]] = {}
        self._seed_default_locates()

    def _seed_default_locates(self):
        defaults = [
            ("AAPL", 500_000.0, 15.0, False),
            ("MSFT", 400_000.0, 15.0, False),
            ("NVDA", 250_000.0, 35.0, False),
            ("TSLA", 150_000.0, 65.0, True),
            ("SPY", 2_000_000.0, 8.0, False),
            ("QQQ", 1_500_000.0, 10.0, False),
            ("BTCUSDT", 1_000.0, 45.0, False),
            ("ETHUSDT", 10_000.0, 35.0, False),
            ("EURUSD", 10_000_000.0, 5.0, False),
        ]
        for sym, qty, rate, htb in defaults:
            lid = f"LOC-PB-{sym}"
            rec = BorrowLocateRecord(
                locate_id=lid,
                symbol=sym,
                available_qty=qty,
                borrow_rate_bps=rate,
                is_hard_to_borrow=htb,
            )
            for org in ("default_org", "tier1alpha_org", "inst_capital"):
                self._locates.setdefault(org, {})[lid] = BorrowLocateRecord(
                    locate_id=lid,
                    symbol=sym,
                    available_qty=qty,
                    borrow_rate_bps=rate,
                    is_hard_to_borrow=htb,
                )

    def add_locate(
        self,
        org_id: str,
        symbol: str,
        quantity: float,
        locate_id: Optional[str] = None,
        borrow_rate_bps: float = 25.0,
        prime_broker: str = "GS_GSET",
        is_hard_to_borrow: bool = False,
    ) -> BorrowLocateRecord:
        with self._lock:
            lid = locate_id or f"LOC-{uuid.uuid4().hex[:8].upper()}"
            rec = BorrowLocateRecord(
                locate_id=lid,
                symbol=symbol.upper(),
                available_qty=float(quantity),
                borrow_rate_bps=borrow_rate_bps,
                prime_broker=prime_broker,
                is_hard_to_borrow=is_hard_to_borrow,
            )
            self._locates.setdefault(org_id, {})[lid] = rec
            return rec

    def list_locates(self, org_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            pool = self._locates.get(org_id) or self._locates.get("default_org") or {}
            out = []
            for rec in pool.values():
                out.append({
                    "locate_id": rec.locate_id,
                    "symbol": rec.symbol,
                    "available_qty": rec.available_qty,
                    "allocated_qty": rec.allocated_qty,
                    "borrow_rate_bps": rec.borrow_rate_bps,
                    "prime_broker": rec.prime_broker,
                    "is_hard_to_borrow": rec.is_hard_to_borrow,
                    "expires_in_sec": max(0, int(rec.expires_at - time.time())),
                })
            return out

    def verify_and_allocate_locate(
        self,
        org_id: str,
        symbol: str,
        quantity: float,
        locate_id: Optional[str] = None,
        is_short_exempt: bool = False,
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        if is_short_exempt:
            return True, None, {"locate_id": "EXEMPT", "borrow_rate_bps": 0.0}

        sym = symbol.strip().upper()
        with self._lock:
            org_pool = self._locates.get(org_id)
            if not org_pool:
                org_pool = self._locates.get("default_org") or {}

            # SEC Reg SHO Rule 203(b)(1): Require explicit verified borrow locate ID
            if not locate_id:
                return False, f"SEC_REG_SHO_REJECT: SEC Rule 203(b)(1) Violation: Short sale rejected. Mandatory verified Borrow Locate ID is required for short sales on '{sym}'.", None

            # Case A: Specific locate_id provided
            rec = org_pool.get(locate_id)
            if not rec:
                return False, f"SEC_REG_SHO_REJECT: Specified Borrow Locate ID '{locate_id}' not found in prime brokerage inventory.", None
            if rec.symbol != sym:
                return False, f"SEC_REG_SHO_REJECT: Locate ID '{locate_id}' is for symbol '{rec.symbol}', not requested '{sym}'.", None
            if rec.available_qty < quantity:
                return False, f"SEC_REG_SHO_REJECT: Locate '{locate_id}' has insufficient borrow volume ({rec.available_qty:.2f} available < {quantity:.2f} requested).", None
            if time.time() > rec.expires_at:
                return False, f"SEC_REG_SHO_REJECT: Locate '{locate_id}' has expired.", None

            rec.available_qty -= quantity
            rec.allocated_qty += quantity
            return True, None, {
                "locate_id": rec.locate_id,
                "borrow_rate_bps": rec.borrow_rate_bps,
                "prime_broker": rec.prime_broker,
                "is_hard_to_borrow": rec.is_hard_to_borrow,
            }


class InstitutionalRiskGateway:
    def __init__(self):
        self._configs: Dict[str, PreTradeRiskConfig] = {}
        self._daily_notional: Dict[str, float] = {}
        self._order_timestamps: Dict[str, List[float]] = {}
        self._peak_equity: Dict[str, float] = {}
        self._current_equity: Dict[str, float] = {}
        self.borrow_locates = BorrowLocateManager()

    def get_or_create_config(self, org_id: str) -> PreTradeRiskConfig:
        if org_id not in self._configs:
            self._configs[org_id] = PreTradeRiskConfig()
        return self._configs[org_id]

    def set_config(self, org_id: str, config: PreTradeRiskConfig) -> None:
        self._configs[org_id] = config

    def set_kill_switch(self, org_id: str, state: bool) -> None:
        cfg = self.get_or_create_config(org_id)
        cfg.kill_switch_active = state

    def is_kill_switch_active(self, org_id: str) -> bool:
        return self.get_or_create_config(org_id).kill_switch_active

    def get_cumulative_daily_notional(self, org_id: str) -> float:
        return self._daily_notional.get(org_id, 0.0)

    def reset_daily_metrics(self, org_id: Optional[str] = None) -> None:
        if org_id:
            self._daily_notional[org_id] = 0.0
            self._order_timestamps[org_id] = []
        else:
            self._daily_notional.clear()
            self._order_timestamps.clear()

    def validate_order(
        self,
        org_id: str,
        symbol: str,
        side: str,
        qty: float,
        price: float,
        bbo_price: float,
        order_type: str = "LIMIT",
        borrow_locate_id: Optional[str] = None,
        is_short_exempt: bool = False,
    ) -> Tuple[bool, Optional[str], Dict[str, Any]]:
        """Validates incoming enterprise orders against SEC Rule 15c3-5 and SEC Reg SHO Rule 203:
        
        1. Emergency Kill Switch verification.
        2. Runaway algorithm sliding window rate check (orders per second).
        3. Single-order notional cap check.
        4. Price collar validation against prevailing BBO.
        5. Cumulative daily exposure ceiling check.
        6. SEC Reg SHO Rule 203(b)(1) Borrow Locate ID verification for short sales.
        """
        cfg = self.get_or_create_config(org_id)
        now = time.time()
        norm_side = str(side).upper()

        # Rule 1: Emergency Kill Switch
        if cfg.kill_switch_active:
            return False, "SEC_15C3_REJECT: Hard Kill-Switch is active for this institution.", {}

        # Rule 2: Runaway Algorithm Rate Limiter (sliding 1-second window)
        timestamps = self._order_timestamps.setdefault(org_id, [])
        timestamps = [t for t in timestamps if now - t < 1.0]
        self._order_timestamps[org_id] = timestamps

        if len(timestamps) >= cfg.max_orders_per_second:
            return (
                False,
                f"SEC_15C3_REJECT: Rate limit exceeded ({len(timestamps)} orders/sec >= {cfg.max_orders_per_second} allowed).",
                {},
            )

        # Rule 3: Single Order Notional Cap
        exec_price = price if (price > 0.0) else bbo_price
        notional = float(qty) * exec_price
        if notional > cfg.max_order_notional:
            return (
                False,
                f"SEC_15C3_REJECT: Order notional ${notional:,.2f} exceeds single order limit ${cfg.max_order_notional:,.2f}.",
                {},
            )

        # Rule 4: Price Collar Validation (Fat-Finger Guard against BBO)
        if str(order_type).upper() == "LIMIT" and bbo_price > 0.0:
            deviation = abs(price - bbo_price) / bbo_price
            if deviation > cfg.price_collar_pct:
                return (
                    False,
                    f"SEC_15C3_REJECT: Price collar breach! Limit ${price:,.2f} deviates {deviation*100:.2f}% from BBO ${bbo_price:,.2f} (Max allowed {cfg.price_collar_pct*100:.1f}%).",
                    {},
                )

        # Rule 5: Cumulative Daily Notional Ceiling
        current_daily = self._daily_notional.get(org_id, 0.0)
        if current_daily + notional > cfg.max_daily_notional:
            return (
                False,
                f"SEC_15C3_REJECT: Daily notional ceiling breached! Projected cumulative ${current_daily + notional:,.2f} exceeds limit ${cfg.max_daily_notional:,.2f}.",
                {},
            )

        # Rule 6: SEC Reg SHO Rule 203(b)(1) Short Sale Borrow Locate Verification
        locate_info = None
        if norm_side in ("SHORT_SELL", "SHORT", "5") and cfg.require_reg_sho_locates:
            verified, reason, locate_info = self.borrow_locates.verify_and_allocate_locate(
                org_id=org_id,
                symbol=symbol,
                quantity=float(qty),
                locate_id=borrow_locate_id,
                is_short_exempt=is_short_exempt,
            )
            if not verified:
                return False, reason, {}

        # Approve and update state
        timestamps.append(now)
        self._daily_notional[org_id] = current_daily + notional

        meta = {
            "approved_notional": notional,
            "cumulative_daily_notional": self._daily_notional[org_id],
            "price_collar_dev_pct": (abs(price - bbo_price) / bbo_price * 100.0) if (bbo_price > 0) else 0.0,
            "orders_in_last_sec": len(timestamps),
            "borrow_locate": locate_info,
        }
        return True, None, meta


# Global institutional risk gateway instance
risk_gateway = InstitutionalRiskGateway()
