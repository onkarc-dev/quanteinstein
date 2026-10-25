"""Unit and integration tests for Institutional Quant OS v3 modules."""
import unittest
import sys
from pathlib import Path

# Add api package to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "api"))

from app.services.quant_universe import (
    AssetMetadata,
    UniverseFilter,
    UniverseFilterEngine,
    CrossSectionalAllocationEngine,
    RebalanceTriggerConfig,
)
from app.services.ast_evaluator import (
    ASTConditionEvaluator,
    RuleGroup,
    SingleRule,
    MultiTimeframeSnapshot,
)
from app.services.friction_engine import (
    MicrostructureExecutionEngine,
    BarData,
    ActiveOrder,
    ExecutionFrictionConfig,
)
from app.services.risk_orchestrator import (
    PropFirmRiskOrchestrator,
    PropFirmRuleConfig,
    TrailingDrawdownType,
    DrawdownBreachType,
)
from app.services.monte_carlo_suite import (
    MonteCarloStressTester,
    MonteCarloConfig,
)
from fastapi.testclient import TestClient
from app.main import app


class TestUniverseAndAllocationEngine(unittest.TestCase):
    def test_universe_filtering(self):
        engine = UniverseFilterEngine()
        flt = UniverseFilter(
            min_24h_volume=1_000_000,
            max_realized_volatility=1.0,
            asset_classes=["crypto", "futures"],
        )
        passed = engine.filter_universe(flt)
        self.assertGreater(len(passed), 0)
        for asset in passed:
            self.assertGreaterEqual(asset.volume_24h, 1_000_000)
            self.assertIn(asset.asset_class.lower(), ["crypto", "futures"])

    def test_equal_weight_allocation(self):
        symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "NQ"]
        weights = CrossSectionalAllocationEngine.equal_weight(symbols)
        self.assertEqual(len(weights), 4)
        for s in symbols:
            self.assertAlmostEqual(weights[s], 0.25, places=4)
        self.assertAlmostEqual(sum(weights.values()), 1.0, places=4)

    def test_inverse_volatility_risk_parity(self):
        # 4 assets with different volatilities (ATRs)
        vols = {
            "LOW_VOL": 0.01,
            "MED_VOL": 0.02,
            "HIGH_VOL": 0.04,
            "EXTREME_VOL": 0.08,
        }
        weights = CrossSectionalAllocationEngine.inverse_volatility_risk_parity(vols)
        self.assertAlmostEqual(sum(weights.values()), 1.0, places=4)
        # Lowest vol asset should have the highest weight
        self.assertGreater(weights["LOW_VOL"], weights["MED_VOL"])
        self.assertGreater(weights["MED_VOL"], weights["HIGH_VOL"])
        self.assertGreater(weights["HIGH_VOL"], weights["EXTREME_VOL"])

    def test_drift_rebalance_trigger(self):
        target = {"BTC": 0.5, "ETH": 0.5}
        current_no_drift = {"BTC": 0.52, "ETH": 0.48}
        cfg = RebalanceTriggerConfig(drift_threshold=0.05)
        
        # 2% drift < 5% threshold -> False
        self.assertFalse(CrossSectionalAllocationEngine.check_rebalance_trigger(target, current_no_drift, cfg))
        
        # 7% drift > 5% threshold -> True
        current_with_drift = {"BTC": 0.57, "ETH": 0.43}
        self.assertTrue(CrossSectionalAllocationEngine.check_rebalance_trigger(target, current_with_drift, cfg))


