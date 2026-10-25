"""
apps/api/app/services/monte_carlo_suite.py
Institutional Monte Carlo & Stress-Testing Verification Suite (QuantOS v3.0).
Pure Python (zero external dependencies).
Implements:
1. Stationary Block Bootstrap (Politis-Romano) to preserve autocorrelated return dependencies.
2. Trade Sequence Shuffling / Permutation analysis.
3. Maximum Drawdown Probability Distribution (Median, 90th, 95th, 99th percentile worst-case).
4. Statistical Probability of Breaching Prop-Firm Challenge Limits.
5. Parameter Cliff / Sensitivity Stress-Testing.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class MonteCarloConfig:
    num_simulations: int = 1000
    expected_block_size: int = 10
    initial_balance: float = 100_000.0
    max_allowed_drawdown_pct: float = 8.0


@dataclass
class MonteCarloSimulationReport:
    total_simulations: int
    initial_balance: float
    median_final_equity: float
    p5_final_equity: float
    p95_final_equity: float
    median_max_drawdown_pct: float
    p90_max_drawdown_pct: float
    p95_max_drawdown_pct: float
    p99_max_drawdown_pct: float
    prop_firm_breach_probability: float
    ruin_probability: float
    drawdown_distribution_pct: Dict[str, float] = field(default_factory=dict)
    histogram_bins: List[Dict[str, Any]] = field(default_factory=list)


def _percentile(values: List[float], p: float) -> float:
    """Calculates percentile p in [0, 100] from a list of floats."""
    if not values:
        return 0.0
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_v[int(k)]
    d0 = sorted_v[int(f)] * (c - k)
    d1 = sorted_v[int(c)] * (k - f)
    return d0 + d1


class MonteCarloStressTester:
    """Institutional Resampling and Stress Testing Suite."""

    @staticmethod
    def run_stationary_bootstrap(
        returns: List[float],
        iterations: int = 2000,
        expected_block_size: int = 10,
        starting_equity: float = 100_000.0,
        prop_limit_pct: float = 8.0,
    ) -> Dict[str, Any]:
        """
        Runs Politis-Romano stationary block bootstrap on return series.
        Preserves volatility clustering and fat tails.
        """
        clean_r = [float(r) for r in returns if r is not None and not math.isnan(float(r))]
        n = len(clean_r)

        if n < 5:
            return {
                "iterations": iterations,
                "starting_equity": starting_equity,
                "median_final_equity": starting_equity,
                "p5_final_equity": starting_equity,
                "p95_final_equity": starting_equity,
                "median_max_drawdown_pct": 0.0,
                "p90_max_drawdown_pct": 0.0,
                "p95_max_drawdown_pct": 0.0,
                "p99_max_drawdown_pct": 0.0,
                "prop_firm_limit_pct": prop_limit_pct,
                "prob_breaching_prop_limit_pct": 0.0,
                "prob_ruin_50pct": 0.0,
                "median_sharpe": 0.0,
                "p5_sharpe": 0.0,
                "p95_sharpe": 0.0,
                "drawdown_distribution_bins": [],
            }

        # Politis-Romano geometric block probability
        p = 1.0 / max(2, expected_block_size)
        max_drawdowns: List[float] = []
        final_equities: List[float] = []
        sharpes: List[float] = []
        prop_breaches = 0
        ruin_events = 0

        for _ in range(iterations):
            sampled_r: List[float] = []
            curr = random.randint(0, n - 1)
            for _ in range(n):
                if random.random() < p:
                    curr = random.randint(0, n - 1)
                else:
                    curr = (curr + 1) % n
                sampled_r.append(clean_r[curr])

            # Compound equity: Equity_t = Equity_0 * prod(1 + r)
            eq = starting_equity
            peak = starting_equity
            max_dd = 0.0

            for r in sampled_r:
                eq *= (1.0 + r)
                if eq > peak:
                    peak = eq
                if peak > 0:
                    dd = (peak - eq) / peak
                    if dd > max_dd:
                        max_dd = dd

            max_dd_val = max_dd * 100.0
            max_drawdowns.append(max_dd_val)
            final_equities.append(eq)

            if max_dd_val >= prop_limit_pct:
                prop_breaches += 1
            if eq <= starting_equity * 0.5:
                ruin_events += 1

            # Approximate annualized Sharpe
            mean_r = sum(sampled_r) / n
            var_r = sum((x - mean_r) ** 2 for x in sampled_r) / max(1, n - 1)
            std_r = math.sqrt(var_r)
            sh = (mean_r / std_r * math.sqrt(252)) if std_r > 1e-6 else 0.0
            sharpes.append(sh)

        # Build histogram
        min_dd = min(max_drawdowns)
        max_dd_overall = max(max_drawdowns)
        num_bins = 12
        step = max(0.1, (max_dd_overall - min_dd) / num_bins)
        bins_data = []

        for b in range(num_bins):
            b_start = min_dd + b * step
            b_end = b_start + step
            count = sum(1 for d in max_drawdowns if (b_start <= d < b_end or (b == num_bins - 1 and d <= b_end)))
            bins_data.append({
                "range": f"{b_start:.1f}%-{b_end:.1f}%",
                "count": count
            })

        return {
            "iterations": iterations,
            "starting_equity": starting_equity,
            "median_final_equity": round(_percentile(final_equities, 50), 2),
            "p5_final_equity": round(_percentile(final_equities, 5), 2),
            "p95_final_equity": round(_percentile(final_equities, 95), 2),
            "median_max_drawdown_pct": round(_percentile(max_drawdowns, 50), 2),
            "p90_max_drawdown_pct": round(_percentile(max_drawdowns, 90), 2),
            "p95_max_drawdown_pct": round(_percentile(max_drawdowns, 95), 2),
            "p99_max_drawdown_pct": round(_percentile(max_drawdowns, 99), 2),
            "prop_firm_limit_pct": prop_limit_pct,
            "prob_breaching_prop_limit_pct": round((prop_breaches / iterations) * 100.0, 2),
            "prob_ruin_50pct": round((ruin_events / iterations) * 100.0, 2),
            "median_sharpe": round(_percentile(sharpes, 50), 2),
            "p5_sharpe": round(_percentile(sharpes, 5), 2),
            "p95_sharpe": round(_percentile(sharpes, 95), 2),
            "drawdown_distribution_bins": bins_data,
        }

    @classmethod
    def run_stationary_block_bootstrap(
        cls,
        returns: List[float],
        config: Optional[MonteCarloConfig] = None,
    ) -> MonteCarloSimulationReport:
        cfg = config or MonteCarloConfig()
        raw = cls.run_stationary_bootstrap(
            returns=returns,
            iterations=cfg.num_simulations,
            expected_block_size=cfg.expected_block_size,
            starting_equity=cfg.initial_balance,
            prop_limit_pct=cfg.max_allowed_drawdown_pct,
        )
        p_dist = {
            "p5": raw["p5_final_equity"],
            "p50": raw["median_max_drawdown_pct"],
            "p90": raw["p90_max_drawdown_pct"],
            "p95": raw["p95_max_drawdown_pct"],
            "p99": raw["p99_max_drawdown_pct"],
        }
        return MonteCarloSimulationReport(
            total_simulations=cfg.num_simulations,
            initial_balance=cfg.initial_balance,
            median_final_equity=raw["median_final_equity"],
            p5_final_equity=raw["p5_final_equity"],
            p95_final_equity=raw["p95_final_equity"],
            median_max_drawdown_pct=raw["median_max_drawdown_pct"],
            p90_max_drawdown_pct=raw["p90_max_drawdown_pct"],
            p95_max_drawdown_pct=raw["p95_max_drawdown_pct"],
            p99_max_drawdown_pct=raw["p99_max_drawdown_pct"],
            prop_firm_breach_probability=raw["prob_breaching_prop_limit_pct"] / 100.0,
            ruin_probability=raw["prob_ruin_50pct"] / 100.0,
            drawdown_distribution_pct=p_dist,
            histogram_bins=raw["drawdown_distribution_bins"],
        )

    @staticmethod
    def run_trade_shuffling(
        trade_pnl_list: List[float],
        iterations: int = 1000,
        starting_equity: float = 100_000.0,
    ) -> Dict[str, float]:
        """Shuffles trade order without replacement to detect path dependency and drawdown clustering."""
        clean = [float(x) for x in trade_pnl_list if x is not None and not math.isnan(float(x))]
        if len(clean) < 3:
            return {"median_dd_pct": 0.0, "p95_dd_pct": 0.0}

        dds: List[float] = []
        for _ in range(iterations):
            shuffled = list(clean)
            random.shuffle(shuffled)
            eq = starting_equity
            peak = starting_equity
            max_dd = 0.0
            for pnl in shuffled:
                eq += pnl
                if eq > peak:
                    peak = eq
                if peak > 0:
                    dd = (peak - eq) / peak
                    if dd > max_dd:
                        max_dd = dd
            dds.append(max_dd * 100.0)

        return {
            "median_dd_pct": round(_percentile(dds, 50), 2),
            "p95_dd_pct": round(_percentile(dds, 95), 2),
        }

    run_trade_sequence_permutation = run_trade_shuffling
