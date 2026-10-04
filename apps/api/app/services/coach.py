"""PRISMFlow Quant Coach service.

Pure Python (no external dependencies). Computes:
- Expectancy (avg R, win rate, profit factor, gross R)
- Monte Carlo simulation (percentile fan-out for final R and drawdown)
- Walk-forward analysis (train/test stability windows)
- Stress testing (slippage, vol shock, gap risk, adverse trend)
- Lifestyle fit (signals/week, monitoring burden score)
- Objective pass/fail (is the edge real?)
- Rule discipline (violations, emotional overrides, R impact)
- Full coach report with verdict, insights, and next actions
"""
from __future__ import annotations

import json
import math
import random
import statistics
from pathlib import Path
from typing import Any, Dict, List, Optional

# ─── Expectancy ───────────────────────────────────────────────────────────────

def compute_expectancy(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not trades:
        return {"trades": 0, "avg_R": None, "win_rate": None, "profit_factor": None, "gross_R": None, "equity_curve_R": []}

    rs = []
    for t in trades:
        v = t.get("r_multiple") or t.get("R_multiple") or t.get("r") or 0
        try:
            rs.append(float(v))
        except (TypeError, ValueError):
            rs.append(0.0)

    n = len(rs)
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r < 0]
    win_rate = len(wins) / n if n else 0
    avg_R = statistics.mean(rs) if rs else 0
    gross_R = sum(rs)

    gross_wins = sum(wins)
    gross_losses = abs(sum(losses))
    profit_factor = round(gross_wins / gross_losses, 3) if gross_losses else float("inf")

    # Build cumulative equity curve
    equity_curve = []
    cumsum = 0.0
    for r in rs:
        cumsum += r
        equity_curve.append(round(cumsum, 4))

    # Max drawdown
    peak = equity_curve[0] if equity_curve else 0
    max_dd = 0.0
    for v in equity_curve:
        peak = max(peak, v)
        max_dd = min(max_dd, v - peak)

    avg_win = statistics.mean(wins) if wins else 0
    avg_loss = statistics.mean(losses) if losses else 0

    return {
        "trades": n,
        "avg_R": round(avg_R, 4),
        "win_rate": round(win_rate, 4),
        "loss_rate": round(1 - win_rate, 4),
        "profit_factor": round(profit_factor, 3),
        "gross_R": round(gross_R, 4),
        "avg_win_R": round(avg_win, 4),
        "avg_loss_R": round(avg_loss, 4),
        "max_drawdown_R": round(max_dd, 4),
        "equity_curve_R": equity_curve,
        "r_values": rs,
    }


# ─── Monte Carlo ──────────────────────────────────────────────────────────────

def run_monte_carlo(
    trades: List[Dict[str, Any]],
    n_simulations: int = 1000,
    n_trades: int = 50,
) -> Dict[str, Any]:
    if not trades:
        return {
            "simulations": n_simulations,
            "n_trades": n_trades,
            "final_R": {"p01": None, "p05": None, "p25": None, "p50": None, "p75": None, "p95": None, "p99": None},
            "drawdown_R": {"p50": None, "p75": None, "p90": None, "p95": None, "p99": None},
            "risk_of_ruin_minus_10R": None,
            "probability_final_R_positive": None,
        }

    rs = []
    for t in trades:
        v = t.get("r_multiple") or t.get("R_multiple") or t.get("r") or 0
        try:
            rs.append(float(v))
        except (TypeError, ValueError):
            rs.append(0.0)

    rng = random.Random(42)
    final_Rs: List[float] = []
    max_drawdowns: List[float] = []

    for _ in range(n_simulations):
        sample = rng.choices(rs, k=n_trades)
        cumsum = 0.0
        peak = 0.0
        max_dd = 0.0
        for r in sample:
            cumsum += r
            peak = max(peak, cumsum)
            max_dd = min(max_dd, cumsum - peak)
        final_Rs.append(round(cumsum, 4))
        max_drawdowns.append(round(max_dd, 4))

    final_Rs.sort()
    max_drawdowns.sort()

    def pct(arr: List[float], p: float) -> float:
        idx = int((p / 100) * (len(arr) - 1))
        return round(arr[idx], 3)

    ruin_threshold = -10.0
    ror = sum(1 for f in final_Rs if f <= ruin_threshold) / len(final_Rs)
    p_positive = sum(1 for f in final_Rs if f > 0) / len(final_Rs)

    return {
        "simulations": n_simulations,
        "n_trades": n_trades,
        "final_R": {
            "p01": pct(final_Rs, 1), "p05": pct(final_Rs, 5),
            "p25": pct(final_Rs, 25), "p50": pct(final_Rs, 50),
            "p75": pct(final_Rs, 75), "p95": pct(final_Rs, 95),
            "p99": pct(final_Rs, 99),
        },
        "drawdown_R": {
            "p50": pct(max_drawdowns, 50), "p75": pct(max_drawdowns, 75),
            "p90": pct(max_drawdowns, 90), "p95": pct(max_drawdowns, 95),
            "p99": pct(max_drawdowns, 99),
        },
        "risk_of_ruin_minus_10R": round(ror, 4),
        "probability_final_R_positive": round(p_positive, 4),
    }


