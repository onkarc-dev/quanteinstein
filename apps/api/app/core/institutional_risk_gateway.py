"""
SEC Rule 15c3-5 (Market Access Rule) & MiFID II Pre-Trade Risk Gateway.
Enforces hard, non-bypassable risk validation before orders reach the broker or FIX wire.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Any, Optional, Tuple


@dataclass
class PreTradeRiskConfig:
    max_order_notional: float = 1_000_000.0        # $1M max per order
    max_daily_notional: float = 25_000_000.0       # $25M max cumulative daily exposure
    price_collar_pct: float = 0.03                 # 3.0% max price deviation from BBO
    max_orders_per_second: int = 100               # Rate limiter to prevent runaway algo loops
    max_intraday_drawdown_pct: float = 0.05        # 5.0% max intraday drawdown
    kill_switch_active: bool = False               # Emergency firm-wide kill switch


class InstitutionalRiskGateway:
    def __init__(self):
        self._configs: Dict[str, PreTradeRiskConfig] = {}
        self._daily_notional: Dict[str, float] = {}
        self._order_timestamps: Dict[str, list[float]] = {}
        self._peak_equity: Dict[str, float] = {}
        self._current_equity: Dict[str, float] = {}

    def get_or_create_config(self, org_id: str) -> PreTradeRiskConfig:
        if org_id not in self._configs:
            self._configs[org_id] = PreTradeRiskConfig()
        return self._configs[org_id]

    def set_kill_switch(self, org_id: str, state: bool) -> None:
        cfg = self.get_or_create_config(org_id)
        cfg.kill_switch_active = state

    def validate_order(
        self,
        org_id: str,
        symbol: str,
        side: str,
        qty: float,
        price: float,
        bbo_price: float,
        order_type: str = "LIMIT",
    ) -> Tuple[bool, Optional[str], Dict[str, Any]]:
        """
        Validates order against SEC Rule 15c3-5 checks:
        1. Emergency Kill Switch check
        2. Runaway Algorithm Rate Limiter (orders per second)
        3. Single Order Notional Limit
        4. Price Collar Deviation against BBO
        5. Cumulative Daily Notional Limit
        """
        cfg = self.get_or_create_config(org_id)
        now = time.time()

        # Check 1: Hard Kill-Switch
        if cfg.kill_switch_active:
            return False, "SEC_15C3_REJECT: Hard Kill-Switch is active for this institution.", {}

        # Check 2: Runaway Algorithm Rate Limiting (Token Bucket / Sliding Window)
        timestamps = self._order_timestamps.setdefault(org_id, [])
        timestamps = [t for t in timestamps if now - t < 1.0]
        self._order_timestamps[org_id] = timestamps

        if len(timestamps) >= cfg.max_orders_per_second:
            return False, f"SEC_15C3_REJECT: Rate limit exceeded ({len(timestamps)} orders/sec >= {cfg.max_orders_per_second} allowed).", {}

        # Check 3: Single Order Notional Cap
        notional = qty * (price if price > 0 else bbo_price)
        if notional > cfg.max_order_notional:
            return False, f"SEC_15C3_REJECT: Order notional ${notional:,.2f} exceeds single order limit ${cfg.max_order_notional:,.2f}.", {}

        # Check 4: Price Collar Validation (Fat-Finger Guard against BBO)
        if order_type.upper() == "LIMIT" and bbo_price > 0:
            deviation = abs(price - bbo_price) / bbo_price
            if deviation > cfg.price_collar_pct:
                return False, f"SEC_15C3_REJECT: Price collar breach! Limit ${price:,.2f} deviates {deviation*100:.2f}% from BBO ${bbo_price:,.2f} (Max {cfg.price_collar_pct*100:.1f}%).", {}

        # Check 5: Cumulative Daily Notional Cap
        current_daily = self._daily_notional.get(org_id, 0.0)
        if current_daily + notional > cfg.max_daily_notional:
            return False, f"SEC_15C3_REJECT: Cumulative daily notional ${current_daily + notional:,.2f} exceeds firm ceiling ${cfg.max_daily_notional:,.2f}.", {}

        # Approved: Record consumption
        timestamps.append(now)
        self._daily_notional[org_id] = current_daily + notional

        return True, None, {
            "approved_notional": notional,
            "cumulative_daily_notional": self._daily_notional[org_id],
            "price_collar_deviation_pct": round((abs(price - bbo_price) / bbo_price) * 100, 3) if bbo_price > 0 else 0.0,
            "risk_check_timestamp": now,
        }


# Global institutional risk gateway instance
risk_gateway = InstitutionalRiskGateway()