class TestASTConditionEvaluator(unittest.TestCase):
    def setUp(self):
        self.evaluator = ASTConditionEvaluator()
        self.market_data = {
            "RSI_14": 75.0,
            "EMA_20": 105.0,
            "SMA_50": 100.0,
            "close": 106.0,
        }

    def test_single_rule_evaluation(self):
        rule = SingleRule(left_operand="RSI_14", operator=">", right_operand=70.0)
        self.assertTrue(self.evaluator.evaluate_leaf(rule, self.market_data))

        rule_false = SingleRule(left_operand="RSI_14", operator="<", right_operand=70.0)
        self.assertFalse(self.evaluator.evaluate_leaf(rule_false, self.market_data))

    def test_nested_boolean_groups(self):
        # (RSI > 70 AND EMA_20 > SMA_50)
        group_and = RuleGroup(
            logical_operator="AND",
            children=[
                SingleRule(left_operand="RSI_14", operator=">", right_operand=70.0),
                SingleRule(left_operand="EMA_20", operator=">", right_operand="SMA_50"),
            ]
        )
        self.assertTrue(self.evaluator.evaluate_group(group_and, self.market_data))

        # (NOT (close < 100)) -> True
        group_not = RuleGroup(
            logical_operator="NOT",
            children=[
                SingleRule(left_operand="close", operator="<", right_operand=100.0)
            ]
        )
        self.assertTrue(self.evaluator.evaluate_group(group_not, self.market_data))

    def test_synthetic_spread_zscore(self):
        # Two perfectly correlated series with fixed offset
        series_a = [100.0 + i * 2.0 for i in range(30)]
        series_b = [50.0 + i * 1.0 for i in range(30)]
        
        beta, spread, zscore = self.evaluator.compute_synthetic_spread_zscore(series_a, series_b, lookback=20)
        self.assertAlmostEqual(beta, 2.0, places=1)
        self.assertEqual(len(spread), 30)
        self.assertEqual(len(zscore), 30)


class TestMicrostructureAndFrictionEngine(unittest.TestCase):
    def setUp(self):
        self.engine = MicrostructureExecutionEngine()

    def test_cme_contract_specs(self):
        nq_spec = self.engine.get_contract_spec("NQ")
        self.assertEqual(nq_spec.tick_size, 0.25)
        self.assertEqual(nq_spec.tick_value, 5.0)

        es_spec = self.engine.get_contract_spec("ES")
        self.assertEqual(es_spec.tick_size, 0.25)
        self.assertEqual(es_spec.tick_value, 12.50)

    def test_futures_pnl_calculation(self):
        # Long 1 NQ contract from 20000.0 to 20010.0 (10 points = 40 ticks * $5 = $200 gross)
        pnl = self.engine.calculate_pnl("NQ", "LONG", 20000.0, 20010.0, quantity=1.0)
        self.assertAlmostEqual(pnl, 200.0, places=2)

    def test_pessimistic_intra_bar_collision(self):
        # Bar spans 95.0 to 105.0. Open = 100.0
        # Long position with TP = 104.0 and SL = 96.0
        # Both TP and SL fall inside the bar's [Low, High] range!
        # Pessimistic model MUST assume Stop-Loss is hit first.
        bar = BarData(open=100.0, high=105.0, low=95.0, close=102.0, volume=1000)
        order = ActiveOrder(side="LONG", entry_price=100.0, take_profit=104.0, stop_loss=96.0)
        friction = ExecutionFrictionConfig(pessimistic_intra_bar=True, base_spread_bps=1.0, slippage_ticks=1)

        result = self.engine.simulate_bar_execution(bar, order, friction, "BTCUSDT")
        self.assertTrue(result.triggered)
        self.assertEqual(result.event_type, "STOP_LOSS")
        self.assertLess(result.fill_price, 96.0)  # Slippage factored in

    def test_crypto_funding_fee(self):
        # 1 BTC position at $50,000, funding rate +0.01% (0.0001)
        fee = self.engine.calculate_funding_fee(position_value=50000.0, funding_rate=0.0001)
        self.assertAlmostEqual(fee, 5.0, places=2)


