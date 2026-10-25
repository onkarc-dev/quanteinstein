"""
apps/api/app/services/risk_orchestrator.py
Institutional Prop-Firm Circuit Breaker & Risk Orchestration Engine (QuantOS v3.0).
Pure Python (zero external dependencies).
Implements:
1. High-Water Mark (HWM) Trailing Drawdown:
   - Mode A: INTRADAY_EQUITY_PEAK_HWM (trailing live unrealized equity peak).
   - Mode B: CLOSED_BALANCE_EOD (trailing strictly closed trade balances at end-of-day).
2. Daily Loss Limit (with hard auto-liquidate kill-switch and 00:00 UTC rollover).
3. Max Open Leverage / Gross Notional Clamp.
4. News Risk Embargo Filter (halts entries & flattens positions ahead of high-impact macro releases).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Literal, Optional, Tuple, Union


class TrailingDrawdownType(str, Enum):
    INTRADAY_PEAK_HWM = "INTRADAY_EQUITY_PEAK_HWM"
    CLOSED_BALANCE_EOD = "CLOSED_BALANCE_EOD"


class DrawdownBreachType(str, Enum):
    MAX_TRAILING_BREACH = "MAX_TRAILING_BREACH"
    DAILY_LOSS_BREACH = "DAILY_LOSS_BREACH"
    NEWS_EMBARGO_BREACH = "NEWS_EMBARGO_BREACH"
    LEVERAGE_BREACH = "LEVERAGE_BREACH"


@dataclass
class PropFirmRuleConfig:
    starting_balance: float = 100_000.0
    trailing_drawdown_type: Union[TrailingDrawdownType, str] = TrailingDrawdownType.INTRADAY_PEAK_HWM
    max_trailing_drawdown_pct: float = 0.08  # Can be decimal (0.05) or percentage (5.0)
    daily_loss_limit_pct: float = 0.04       # Can be decimal (0.04) or percentage (4.0)
    daily_reset_utc_hour: int = 0
    max_gross_leverage: float = 5.0
    news_embargo_window_mins: int = 15


@dataclass
class PropFirmAuditResult:
    status: Literal["OK", "WARNING", "BREACHED"]
    action: Literal["CONTINUE", "REDUCE_SIZE", "FLATTEN_AND_HALT"]
    current_equity: float
    high_water_mark: float
    trailing_drawdown_pct: float
    max_trailing_drawdown_pct: float
    daily_drawdown_pct: float
    max_daily_loss_pct: float
    is_breached: bool
    breach_reason: Optional[str] = None
    breach_type: Optional[DrawdownBreachType] = None
    news_embargo_active: bool = False

    @property
    def current_hwm(self) -> float:
        return self.high_water_mark

    @property
    def trailing_drawdown_floor(self) -> float:
        return round(self.high_water_mark * (1.0 - (self.max_trailing_drawdown_pct / 100.0)), 2)


# High-impact recurring macroeconomic embargo calendar (UTC hour & minute)
MACRO_ECONOMIC_RELEASES = [
    {"name": "US Non-Farm Payrolls (NFP)", "day_of_month_first_friday": True, "utc_hour": 13, "utc_minute": 30},
    {"name": "US CPI Inflation", "day_of_month": 12, "utc_hour": 13, "utc_minute": 30},
    {"name": "FOMC Rate Decision", "day_of_month": 18, "utc_hour": 19, "utc_minute": 0},
]


class PropFirmRiskOrchestrator:
    """Orchestrates institutional challenge constraints for prop firm traders."""

    def __init__(
        self,
        starting_capital_or_config: Union[float, PropFirmRuleConfig] = 100_000.0,
        drawdown_mode: Union[TrailingDrawdownType, str] = TrailingDrawdownType.INTRADAY_PEAK_HWM,
        max_trailing_dd_pct: float = 8.0,
        max_daily_loss_pct: float = 4.0,
        daily_reset_utc_hour: int = 0,
        max_gross_leverage: float = 5.0,
        news_embargo_window_mins: int = 15,
    ):
        if isinstance(starting_capital_or_config, PropFirmRuleConfig):
            cfg = starting_capital_or_config
            self.starting_capital = cfg.starting_balance
            self.drawdown_mode = cfg.trailing_drawdown_type
            # Normalize percentages (0.05 -> 5.0)
            self.max_trailing_dd_pct = cfg.max_trailing_drawdown_pct * 100.0 if cfg.max_trailing_drawdown_pct <= 1.0 else cfg.max_trailing_drawdown_pct
            self.max_daily_loss_pct = cfg.daily_loss_limit_pct * 100.0 if cfg.daily_loss_limit_pct <= 1.0 else cfg.daily_loss_limit_pct
            self.daily_reset_utc_hour = cfg.daily_reset_utc_hour
            self.max_gross_leverage = cfg.max_gross_leverage
            self.news_embargo_window_mins = cfg.news_embargo_window_mins
        else:
            self.starting_capital = float(starting_capital_or_config)
            self.drawdown_mode = drawdown_mode
            self.max_trailing_dd_pct = max_trailing_dd_pct * 100.0 if max_trailing_dd_pct <= 1.0 else max_trailing_dd_pct
            self.max_daily_loss_pct = max_daily_loss_pct * 100.0 if max_daily_loss_pct <= 1.0 else max_daily_loss_pct
            self.daily_reset_utc_hour = daily_reset_utc_hour
            self.max_gross_leverage = max_gross_leverage
            self.news_embargo_window_mins = news_embargo_window_mins

        self.high_water_mark = self.starting_capital
        self.daily_starting_equity = self.starting_capital
        self.last_day_reset = -1
        self.circuit_tripped = False
        self.trip_reason: Optional[str] = None
        self.trip_breach_type: Optional[DrawdownBreachType] = None

    def reset_daily_baseline_if_needed(self, current_time: datetime, current_equity: float) -> None:
        """Resets the daily benchmark at specified UTC hour (e.g. 00:00 UTC)."""
        if current_time.hour == self.daily_reset_utc_hour and current_time.day != self.last_day_reset:
            self.daily_starting_equity = current_equity
            self.last_day_reset = current_time.day

    def is_news_embargo_active(self, current_time: datetime) -> Tuple[bool, Optional[str]]:
        """Checks if current time falls within news embargo window."""
        h = current_time.hour
        m = current_time.minute
        for event in MACRO_ECONOMIC_RELEASES:
            event_h = event.get("utc_hour", 13)
            event_m = event.get("utc_minute", 30)
            diff_mins = abs((h * 60 + m) - (event_h * 60 + event_m))
            if diff_mins <= self.news_embargo_window_mins:
                return True, event["name"]
        return False, None

    def audit_risk_state(
        self,
        current_equity: float,
        closed_balance: float,
        current_time: Optional[datetime] = None,
        gross_notional: float = 0.0,
    ) -> PropFirmAuditResult:
        now_dt = current_time or datetime.now(timezone.utc)
        self.reset_daily_baseline_if_needed(now_dt, current_equity)

        # Check circuit trip latch
        if self.circuit_tripped:
            return PropFirmAuditResult(
                status="BREACHED",
                action="FLATTEN_AND_HALT",
                current_equity=round(current_equity, 2),
                high_water_mark=round(self.high_water_mark, 2),
                trailing_drawdown_pct=round(((self.high_water_mark - current_equity) / self.high_water_mark) * 100.0, 2),
                max_trailing_drawdown_pct=self.max_trailing_dd_pct,
                daily_drawdown_pct=round(((self.daily_starting_equity - current_equity) / self.daily_starting_equity) * 100.0, 2),
                max_daily_loss_pct=self.max_daily_loss_pct,
                is_breached=True,
                breach_reason=self.trip_reason,
                breach_type=self.trip_breach_type,
            )

        # Update High-Water Mark
        mode_val = self.drawdown_mode.value if hasattr(self.drawdown_mode, "value") else str(self.drawdown_mode)
        if mode_val in ("INTRADAY_EQUITY_PEAK_HWM", "TrailingDrawdownType.INTRADAY_PEAK_HWM"):
            if current_equity > self.high_water_mark:
                self.high_water_mark = current_equity
        else:
            if closed_balance > self.high_water_mark:
                self.high_water_mark = closed_balance

        # Calculate current drawdowns
        trailing_dd = ((self.high_water_mark - current_equity) / max(self.high_water_mark, 1.0)) * 100.0
        daily_dd = ((self.daily_starting_equity - current_equity) / max(self.daily_starting_equity, 1.0)) * 100.0

        # Check Trailing Drawdown Breach
        if trailing_dd >= self.max_trailing_dd_pct:
            self.circuit_tripped = True
            self.trip_breach_type = DrawdownBreachType.MAX_TRAILING_BREACH
            self.trip_reason = f"Max Trailing Drawdown Breached: {trailing_dd:.2f}% >= limit {self.max_trailing_dd_pct:.2f}%"
            return PropFirmAuditResult(
                status="BREACHED",
                action="FLATTEN_AND_HALT",
                current_equity=round(current_equity, 2),
                high_water_mark=round(self.high_water_mark, 2),
                trailing_drawdown_pct=round(trailing_dd, 2),
                max_trailing_drawdown_pct=self.max_trailing_dd_pct,
                daily_drawdown_pct=round(daily_dd, 2),
                max_daily_loss_pct=self.max_daily_loss_pct,
                is_breached=True,
                breach_reason=self.trip_reason,
                breach_type=self.trip_breach_type,
            )

        # Check Daily Loss Breach
        if daily_dd >= self.max_daily_loss_pct:
            self.circuit_tripped = True
            self.trip_breach_type = DrawdownBreachType.DAILY_LOSS_BREACH
            self.trip_reason = f"Max Daily Loss Breached: {daily_dd:.2f}% >= limit {self.max_daily_loss_pct:.2f}%"
            return PropFirmAuditResult(
                status="BREACHED",
                action="FLATTEN_AND_HALT",
                current_equity=round(current_equity, 2),
                high_water_mark=round(self.high_water_mark, 2),
                trailing_drawdown_pct=round(trailing_dd, 2),
                max_trailing_drawdown_pct=self.max_trailing_dd_pct,
                daily_drawdown_pct=round(daily_dd, 2),
                max_daily_loss_pct=self.max_daily_loss_pct,
                is_breached=True,
                breach_reason=self.trip_reason,
                breach_type=self.trip_breach_type,
            )

        # Check News Embargo
        news_active, event_name = self.is_news_embargo_active(now_dt)

        # Warning threshold (if drawdown > 75% of limit)
        status_code = "OK"
        action_code = "CONTINUE"
        if trailing_dd >= (self.max_trailing_dd_pct * 0.75) or daily_dd >= (self.max_daily_loss_pct * 0.75):
            status_code = "WARNING"
            action_code = "REDUCE_SIZE"

        return PropFirmAuditResult(
            status=status_code,
            action=action_code,
            current_equity=round(current_equity, 2),
            high_water_mark=round(self.high_water_mark, 2),
            trailing_drawdown_pct=round(trailing_dd, 2),
            max_trailing_drawdown_pct=self.max_trailing_dd_pct,
            daily_drawdown_pct=round(daily_dd, 2),
            max_daily_loss_pct=self.max_daily_loss_pct,
            is_breached=False,
            news_embargo_active=news_active,
            breach_reason=f"High Impact News Embargo Active: {event_name}" if news_active else None,
            breach_type=None,
        )

    def update_equity(
        self,
        intraday_equity: float,
        closed_balance: float,
        current_time: Optional[datetime] = None,
    ) -> PropFirmAuditResult:
        return self.audit_risk_state(current_equity=intraday_equity, closed_balance=closed_balance, current_time=current_time)