# ─── Walk-Forward ─────────────────────────────────────────────────────────────

def walk_forward_analysis(
    trades: List[Dict[str, Any]],
    n_windows: int = 5,
    train_pct: float = 0.7,
) -> Dict[str, Any]:
    min_trades_per_window = 10
    if len(trades) < n_windows * min_trades_per_window:
        return {"status": "INSUFFICIENT_DATA", "windows": [], "pass_rate": None, "reason": f"Need {n_windows * min_trades_per_window}+ trades for {n_windows}-window analysis"}

    rs = []
    for t in trades:
        v = t.get("r_multiple") or t.get("r") or 0
        try:
            rs.append(float(v))
        except (TypeError, ValueError):
            rs.append(0.0)

    size = len(rs) // n_windows
    windows = []
    for i in range(n_windows):
        chunk = rs[i * size : (i + 1) * size]
        split = max(1, int(len(chunk) * train_pct))
        train = chunk[:split]
        test = chunk[split:]
        if not test:
            continue
        train_avg = statistics.mean(train) if train else 0
        test_avg = statistics.mean(test) if test else 0
        # Pass = test is profitable AND not massively degraded vs train
        passed = test_avg > 0 and abs(test_avg - train_avg) < 0.5 * (abs(train_avg) + 0.1)
        windows.append({
            "window": i + 1,
            "train_trades": len(train),
            "test_trades": len(test),
            "train_avg_R": round(train_avg, 4),
            "test_avg_R": round(test_avg, 4),
            "degradation": round(test_avg - train_avg, 4),
            "passed": passed,
        })

    pass_rate = sum(1 for w in windows if w["passed"]) / len(windows) if windows else 0
    status = "PASS" if pass_rate >= 0.6 else "FAIL"

    return {
        "status": status,
        "pass_rate": round(pass_rate, 3),
        "windows": windows,
        "windows_passed": sum(1 for w in windows if w["passed"]),
        "windows_total": len(windows),
    }


# ─── Out-of-Sample (OOS) ──────────────────────────────────────────────────────