class TestPropFirmRiskOrchestrator(unittest.TestCase):
    def test_intraday_trailing_hwm_breach(self):
        # Account size 100,000, Max Trailing DD: 5% ($5,000)
        rule = PropFirmRuleConfig(
            starting_balance=100000.0,
            trailing_drawdown_type=TrailingDrawdownType.INTRADAY_PEAK_HWM,
            max_trailing_drawdown_pct=0.05,
            daily_loss_limit_pct=0.04,
        )
        orchestrator = PropFirmRiskOrchestrator(rule)

        # Equity climbs to $110,000 (New HWM). Breach floor becomes 110,000 * 0.95 = $104,500
        state = orchestrator.update_equity(intraday_equity=110000.0, closed_balance=110000.0)
        self.assertFalse(state.is_breached)
        self.assertAlmostEqual(state.current_hwm, 110000.0)
        self.assertAlmostEqual(state.trailing_drawdown_floor, 104500.0)

        # Equity drops to $104,000 -> Below floor $104,500 -> Breached!
        state_breach = orchestrator.update_equity(intraday_equity=104000.0, closed_balance=107000.0)
        self.assertTrue(state_breach.is_breached)
        self.assertEqual(state_breach.breach_type, DrawdownBreachType.MAX_TRAILING_BREACH)

    def test_daily_loss_limit_trip(self):
        rule = PropFirmRuleConfig(
            starting_balance=100000.0,
            trailing_drawdown_type=TrailingDrawdownType.CLOSED_BALANCE_EOD,
            max_trailing_drawdown_pct=0.10,
            daily_loss_limit_pct=0.04, # 4% daily limit = $4,000 max daily loss
        )
        orchestrator = PropFirmRiskOrchestrator(rule)
        
        # Day starts at $100,000. Day drops to $95,500 ($4,500 loss > $4,000 limit)
        state = orchestrator.update_equity(intraday_equity=95500.0, closed_balance=95500.0)
        self.assertTrue(state.is_breached)
        self.assertEqual(state.breach_type, DrawdownBreachType.DAILY_LOSS_BREACH)


class TestMonteCarloSuite(unittest.TestCase):
    def test_stationary_block_bootstrap(self):
        # 50 sample trade returns
        returns = [0.02, -0.01, 0.03, -0.015, 0.04, -0.01, 0.005, -0.02] * 6
        config = MonteCarloConfig(
            num_simulations=200,
            expected_block_size=5,
            initial_balance=100000.0,
            max_allowed_drawdown_pct=0.08,
        )
        report = MonteCarloStressTester.run_stationary_block_bootstrap(returns, config)

        self.assertEqual(report.total_simulations, 200)
        self.assertIn("p5", report.drawdown_distribution_pct)
        self.assertIn("p50", report.drawdown_distribution_pct)
        self.assertIn("p95", report.drawdown_distribution_pct)
        self.assertGreaterEqual(report.prop_firm_breach_probability, 0.0)
        self.assertLessEqual(report.prop_firm_breach_probability, 1.0)
        self.assertGreater(len(report.histogram_bins), 0)


class TestQuantEngineAPIEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_api_screen_universe(self):
        payload = {
            "min_24h_volume": 5000000,
            "max_realized_volatility": 0.8,
            "asset_classes": ["crypto", "forex"]
        }
        res = self.client.post("/quant-engine/universe/screen", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("universe", data)
        self.assertGreater(len(data["universe"]), 0)

    def test_api_calculate_allocation(self):
        payload = {
            "mode": "risk_parity",
            "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
            "volatilities": {"BTCUSDT": 0.04, "ETHUSDT": 0.05, "SOLUSDT": 0.08}
        }
        res = self.client.post("/quant-engine/allocation/calculate", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("weights", data)
        self.assertAlmostEqual(sum(data["weights"].values()), 1.0, places=3)

    def test_api_contract_spec(self):
        res = self.client.get("/quant-engine/friction/contract-spec/NQ")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["symbol"], "NQ")
        self.assertEqual(data["tick_value"], 5.0)

    def test_api_monte_carlo(self):
        payload = {
            "returns": [0.015, -0.01, 0.025, -0.008, 0.03, -0.012, 0.02, -0.01],
            "num_simulations": 100,
            "expected_block_size": 3,
            "initial_balance": 100000.0,
            "max_allowed_drawdown_pct": 0.06
        }
        res = self.client.post("/quant-engine/monte-carlo/run", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_simulations"], 100)
        self.assertIn("prop_firm_breach_probability", data)
        self.assertIn("percentiles", data)


if __name__ == "__main__":
    unittest.main()
