from __future__ import annotations

import math
from datetime import datetime
from statistics import mean, median, pstdev
from typing import Any


def _f(value: Any, default: float | None = None) -> float | None:
    try:
        x = float(value)
        return x if math.isfinite(x) else default
    except Exception:
        return default


def _round(value: float | None, digits: int = 6) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def _display_percent(value: float | None, digits: int = 2) -> str:
    rounded = _round(value, digits)
    if rounded is None:
        return "Not enough data"
    text = f"{rounded:.{digits}f}".rstrip("0").rstrip(".")
    return f"{text}%"


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[: len(fmt)], fmt)
        except Exception:
            pass
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


def _r_values(trades: list[dict[str, Any]]) -> list[float]:
    vals: list[float] = []
    for trade in trades:
        raw = trade.get("r_multiple", trade.get("R_multiple", trade.get("r", trade.get("pnl"))))
        val = _f(raw)
        if val is not None:
            vals.append(val)
    return vals


def _equity_stats(r: list[float]) -> dict[str, Any]:
    equity = 0.0
    peak = 0.0
    drawdowns: list[float] = []
    durations: list[int] = []
    active = 0
    for value in r:
        equity += value
        if equity >= peak:
            if active:
                durations.append(active)
            active = 0
            peak = equity
        else:
            active += 1
        drawdowns.append(equity - peak)
    if active:
        durations.append(active)
    negative = [abs(x) for x in drawdowns if x < 0]
    ulcer = math.sqrt(mean([x * x for x in negative])) if negative else 0.0
    return {
        "net_R": equity,
        "max_drawdown_R": min(drawdowns) if drawdowns else None,
        "average_drawdown_R": mean(negative) if negative else 0.0,
        "drawdown_duration_trades": max(durations) if durations else 0,
        "ulcer_index": ulcer,
    }


def _streaks(r: list[float]) -> tuple[int, int]:
    max_wins = max_losses = cur_wins = cur_losses = 0
    for value in r:
        if value > 0:
            cur_wins += 1
            cur_losses = 0
        elif value < 0:
            cur_losses += 1
            cur_wins = 0
        else:
            cur_wins = cur_losses = 0
        max_wins = max(max_wins, cur_wins)
        max_losses = max(max_losses, cur_losses)
    return max_wins, max_losses


def _date_span_days(trades: list[dict[str, Any]], fallback_start: Any = None, fallback_end: Any = None) -> float | None:
    dates = []
    for trade in trades:
        for key in ("entry_time", "timestamp", "opened_at"):
            dt = _parse_dt(trade.get(key))
            if dt:
                dates.append(dt)
                break
        for key in ("exit_time", "closed_at"):
            dt = _parse_dt(trade.get(key))
            if dt:
                dates.append(dt)
                break
    start = _parse_dt(fallback_start)
    end = _parse_dt(fallback_end)
    if start:
        dates.append(start)
    if end:
        dates.append(end)
    if len(dates) < 2:
        return None
    seconds = max((max(dates) - min(dates)).total_seconds(), 0.0)
    return max(seconds / 86400.0, 1.0)