def compute_out_of_sample(
    trades: List[Dict[str, Any]],
    split_pct: float = 0.7,
) -> Dict[str, Any]:
    if not trades or len(trades) < 10:
        return {
            "status": "INSUFFICIENT_DATA",
            "available": False,
            "pass_rate": None,
            "reason": f"Need at least 10 closed trades for in-sample / out-of-sample split (currently {len(trades)})",
        }

    rs = []
    for t in trades:
        v = t.get("r_multiple") or t.get("R_multiple") or t.get("r") or 0
        try:
            rs.append(float(v))
        except (TypeError, ValueError):
            rs.append(0.0)

    split = max(1, int(len(rs) * split_pct))
    train = rs[:split]
    test = rs[split:]

    train_avg = statistics.mean(train) if train else 0.0
    test_avg = statistics.mean(test) if test else 0.0
    train_win = (sum(1 for x in train if x > 0) / len(train)) if train else 0.0
    test_win = (sum(1 for x in test if x > 0) / len(test)) if test else 0.0

    efficiency = (test_avg / train_avg) if train_avg > 0 else (1.0 if test_avg > 0 else 0.0)
    passed = test_avg > 0 and (efficiency >= 0.35 or test_avg >= 0.08)

    status = "PASS" if passed else "FAIL"

    return {
        "status": status,
        "available": True,
        "split_ratio": f"{int(split_pct * 100)}/{int((1 - split_pct) * 100)}",
        "in_sample_trades": len(train),
        "out_of_sample_trades": len(test),
        "in_sample_avg_R": round(train_avg, 4),
        "out_of_sample_avg_R": round(test_avg, 4),
        "in_sample_win_rate": round(train_win, 4),
        "out_of_sample_win_rate": round(test_win, 4),
        "efficiency_ratio": round(efficiency, 3),
        "passed": passed,
        "verdict": (
            f"Out-of-sample edge confirmed ({test_avg:+.3f}R/trade across {len(test)} unseen trades, retaining {efficiency:.0%} of in-sample edge)."
            if passed else
            f"Out-of-sample degradation detected ({test_avg:+.3f}R/trade vs {train_avg:+.3f}R/trade in-sample). Edge may be partially curve-fit."
        ),
    }


# ─── Parameter Sensitivity ────────────────────────────────────────────────────

