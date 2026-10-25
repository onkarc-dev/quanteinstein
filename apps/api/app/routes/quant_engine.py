"""
apps/api/app/routes/quant_engine.py
Institutional Quant Engine API Routes (QuantOS v3.0).
Exposes dynamic universe screening, risk parity allocation, AST rule evaluation,
microstructure friction models, prop-firm circuit breakers, and Monte Carlo stress testing.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException

from app.deps import current_user
from app.services.quant_universe import UniverseFilterEngine, CrossSectionalAllocationEngine
from app.services.ast_evaluator import ASTConditionEvaluator
from app.services.friction_engine import MicrostructureExecutionEngine
from app.services.risk_orchestrator import PropFirmRiskOrchestrator
from app.services.monte_carlo_suite import MonteCarloStressTester

router = APIRouter()


@router.post("/universe/screen")
def screen_universe(payload: Dict[str, Any] = Body(default={})):
    """Dynamic universe screening by ADV, realized volatility, and sector/asset class."""
    asset_class = payload.get("asset_class")
    min_adv_usd = float(payload.get("min_adv_usd", 1_000_000.0))
    min_vol = float(payload.get("min_realized_vol_20d", 0.0))
    max_vol = float(payload.get("max_realized_vol_20d", 10.0))
    top_n = payload.get("top_n_by_adv")
    if top_n is not None:
        top_n = int(top_n)
    sectors = payload.get("sectors")

    matched = UniverseFilterEngine.filter_universe(
        asset_class=asset_class,
        min_adv_usd=min_adv_usd,
        min_realized_vol_20d=min_vol,
        max_realized_vol_20d=max_vol,
        top_n_by_adv=top_n,
        sectors=sectors,
    )
    return {
        "ok": True,
        "count": len(matched),
        "universe": matched,
    }


@router.post("/allocation/calculate")
def calculate_allocation(payload: Dict[str, Any] = Body(default={})):
    """Computes portfolio weights: Equal Weight, Risk Parity, or Fixed Unit Sizing."""
    method = str(payload.get("method") or payload.get("mode") or "INVERSE_VOLATILITY").upper()
    symbols = payload.get("symbols") or ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    max_weight = float(payload.get("max_asset_weight_pct", 0.35))

    if method in ("EQUAL_WEIGHT", "EQUAL"):
        weights = CrossSectionalAllocationEngine.calculate_equal_weight(symbols, max_asset_weight_pct=max_weight)
    elif method in ("INVERSE_VOLATILITY", "RISK_PARITY"):
        vol_map = payload.get("volatility_map") or payload.get("volatilities") or {}
        if not vol_map:
            vol_map = {s: 0.60 for s in symbols}
        weights = CrossSectionalAllocationEngine.calculate_risk_parity(vol_map, max_asset_weight_pct=max_weight)
    else:
        equity = float(payload.get("account_equity", 100_000.0))
        risk_pct = float(payload.get("risk_per_trade_pct", 1.0))
        weights = CrossSectionalAllocationEngine.calculate_fixed_unit_sizing(
            symbols, account_equity=equity, risk_per_trade_pct=risk_pct
        )

    # Check drift if current weights provided
    drift_result = None
    if isinstance(payload.get("current_weights"), dict) and isinstance(weights, dict):
        drift_threshold = float(payload.get("drift_threshold_pct", 0.05))
        drift_result = CrossSectionalAllocationEngine.check_drift_rebalance_trigger(
            target_weights=weights if method not in ("FIXED_UNIT_RISK", "FIXED_UNIT") else {},
            current_weights=payload["current_weights"],
            threshold_pct=drift_threshold,
        )

    return {
        "ok": True,
        "method": method,
        "allocations": weights,
        "weights": weights,
        "drift_analysis": drift_result,
    }


@router.get("/friction/contract-spec/{symbol}")
def get_contract_spec_by_symbol(symbol: str):
    """Returns instrument specifications via GET."""
    spec = MicrostructureExecutionEngine.get_contract_spec(symbol)
    return {
        "symbol": spec.symbol,
        "asset_class": spec.asset_class,
        "tick_size": spec.tick_size,
        "tick_value": spec.tick_value,
        "contract_multiplier": spec.contract_multiplier,
        "standard_lot_units": spec.standard_lot_units,
        "maker_fee_rate": spec.maker_fee_rate,
        "taker_fee_rate": spec.taker_fee_rate,
        "base_spread": spec.base_spread,
    }


@router.post("/friction/contract-spec")
def get_contract_spec(payload: Dict[str, Any] = Body(default={})):
    """Returns instrument specifications (Futures ticks, Forex pips, Crypto fees)."""
    symbol = str(payload.get("symbol", "BTCUSDT")).upper()
    return get_contract_spec_by_symbol(symbol)


@router.post("/prop-firm/audit")
def audit_prop_firm_risk(payload: Dict[str, Any] = Body(default={})):
    """Audits intraday or EOD trailing drawdown against prop-firm rules."""
    starting_cap = float(payload.get("starting_capital", 100_000.0))
    current_equity = float(payload.get("current_equity", starting_cap))
    closed_balance = float(payload.get("closed_balance", current_equity))
    mode = payload.get("drawdown_mode", "INTRADAY_EQUITY_PEAK_HWM")
    max_trailing_dd = float(payload.get("max_trailing_dd_pct", 8.0))
    max_daily_loss = float(payload.get("max_daily_loss_pct", 4.0))

    orchestrator = PropFirmRiskOrchestrator(
        starting_capital_or_config=starting_cap,
        drawdown_mode=mode,
        max_trailing_dd_pct=max_trailing_dd,
        max_daily_loss_pct=max_daily_loss,
    )
    result = orchestrator.audit_risk_state(current_equity=current_equity, closed_balance=closed_balance)
    return {
        "ok": True,
        "audit": result.__dict__,
    }


@router.post("/monte-carlo/run")
def run_monte_carlo(payload: Dict[str, Any] = Body(default={})):
    """Runs stationary block bootstrap stress testing on strategy return distribution."""
    returns = payload.get("returns") or []
    iterations = int(payload.get("iterations") or payload.get("num_simulations") or 2000)
    starting_equity = float(payload.get("starting_equity") or payload.get("initial_balance") or 100_000.0)
    prop_limit_pct = float(payload.get("prop_limit_pct") or (payload.get("max_allowed_drawdown_pct", 0.08) * (100.0 if float(payload.get("max_allowed_drawdown_pct", 0.08)) <= 1.0 else 1.0)))
    block_size = int(payload.get("expected_block_size", 10))

    report = MonteCarloStressTester.run_stationary_bootstrap(
        returns=returns,
        iterations=iterations,
        expected_block_size=block_size,
        starting_equity=starting_equity,
        prop_limit_pct=prop_limit_pct,
    )
    return {
        "ok": True,
        "total_simulations": iterations,
        "starting_equity": starting_equity,
        "prop_firm_breach_probability": report.get("prob_breaching_prop_limit_pct", 0.0) / 100.0,
        "percentiles": {
            "p5": report.get("p5_final_equity"),
            "p50": report.get("median_max_drawdown_pct"),
            "p95": report.get("p95_max_drawdown_pct"),
            "p99": report.get("p99_max_drawdown_pct"),
        },
        "report": report,
    }

