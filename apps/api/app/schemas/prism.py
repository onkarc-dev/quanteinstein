from pydantic import BaseModel, Field
from typing import List, Literal, Optional

class StopLossConfig(BaseModel):
    type: str = "atr_or_structure"
    atr_multiplier: float = 0.75
    structure_buffer_pct: float = 0.25

class TargetConfig(BaseModel):
    target1_R: float = 1.5
    target2_R: float = 2.5

class RiskConfig(BaseModel):
    risk_per_trade_pct: float = 1.0
    max_daily_loss_pct: float = 3.0
    max_open_positions: int = 5
    max_symbol_notional: float = 10000

class ReentryConfig(BaseModel):
    enabled: bool = True
    max_reentries: int = 1
    cooldown_bars: int = 10

class TrendFilterConfig(BaseModel):
    use_trend_filter: bool = False
    higher_timeframe: str = "5m"
    higher_timeframe_seconds: int = 300
    fast_ema: int = 20
    slow_ema: int = 50

class RsiFilterConfig(BaseModel):
    enabled: bool = False
    period: int = 14
    overbought: float = 70.0
    oversold: float = 30.0
    condition: str = "filter_extremes"

class MacdFilterConfig(BaseModel):
    enabled: bool = False
    fast_period: int = 12
    slow_period: int = 26
    signal_period: int = 9
    condition: str = "histogram_momentum"

class TradeManagementConfig(BaseModel):
    breakeven_stop: bool = True
    partial_tp_pct: float = 50.0
    trailing_stop: bool = False
    trailing_atr_multiplier: float = 1.5

class ExecutionFrictionConfig(BaseModel):
    fee_pct: float = 0.04
    slippage_pct: float = 0.01

class TimingFilterConfig(BaseModel):
    trading_hours: str = "all_day"
    skip_weekends: bool = False
    rvol_filter: bool = False
    rvol_threshold: float = 1.5

class StrategyRules(BaseModel):
    name: str = "QuantOS Breakout Retest"
    direction: str = "both"
    breakout_lookback: int = 20
    retest_tolerance_pct: float = 0.001
    min_setup_score: float = 6.5
    max_retest_bars: int = 30
    signal_cooldown_bars: int = 5
    ttl_bars: int = 40
    min_close_position: float = 0.50
    stop_loss: StopLossConfig = Field(default_factory=StopLossConfig)
    targets: TargetConfig = Field(default_factory=TargetConfig)
    risk: RiskConfig = Field(default_factory=RiskConfig)
    reentry: ReentryConfig = Field(default_factory=ReentryConfig)
    trend_filter: TrendFilterConfig = Field(default_factory=TrendFilterConfig)
    rsi_filter: RsiFilterConfig = Field(default_factory=RsiFilterConfig)
    macd_filter: MacdFilterConfig = Field(default_factory=MacdFilterConfig)
    trade_management: TradeManagementConfig = Field(default_factory=TradeManagementConfig)
    execution_friction: ExecutionFrictionConfig = Field(default_factory=ExecutionFrictionConfig)
    timing_filter: TimingFilterConfig = Field(default_factory=TimingFilterConfig)

class StrategyCreate(BaseModel):
    # User-defined strategy code shown in UI/live session; DB id remains UUID for safety.
    user_strategy_id: Optional[str] = None
    name: str
    symbols: List[str] = ["BTCUSDT"]
    timeframe: str = "1m"
    bar_seconds: int = 60
    strategy: StrategyRules = Field(default_factory=StrategyRules)

class JobCreate(BaseModel):
    user_id: str = "demo_user"
    strategy_id: str
    mode: Literal["backtest", "paper"] = "backtest"
    symbols: List[str]
    timeframe: str = "1m"
    bar_seconds: int = 60
    strategy: StrategyRules
    input_data: str = "data/sample_market_data.csv"