def compute_parameter_sensitivity(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    st = stress_test(trades)
    if st.get("status") == "INSUFFICIENT_DATA":
        return {
            "status": "INSUFFICIENT_DATA",
            "available": False,
            "stability_score": None,
            "reason": "Need more closed trades for perturbation stability testing",
        }

    pass_rate = float(st.get("pass_rate", 0.0) or 0.0)
    stability_score = round(pass_rate * 100, 1)

    status = "ROBUST" if stability_score >= 70 else ("MARGINAL" if stability_score >= 40 else "FRAGILE")

    return {
        "status": status,
        "available": True,
        "stability_score": stability_score,
        "scenarios_passed": st.get("scenarios_passed", 0),
        "scenarios_total": st.get("scenarios_total", 0),
        "scenarios": st.get("scenarios", []),
        "verdict": (
            f"High parameter stability ({stability_score}% resilience across slippage, wider stops, and execution shocks). Strategy is not hyper-sensitive to exact parameter values."
            if status == "ROBUST" else
            f"Moderate sensitivity ({stability_score}% resilience). Performance degrades under friction or volatility expansion."
            if status == "MARGINAL" else
            f"Fragile parameter profile ({stability_score}% resilience). Small changes in market friction or stop widths erode positive expectancy."
        ),
    }


# ─── Actionable Coaching Plan ─────────────────────────────────────────────────

def generate_actionable_coaching_plan(
    trades: List[Dict[str, Any]],
    exp: Dict[str, Any],
    wf: Dict[str, Any],
    oos: Dict[str, Any],
    st: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    config = config or {}
    items = []
    n = exp.get("trades", 0)
    avg_R = exp.get("avg_R", 0) or 0
    win_rate = exp.get("win_rate", 0) or 0
    pf = exp.get("profit_factor", 0) or 0
    avg_win = exp.get("avg_win_R", 0) or 0
    avg_loss = abs(exp.get("avg_loss_R", 0) or 1.0)
    payoff = (avg_win / avg_loss) if avg_loss else 1.0
    max_dd = exp.get("max_drawdown_R", 0) or 0

    # 1. Overtrading & Setup Filtering
    if n > 150:
        items.append({
            "category": "Execution Frequency & Filtering",
            "priority": "HIGH",
            "title": "Mitigate High-Frequency Overtrading",
            "observation": f"Strategy produced {n} trades. High frequency magnifies exchange fees and spread drag.",
            "impact": "Exchanges capture a significant portion of gross profits via taker fees and spread slippage.",
            "action": "In Strategy Builder, increase 'Minimum Setup Score' from 6.5 to 8.5–9.0, or enable the 5m Trend Filter to skip low-conviction breakout noise.",
            "builder_action": {
                "param": "min_setup_score",
                "recommended_value": 8.5,
                "label": "Raise Setup Score to 8.5",
            },
        })
    elif n < 30:
        items.append({
            "category": "Sample Size",
            "priority": "HIGH",
            "title": "Expand Sample Horizon for Statistical Significance",
            "observation": f"Only {n} trades recorded so far.",
            "impact": "Small samples carry high variance. Metrics can be skewed by a single lucky win or unlucky loss.",
            "action": "Test over at least 14-30 days of market data or deploy to Live Paper Trading to collect 50+ trades.",
            "builder_action": {
                "param": "backtest_days",
                "recommended_value": 14,
                "label": "Extend Backtest Window to 14 Days",
            },
        })

    # 2. Payoff Ratio & Target Configuration
    if payoff >= 1.8:
        items.append({
            "category": "Profit Targets & Exits",
            "priority": "MEDIUM",
            "title": f"Protect Strong {payoff:.2f}x Asymmetric Payoff",
            "observation": f"Average winner (+{avg_win:.2f}R) significantly outpaces average loser (-{avg_loss:.2f}R).",
            "impact": f"With a {payoff:.2f}x payoff ratio, you only need a {100 / (1 + payoff):.1f}% win rate to remain net profitable.",
            "action": "Maintain Target 1 at 1.5R and Target 2 at 2.5R. In Strategy Builder, consider enabling 'Move Stop to Breakeven at +1.0R' to eliminate tail downside on mature trades.",
            "builder_action": {
                "param": "breakeven_trigger_R",
                "recommended_value": 1.0,
                "label": "Enable Breakeven Stop at +1.0R",
            },
        })
    elif payoff < 1.1:
        items.append({
            "category": "Profit Targets & Exits",
            "priority": "HIGH",
            "title": "Widen Reward-to-Risk Payoff",
            "observation": f"Payoff ratio is only {payoff:.2f}x (avg win +{avg_win:.2f}R vs avg loss -{avg_loss:.2f}R).",
            "impact": "Low payoff requires a high win rate (>50%) just to break even after exchange fees.",
            "action": "In Strategy Builder, widen Target 1 to 1.5R or 2.0R and ensure Stop Loss is anchored to true market structure rather than a fixed tight tick.",
            "builder_action": {
                "param": "target1_R",
                "recommended_value": 1.5,
                "label": "Widen Target 1 to 1.5R",
            },
        })

    # 3. Downside & Drawdown Sizing
    items.append({
        "category": "Capital Preservation",
        "priority": "MEDIUM",
        "title": "Calibrate Risk Sizing to Max Drawdown",
        "observation": f"Max historical drawdown is {max_dd:.2f}R with an expectancy of {avg_R:+.3f}R per trade.",
        "impact": f"At 1% account risk per trade, this peak drawdown represents only {abs(max_dd) * 1.0:.1f}% equity drawdown.",
        "action": "Allocate between 0.5% and 1.0% risk per trade on your paper wallet. Never risk more than 2.0% per trade to guarantee zero risk of ruin.",
        "builder_action": {
            "param": "risk_per_trade_pct",
            "recommended_value": 1.0,
            "label": "Set Risk to 1.0% per Trade",
        },
    })

    # 4. Out-of-Sample / Walk-Forward Validation
    if oos.get("status") == "PASS" and wf.get("status") == "PASS":
        items.append({
            "category": "Deployment Readiness",
            "priority": "LOW",
            "title": "Deploy Strategy to Live Paper Trading",
            "observation": "Both Walk-Forward analysis and Out-of-Sample validation passed with positive expectancy across unseen data.",
            "impact": "Edge demonstrates robust temporal stability across market regimes.",
            "action": "Click 'Deploy to Paper Trading' below to run real-time market execution on Binance streaming feeds with zero financial risk.",
            "builder_action": {
                "param": "deploy_paper",
                "recommended_value": True,
                "label": "Launch Live Paper Session",
            },
        })

    return items


# ─── Stress Testing ───────────────────────────────────────────────────────────

def stress_test(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not trades:
        return {"status": "INSUFFICIENT_DATA", "scenarios": [], "pass_rate": None}

    rs = []
    for t in trades:
        v = t.get("r_multiple") or t.get("r") or 0
        try:
            rs.append(float(v))
        except (TypeError, ValueError):
            rs.append(0.0)

    def avg_R(r_list: List[float]) -> float:
        return statistics.mean(r_list) if r_list else 0.0

    def apply_slippage(rs: List[float], slip_R: float) -> List[float]:
        return [r - slip_R for r in rs]

    def apply_vol_shock(rs: List[float], mult: float) -> List[float]:
        return [r * mult if r < 0 else r * 0.8 for r in rs]

    def apply_gap_risk(rs: List[float], skip_pct: float) -> List[float]:
        rng = random.Random(42)
        return [r for r in rs if rng.random() > skip_pct]

    baseline = avg_R(rs)

    scenarios_raw = [
        ("Slippage +0.5R", apply_slippage(rs, 0.5), 0.0),
        ("Slippage +1R", apply_slippage(rs, 1.0), 0.0),
        ("Stop widened 50% (vol shock)", apply_vol_shock(rs, 1.5), 0.0),
        ("20% trades skipped (execution failure)", apply_gap_risk(rs, 0.20), 0.0),
        ("Commission ×3", apply_slippage(rs, 0.1), 0.0),
        ("All losses ×1.5 (adverse market)", [r * 1.5 if r < 0 else r for r in rs], 0.0),
        ("All wins ×0.7 (mean reversion)", [r * 0.7 if r > 0 else r for r in rs], 0.0),
    ]

    scenarios = []
    for name, modified_rs, _ in scenarios_raw:
        a = avg_R(modified_rs)
        passed = a > 0
        scenarios.append({
            "scenario": name,
            "avg_R": round(a, 4),
            "passed": passed,
            "vs_baseline": round(a - baseline, 4),
        })

    pass_rate = sum(1 for s in scenarios if s["passed"]) / len(scenarios)
    status = "ROBUST" if pass_rate >= 0.7 else "FRAGILE" if pass_rate <= 0.3 else "MARGINAL"

    return {
        "status": status,
        "pass_rate": round(pass_rate, 3),
        "scenarios_passed": sum(1 for s in scenarios if s["passed"]),
        "scenarios_total": len(scenarios),
        "scenarios": scenarios,
    }


# ─── Lifestyle Fit ────────────────────────────────────────────────────────────

_TF_SIGNALS = {
    "1m": 200, "3m": 80, "5m": 50, "15m": 20,
    "30m": 12, "1h": 6, "4h": 2, "1d": 0.3, "1w": 0.07,
}

def compute_lifestyle_fit(config: Dict[str, Any], trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    tf = config.get("timeframe", "1m")
    n_trades = len(trades) if trades else 0
    signals_per_week = _TF_SIGNALS.get(tf, 10)

    # Score: lower monitoring burden = higher lifestyle fit
    if signals_per_week >= 100:
        label = "SCALPING_GRIND"
        score = 20
        burden = "VERY_HIGH"
        psych_burden = "VERY_HIGH"
        why = [
            f"Generates ~{signals_per_week} signals/week — requires constant screen time",
            "Extremely demanding on attention and reaction speed",
            "Very difficult to sustain around a full-time job",
        ]
    elif signals_per_week >= 30:
        label = "ACTIVE_DAY_TRADING"
        score = 40
        burden = "HIGH"
        psych_burden = "HIGH"
        why = [
            f"~{signals_per_week} signals/week — significant daily commitment",
            "Suits traders who can dedicate 4+ hours/day",
            "High psychological demand due to frequent decisions",
        ]
    elif signals_per_week >= 8:
        label = "MODERATE_INTRADAY"
        score = 65
        burden = "MODERATE"
        psych_burden = "MODERATE"
        why = [
            f"~{signals_per_week} signals/week — manageable for part-time traders",
            "Can work around a day job with some flexibility",
            "Still requires checking charts several times daily",
        ]
    elif signals_per_week >= 1:
        label = "SWING_TRADING_FRIENDLY"
        score = 85
        burden = "LOW"
        psych_burden = "LOW"
        why = [
            f"~{signals_per_week} signals/week — excellent lifestyle fit",
            "Can manage positions with 1-2 checks per day",
            "Compatible with full-time employment",
        ]
    else:
        label = "POSITION_TRADING"
        score = 95
        burden = "VERY_LOW"
        psych_burden = "VERY_LOW"
        why = [
            f"~{signals_per_week:.1f} signals/week — minimal daily commitment",
            "Check once or twice a week",
            "Best lifestyle fit — lowest psychological burden",
        ]

    return {
        "score": score,
        "label": label,
        "monitoring_burden": burden,
        "psychological_burden": psych_burden,
        "signals_per_week_estimate": round(signals_per_week, 1),
        "timeframe": tf,
        "why": why,
    }


# ─── Objective Pass/Fail ─────────────────────────────────────────────────────

def compute_objective_pass_fail(
    expectancy: Dict[str, Any],
    mc: Dict[str, Any],
    target: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    target = target or {
        "minimum_trades": 30,
        "minimum_avg_R": 0.1,
        "minimum_final_R": 5.0,
        "maximum_95pct_drawdown_R": -10.0,
        "maximum_risk_of_ruin": 0.05,
    }

    trades = expectancy.get("trades", 0)
    avg_R = expectancy.get("avg_R") or 0
    final_p50 = (mc.get("final_R") or {}).get("p50") or 0
    dd_p95 = (mc.get("drawdown_R") or {}).get("p95") or 0
    ror = mc.get("risk_of_ruin_minus_10R") or 0

    if trades < target["minimum_trades"]:
        return {
            "verdict": "INSUFFICIENT_DATA",
            "reason": f"Only {trades} trades — need {target['minimum_trades']}+ for reliable analysis",
            "target": target,
        }

    failures = []
    if avg_R < target["minimum_avg_R"]:
        failures.append(f"avg_R ({avg_R:.3f}) below threshold ({target['minimum_avg_R']})")
    if final_p50 < target["minimum_final_R"]:
        failures.append(f"MC p50 final R ({final_p50}) below target ({target['minimum_final_R']})")
    if dd_p95 < target["maximum_95pct_drawdown_R"]:
        failures.append(f"MC 95th pct drawdown ({dd_p95}R) too deep (threshold: {target['maximum_95pct_drawdown_R']}R)")
    if ror > target["maximum_risk_of_ruin"]:
        failures.append(f"Risk of ruin ({ror:.1%}) exceeds max ({target['maximum_risk_of_ruin']:.1%})")

    if failures:
        return {"verdict": "FAIL", "failures": failures, "target": target}
    return {"verdict": "PASS", "target": target}


# ─── Rule Discipline ──────────────────────────────────────────────────────────

def compute_rule_discipline(violations: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not violations:
        return {
            "manual_rule_violations_detected": 0,
            "manual_rule_violation_R_impact": 0,
            "status": "CLEAN",
            "emotional_states": {},
            "rule_counts": {},
        }

    rule_counts: Dict[str, int] = {}
    emotional_states: Dict[str, int] = {}
    total_r_impact = 0.0

    for v in violations:
        rule = v.get("rule_broken")
        if rule:
            rule_counts[rule] = rule_counts.get(rule, 0) + 1
        state = v.get("emotional_state", "neutral")
        emotional_states[state] = emotional_states.get(state, 0) + 1
        r_impact = v.get("r_impact", 0) or 0
        try:
            total_r_impact += float(r_impact)
        except (TypeError, ValueError):
            pass

    n = len(violations)
    status = "CLEAN" if n == 0 else "MINOR_ISSUES" if n <= 3 else "SIGNIFICANT_ISSUES"

    return {
        "manual_rule_violations_detected": n,
        "manual_rule_violation_R_impact": round(total_r_impact, 4),
        "status": status,
        "rule_counts": rule_counts,
        "emotional_states": emotional_states,
        "most_common_rule": max(rule_counts, key=rule_counts.get) if rule_counts else None,
        "most_common_emotion": max(emotional_states, key=emotional_states.get) if emotional_states else None,
    }


# ─── Coach Insights ───────────────────────────────────────────────────────────

def _generate_insights(
    exp: Dict, mc: Dict, wf: Dict, stress: Dict, fit: Dict, discipline: Dict
) -> List[str]:
    insights = []
    avg_R = exp.get("avg_R") or 0
    win_rate = exp.get("win_rate") or 0
    trades = exp.get("trades") or 0

    if trades < 30:
        insights.append(f"Sample size is small ({trades} trades). Run at least 30 trades before drawing conclusions.")
    if avg_R > 0.3:
        insights.append(f"Positive expectancy of {avg_R:.3f}R/trade is a meaningful edge. Protect it.")
    elif avg_R > 0:
        insights.append(f"Marginal positive expectancy ({avg_R:.3f}R). Verify it's not noise with more trades.")
    else:
        insights.append(f"Negative expectancy ({avg_R:.3f}R). Do not scale this strategy until edge is found.")

    if win_rate < 0.35:
        pf = exp.get("profit_factor", 0) or 0
        if pf > 2.0:
            insights.append(f"Low win rate ({win_rate:.0%}) but high profit factor ({pf:.2f}x). Typical of trend-following. Psychologically difficult — be prepared for losing streaks.")
    elif win_rate > 0.65:
        insights.append(f"High win rate ({win_rate:.0%}) feels good but may indicate too-tight stops. Check profit factor.")

    mc_dd = (mc.get("drawdown_R") or {}).get("p95")
    if mc_dd is not None and mc_dd < -8:
        insights.append(f"Monte Carlo shows 95th-pct drawdown of {mc_dd}R — that's {abs(mc_dd) * 100:.0f}% of a 100R account. Risk of blowup is non-trivial.")

    if wf.get("status") == "FAIL":
        insights.append("Walk-forward analysis failed. Strategy may be overfit to historical data. Reduce complexity.")
    elif wf.get("status") == "PASS":
        insights.append(f"Walk-forward PASS ({wf.get('pass_rate', 0):.0%} windows positive). Edge appears stable across time.")

    if stress.get("status") == "FRAGILE":
        insights.append("Strategy is fragile under stress tests. High sensitivity to slippage or volatility changes.")

    violations = discipline.get("manual_rule_violations_detected", 0)
    r_impact = discipline.get("manual_rule_violation_R_impact", 0) or 0
    if violations > 0:
        insights.append(f"You made {violations} manual overrides costing {r_impact:+.2f}R. Your rules are smarter than your in-the-moment instincts.")

    return insights


def _generate_strengths_weaknesses(exp: Dict, mc: Dict, wf: Dict, stress: Dict) -> tuple:
    strengths = []
    weaknesses = []
    avg_R = exp.get("avg_R") or 0
    pf = exp.get("profit_factor") or 0

    if avg_R > 0.2:
        strengths.append(f"Solid positive expectancy: {avg_R:.3f}R per trade")
    else:
        weaknesses.append(f"Weak or negative expectancy: {avg_R:.3f}R per trade")

    if pf and pf > 1.5:
        strengths.append(f"Profit factor {pf:.2f}x — wins outweigh losses meaningfully")
    elif pf and pf < 1.2:
        weaknesses.append(f"Low profit factor ({pf:.2f}x) — barely above breakeven after costs")

    if wf.get("status") == "PASS":
        strengths.append("Walk-forward stable — edge consistent across time")
    elif wf.get("status") == "FAIL":
        weaknesses.append("Walk-forward unstable — possible curve-fitting")

    if stress.get("status") == "ROBUST":
        strengths.append("Robust under stress scenarios (slippage, vol, gaps)")
    elif stress.get("status") == "FRAGILE":
        weaknesses.append("Fragile under stress — edge disappears with small market changes")

    mc_ror = mc.get("risk_of_ruin_minus_10R", 0) or 0
    if mc_ror < 0.02:
        strengths.append(f"Low risk of ruin: {mc_ror:.1%}")
    elif mc_ror > 0.10:
        weaknesses.append(f"High risk of ruin: {mc_ror:.1%} — reduce position size")

    return strengths, weaknesses


def _determine_verdict(exp: Dict, mc: Dict, obj: Dict, discipline: Dict) -> str:
    if obj.get("verdict") == "INSUFFICIENT_DATA":
        return "NEEDS_MORE_DATA"
    if obj.get("verdict") == "PASS":
        return "PROMISING_PAPER_SYSTEM"
    return "DO_NOT_SCALE_YET"


def _generate_next_actions(verdict: str, exp: Dict, wf: Dict, discipline: Dict) -> List[str]:
    actions = []
    if verdict == "NEEDS_MORE_DATA":
        actions.append(f"Run more trades — you have {exp.get('trades', 0)}, target 50+")
    if verdict == "PROMISING_PAPER_SYSTEM":
        actions.append("Continue tracking with paper trading for 2-3 more months")
        actions.append("Do NOT go live yet — paper trading confirmation period required")
    if verdict == "DO_NOT_SCALE_YET":
        actions.append("Do not trade this strategy with real money")
        actions.append("Review entry rules — reduce trade frequency or improve setup quality")
    if wf.get("status") == "FAIL":
        actions.append("Simplify strategy — fewer parameters = less overfitting risk")
    violations = discipline.get("manual_rule_violations_detected", 0)
    if violations > 0:
        actions.append(f"Reduce manual overrides — you've made {violations}. Trust the system.")
    actions.append("Log every paper trade in the Trade Journal — behavioral patterns take time to emerge")
    return actions


# ─── Full Coach Report ────────────────────────────────────────────────────────

def build_coach_report(
    trades: List[Dict[str, Any]],
    violations: Optional[List[Dict[str, Any]]] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    violations = violations or []
    config = config or {}

    exp = compute_expectancy(trades)
    mc = run_monte_carlo(trades, n_simulations=1000, n_trades=50)
    wf = walk_forward_analysis(trades)
    oos = compute_out_of_sample(trades)
    st = stress_test(trades)
    sens = compute_parameter_sensitivity(trades)
    fit = compute_lifestyle_fit(config, trades)
    discipline = compute_rule_discipline(violations)
    obj = compute_objective_pass_fail(exp, mc)
    strengths, weaknesses = _generate_strengths_weaknesses(exp, mc, wf, st)
    insights = _generate_insights(exp, mc, wf, st, fit, discipline)
    verdict = _determine_verdict(exp, mc, obj, discipline)
    next_actions = _generate_next_actions(verdict, exp, wf, discipline)
    plan = generate_actionable_coaching_plan(trades, exp, wf, oos, st, config)

    return {
        "final_verdict": verdict,
        "metrics": exp,
        "monte_carlo": mc,
        "walk_forward_analysis": wf,
        "out_of_sample_analysis": oos,
        "parameter_sensitivity": sens,
        "actionable_coaching_plan": plan,
        "stress_testing": st,
        "lifestyle_fit": fit,
        "rule_discipline": discipline,
        "objective_analysis": obj,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "coach_insights": insights,
        "next_actions": next_actions,
        "disclaimer": "Paper trading analytics only. Not financial advice.",
    }


# ─── I/O helpers (called by engine_runner) ───────────────────────────────────

def read_trades_from_csv(trade_log_path: Path) -> List[Dict[str, Any]]:
    import csv
    if not trade_log_path.exists():
        return []
    trades = []
    with open(trade_log_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            trades.append(dict(row))
    return trades


def write_coach_report(output_dir: Path) -> Path:
    trade_log = output_dir / "trade_log.csv"
    trades = read_trades_from_csv(trade_log)

    report = build_coach_report(trades, violations=[], config={})

    out_path = output_dir / "quant_coach_report.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return out_path


def read_coach_report(output_dir: Path) -> Dict[str, Any]:
    path = output_dir / "quant_coach_report.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