def build_performance_and_robustness(
    trades: list[dict[str, Any]] | None,
    *,
    start_time: Any = None,
    end_time: Any = None,
    bars_processed: int | None = None,
    profit_factor: float | None = None,
    risk_per_trade_pct: float | None = None,
    has_walk_forward: bool = False,
    has_out_of_sample: bool = False,
    parameter_sensitivity: Any = None,
    source_note: str | None = None,
    fee_pct: float | None = None,
    slippage_pct: float | None = None,
) -> dict[str, Any]:
    trades = trades or []
    r = _r_values(trades)
    n = len(r)

    # Friction calculations (fees + slippage in R-multiples)
    effective_risk = risk_per_trade_pct if (risk_per_trade_pct and risk_per_trade_pct > 0) else 1.0
    f_rate = _f(fee_pct, 0.04) or 0.04
    s_rate = _f(slippage_pct, 0.01) or 0.01
    round_trip_friction_pct = (f_rate * 2.0) + (s_rate * 2.0)
    friction_r_per_trade = round_trip_friction_pct / effective_risk
    total_friction_R = friction_r_per_trade * n
    wins = [x for x in r if x > 0]
    losses = [x for x in r if x < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    pf = profit_factor if profit_factor is not None else ((gross_profit / gross_loss) if gross_loss else (None if gross_profit else 0.0))
    avg = mean(r) if r else None
    vol = pstdev(r) if len(r) > 1 else None
    downside_values = [min(0.0, x) for x in r]
    downside = pstdev(downside_values) if len(r) > 1 and any(x < 0 for x in r) else None
    eq = _equity_stats(r)
    max_dd_abs = abs(eq["max_drawdown_R"]) if eq["max_drawdown_R"] is not None else None
    net = eq["net_R"]
    sharpe = (avg / vol * math.sqrt(n)) if avg is not None and vol and n > 1 else None
    sortino = (avg / downside * math.sqrt(n)) if avg is not None and downside and n > 1 else None
    calmar = (net / max_dd_abs) if max_dd_abs and max_dd_abs > 0 else None
    omega = (gross_profit / gross_loss) if gross_loss else None
    recovery = (net / max_dd_abs) if max_dd_abs and max_dd_abs > 0 else None
    max_wins, max_losses = _streaks(r)
    span_days = _date_span_days(trades, start_time, end_time)
    holding = [_f(t.get("holding_bars")) for t in trades if _f(t.get("holding_bars")) is not None]
    real_notionals: list[float] = []
    real_turnover_percentages: list[float] = []
    has_complete_notional_turnover = bool(n)
    for t in trades:
        notional = _f(t.get("notional"))
        if notional is None:
            qty = _f(t.get("qty", t.get("quantity")))
            price = _f(t.get("price", t.get("entry_price")))
            if qty is not None and price is not None:
                notional = abs(qty * price)
        equity = _f(t.get("account_equity", t.get("equity", t.get("starting_equity"))))
        if notional is None or equity is None or equity <= 0:
            has_complete_notional_turnover = False
            continue
        real_notionals.append(abs(notional))
        real_turnover_percentages.append(abs(notional) / equity * 100.0)
    turnover_raw = sum(real_notionals) if has_complete_notional_turnover and real_notionals else None
    turnover_percentage = sum(real_turnover_percentages) if has_complete_notional_turnover and real_turnover_percentages else None
    turnover_proxy_pct = (n * risk_per_trade_pct * 2.0) if n and risk_per_trade_pct is not None and math.isfinite(risk_per_trade_pct) else None
    turnover_explanation = (
        "Real Notional Turnover % uses actual trade notional divided by account equity. "
        "Estimated Turnover Proxy % is a risk-based activity estimate: total trades x risk per trade % x 2. "
        "The proxy is not real notional turnover."
    )
    exposure = (sum(holding) / float(bars_processed)) if holding and bars_processed else None
    exposure_percentage = exposure * 100 if exposure is not None else None
    trades_per_day = (n / span_days) if span_days else None
    warnings: list[str] = []
    if n < 30:
        warnings.append("Too few trades for reliable inference.")
    if span_days is not None and span_days <= 1.0:
        warnings.append("One-day-only backtest can overstate strategy quality.")
    if pf is not None and pf >= 8:
        warnings.append("Extreme profit factor may indicate overfitting or too few losses.")
    if trades_per_day is not None and trades_per_day > 50:
        warnings.append("Excessive trades per day may indicate overtrading.")
    if turnover_proxy_pct is not None and turnover_proxy_pct > 500:
        warnings.append("High turnover proxy; validate fees and slippage before relying on results.")
    if not has_out_of_sample:
        warnings.append("No out-of-sample validation is available yet.")
    if not has_walk_forward:
        warnings.append("No walk-forward validation is available yet.")
    risk_score = 0
    if n < 30:
        risk_score += 30
    elif n < 100:
        risk_score += 15
    if span_days is not None and span_days <= 1.0:
        risk_score += 20
    if pf is not None and pf >= 8:
        risk_score += 20
    if max_dd_abs is not None and net > 0 and max_dd_abs / max(abs(net), 1e-9) > 0.5:
        risk_score += 15
    if trades_per_day is not None and trades_per_day > 50:
        risk_score += 10
    if not has_out_of_sample or not has_walk_forward:
        risk_score += 15
    risk_score = max(0, min(100, risk_score))
    risk_label = "HIGH" if risk_score >= 60 else "MEDIUM"
    if n >= 100 and has_walk_forward and has_out_of_sample and risk_score < 35:
        risk_label = "LOW"
    reasons = []
    if not r:
        reasons.append("No closed trade R-multiples were available.")
    if source_note:
        reasons.append(source_note)
    return {
        "risk_adjusted": {
            "sharpe": _round(sharpe),
            "sortino": _round(sortino),
            "calmar": _round(calmar),
            "omega": _round(omega),
            "recovery_factor": _round(recovery),
        },
        "friction": {
            "fee_pct_per_side": _round(f_rate, 4),
            "slippage_pct_per_side": _round(s_rate, 4),
            "round_trip_friction_pct": _round(round_trip_friction_pct, 4),
            "friction_R_per_trade": _round(friction_r_per_trade, 4),
            "total_friction_R": _round(total_friction_R, 4),
            "net_R_gross": _round(net, 4),
            "net_R_after_friction": _round(net - total_friction_R, 4),
        },
        "expectancy": {
            "expectancy_R_per_trade": _round(avg),
            "expectancy_R_net": _round(avg - friction_r_per_trade) if avg is not None else None,
            "average_winner_R": _round(mean(wins) if wins else None),
            "average_loser_R": _round(mean(losses) if losses else None),
            "payoff_ratio": _round((mean(wins) / abs(mean(losses))) if wins and losses else None),
            "largest_winner_R": _round(max(wins) if wins else None),
            "largest_loser_R": _round(min(losses) if losses else None),
        },
        "risk": {
            "max_drawdown_R": _round(eq["max_drawdown_R"]),
            "average_drawdown_R": _round(eq["average_drawdown_R"]),
            "drawdown_duration_trades": eq["drawdown_duration_trades"],
            "max_consecutive_wins": max_wins,
            "max_consecutive_losses": max_losses,
            "ulcer_index": _round(eq["ulcer_index"]),
        },
        "trading_behavior": {
            "trades_per_day": _round(trades_per_day),
            "turnover_raw": _round(turnover_raw),
            "turnover_percentage": _round(turnover_percentage),
            "turnover_display": _display_percent(turnover_percentage),
            "turnover_proxy_pct": _round(turnover_proxy_pct),
            "turnover_proxy_display": _display_percent(turnover_proxy_pct),
            "turnover_explanation": turnover_explanation,
            "turnover_estimate": _round(turnover_proxy_pct),
            "turnover_estimate_note": "Risk-based activity estimate only; not real notional turnover.",
            "exposure_estimate": _round(exposure),
            "exposure_percentage": _round(exposure_percentage),
            "exposure_display": _display_percent(exposure_percentage),
            "average_holding_bars": _round(mean(holding) if holding else None),
            "median_holding_bars": _round(median(holding) if holding else None),
        },
        "robustness": {
            "trade_count_sufficiency_warning": n < 30,
            "overfitting_risk_label": risk_label,
            "overfitting_risk_score": risk_score,
            "parameter_sensitivity": parameter_sensitivity,
            "parameter_sensitivity_note": "Not implemented yet." if parameter_sensitivity is None else None,
            "walk_forward": {"available": has_walk_forward, "note": None if has_walk_forward else "Placeholder until walk-forward validation is implemented."},
            "out_of_sample": {"available": has_out_of_sample, "note": None if has_out_of_sample else "Placeholder until out-of-sample validation is implemented."},
            "calculation_notes": reasons,
        },
        "warnings": warnings,
    }
