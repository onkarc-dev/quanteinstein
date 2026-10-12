import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
os.environ.setdefault("PRISMFLOW_SECRET_KEY", "unit-test-secret-key-with-enough-length")

from app.services.performance_metrics import build_performance_and_robustness


def t(r, day=1, minute=0, holding=1):
    return {
        "r_multiple": r,
        "entry_time": f"2026-06-{day:02d} 09:{minute:02d}",
        "exit_time": f"2026-06-{day:02d} 09:{minute + holding:02d}",
        "holding_bars": holding,
    }


def test_empty_trades_return_null_ratios_and_warnings():
    out = build_performance_and_robustness([])
    assert out["risk_adjusted"]["sharpe"] is None
    assert out["expectancy"]["expectancy_R_per_trade"] is None
    assert out["robustness"]["trade_count_sufficiency_warning"] is True
    assert "No out-of-sample validation is available yet." in out["warnings"]


def test_losing_strategy_has_negative_expectancy_and_drawdown():
    out = build_performance_and_robustness([t(-1, 1, i % 50) for i in range(40)])
    assert out["expectancy"]["expectancy_R_per_trade"] < 0
    assert out["risk"]["max_drawdown_R"] < 0
    assert out["risk"]["max_consecutive_losses"] == 40


def test_winning_strategy_has_positive_expectancy_without_low_label_by_default():
    trades = [t(1.2 if i % 3 else -0.4, 1 + i // 10, i % 50) for i in range(90)]
    out = build_performance_and_robustness(trades)
    assert out["expectancy"]["expectancy_R_per_trade"] > 0
    assert out["risk_adjusted"]["sharpe"] is not None
    assert out["robustness"]["overfitting_risk_label"] in {"MEDIUM", "HIGH"}


def test_one_day_high_frequency_strategy_warns():
    trades = [t(0.05, 1, i % 50) for i in range(80)]
    out = build_performance_and_robustness(trades, start_time="2026-06-01", end_time="2026-06-01")
    assert any("One-day-only" in w for w in out["warnings"])
    assert any("Excessive trades per day" in w for w in out["warnings"])
    assert out["robustness"]["overfitting_risk_label"] == "HIGH"


def test_low_trade_count_warning():
    out = build_performance_and_robustness([t(1), t(-1)])
    assert out["robustness"]["trade_count_sufficiency_warning"] is True
    assert any("Too few trades" in w for w in out["warnings"])


def test_extreme_profit_factor_warning():
    trades = [t(1.0, 1 + i // 10, i % 50) for i in range(31)] + [t(-0.01, 5, 1)]
    out = build_performance_and_robustness(trades)
    assert any("Extreme profit factor" in w for w in out["warnings"])
    assert out["robustness"]["overfitting_risk_score"] >= 35


def test_no_walk_forward_and_out_of_sample_warnings():
    out = build_performance_and_robustness([t(0.3, 1 + i // 10, i % 50) for i in range(40)])
    assert out["robustness"]["walk_forward"]["available"] is False
    assert out["robustness"]["out_of_sample"]["available"] is False
    assert any("No walk-forward" in w for w in out["warnings"])
    assert any("No out-of-sample" in w for w in out["warnings"])


def test_turnover_display_keeps_real_notional_null_without_notional_and_equity():
    out = build_performance_and_robustness([t(0.5, holding=2), t(-0.2, holding=4)], risk_per_trade_pct=1)
    behavior = out["trading_behavior"]
    assert behavior["turnover_raw"] is None
    assert behavior["turnover_percentage"] is None
    assert behavior["turnover_display"] == "Not enough data"
    assert behavior["turnover_proxy_pct"] == 4
    assert behavior["turnover_proxy_display"] == "4%"


def test_turnover_proxy_uses_trade_count_and_risk_percent():
    out = build_performance_and_robustness([t(0.2) for _ in range(250)], risk_per_trade_pct=1)
    behavior = out["trading_behavior"]
    assert behavior["turnover_percentage"] is None
    assert behavior["turnover_display"] == "Not enough data"
    assert behavior["turnover_proxy_pct"] == 500
    assert behavior["turnover_proxy_display"] == "500%"


def test_real_notional_turnover_requires_complete_notional_and_equity():
    trades = [
        {"r_multiple": 1, "qty": 2, "price": 100, "account_equity": 10000},
        {"r_multiple": -1, "notional": 300, "account_equity": 10000},
    ]
    out = build_performance_and_robustness(trades, risk_per_trade_pct=1)
    behavior = out["trading_behavior"]
    assert behavior["turnover_raw"] == 500
    assert behavior["turnover_percentage"] == 5
    assert behavior["turnover_display"] == "5%"
    assert behavior["turnover_proxy_display"] == "4%"


def test_per_trade_net_r_deduction_and_statistical_significance_over_100_trades():
    from app.services.engine_runner import enrich_trades_with_net_r
    from app.services.coach import build_coach_report

    # Create 120 trades with entry_price=100, stop_loss=99 (1% stop distance)
    # Round-trip fee (0.08%) + slippage (0.02%) = 0.10% -> friction_r = 0.10 / 1.0 = 0.10 R per trade
    raw_trades = [
        {
            "r_multiple": 0.05 if i % 2 == 0 else -0.5,
            "entry_price": 100.0,
            "stop_loss": 99.0,
            "entry_time": f"2026-06-{1 + (i // 10):02d}T10:{i % 60:02d}:00Z",
            "exit_time": f"2026-06-{1 + (i // 10):02d}T10:{(i + 1) % 60:02d}:00Z",
            "holding_bars": 2,
        }
        for i in range(120)
    ]
    enriched = enrich_trades_with_net_r(raw_trades, fee_pct=0.04, slippage_pct=0.01, risk_pct=1.0)
    # Trade 0 had +0.05 grossR, which is < 0.10R friction -> netR must be -0.05R (negative!)
    assert abs(enriched[0]["gross_r"] - 0.05) < 1e-6
    assert abs(enriched[0]["friction_r"] - 0.10) < 1e-6
    assert abs(enriched[0]["net_r"] - (-0.05)) < 1e-6

    out = build_performance_and_robustness(enriched, fee_pct=0.04, slippage_pct=0.01, risk_per_trade_pct=1.0)
    expected_sum_net = round(sum(tr["net_r"] for tr in enriched), 4)
    assert abs(out["friction"]["net_R_after_friction"] - expected_sum_net) < 1e-4
    assert out["robustness"]["data_sufficiency_status"] == "STATISTICALLY_SIGNIFICANT"
    assert out["robustness"]["trade_count_sufficiency_warning"] is False

    coach = build_coach_report(enriched, [])
    assert coach["data_sufficiency_status"] == "STATISTICALLY_SIGNIFICANT"
    assert coach["final_verdict"] != "NEEDS_MORE_DATA"

