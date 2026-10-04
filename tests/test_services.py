"""Tests for core services."""
import unittest
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "api"))

from app.services.production_readiness import readiness_check


class TestProductionReadiness(unittest.TestCase):
    """Test production readiness checker."""

    def test_readiness_check_returns_structured_result(self):
        result = readiness_check()
        self.assertIn("score_out_of_10", result)
        self.assertIn("checks_passed", result)
        self.assertIn("checks_total", result)
        self.assertIn("production_ready", result)
        self.assertIn("honest_verdict", result)
        self.assertIn("checks", result)

    def test_readiness_has_critical_checks(self):
        result = readiness_check()
        critical = [c for c in result["checks"] if c["severity"] == "critical"]
        self.assertGreater(len(critical), 0)
        # Critical checks include: safe_mode, no real-money, BTC-only scope
        verdicts = [c["check"] for c in critical]
        self.assertIn("No real-money execution", verdicts)
        self.assertIn("BTC-only paper/backtest scope", verdicts)

    def test_readiness_honest_verdict(self):
        result = readiness_check()
        verdict = result["honest_verdict"]
        self.assertIn(verdict, [
            "PRODUCTION_CANDIDATE",
            "STRONG_MVP_NEEDS_HARDENING",
            "SOLID_LOCAL_DEMO",
            "EARLY_MVP",
        ])

    def test_readiness_detects_missing_engine_binary(self):
        """Readiness should detect if C++ binary is missing (but not fail)."""
        result = readiness_check()
        engine_checks = [c for c in result["checks"] if "engine" in c["area"].lower()]
        self.assertGreater(len(engine_checks), 0)


class TestEngine(unittest.TestCase):
    """Test engine runner error handling (minimal — full test requires binary)."""

    def test_engine_error_categorization(self):
        from app.services.engine_runner import _classify_engine_error
        # Test error classification
        category = _classify_engine_error(1, "not found", "")
        self.assertEqual(category, "binary_not_found")
        category = _classify_engine_error(124, "", "timeout")
        self.assertEqual(category, "engine_timeout")
        category = _classify_engine_error(139, "Segmentation fault", "")
        self.assertEqual(category, "engine_crash_segfault")

    def test_compute_symbol_breakdown(self):
        from app.services.engine_runner import compute_symbol_breakdown
        trades = [
            {"symbol": "BTCUSDT", "r_multiple": 2.0},
            {"symbol": "BTCUSDT", "r_multiple": -1.0},
            {"symbol": "ETHUSDT", "r_multiple": 1.5},
            {"symbol": "ETHUSDT", "r_multiple": 0.5},
        ]
        breakdown = compute_symbol_breakdown(trades, expected_symbols=["BTCUSDT", "ETHUSDT", "SOLUSDT"])
        self.assertIn("BTCUSDT", breakdown)
        self.assertIn("ETHUSDT", breakdown)
        self.assertIn("SOLUSDT", breakdown)
        self.assertEqual(breakdown["BTCUSDT"]["trades"], 2)
        self.assertEqual(breakdown["BTCUSDT"]["wins"], 1)
        self.assertEqual(breakdown["BTCUSDT"]["losses"], 1)
        self.assertAlmostEqual(breakdown["BTCUSDT"]["gross_R"], 1.0)
        self.assertEqual(breakdown["ETHUSDT"]["trades"], 2)
        self.assertEqual(breakdown["ETHUSDT"]["wins"], 2)
        self.assertEqual(breakdown["SOLUSDT"]["trades"], 0)

    def test_write_trade_log_csv(self):
        import tempfile
        from app.services.engine_runner import write_trade_log_csv
        from app.services.output_reader import read_csv
        trades = [
            {
                "trade_id": 1,
                "symbol": "BTCUSDT",
                "entry_time": "2026-10-01 10:00:00",
                "entry_price": 85000.0,
                "exit_time": "2026-10-01 10:15:00",
                "exit_price": 86000.0,
                "exit_reason": "TARGET1_HIT",
                "r_multiple": 1.85,
            }
        ]
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f:
            p = Path(f.name)
        try:
            write_trade_log_csv(trades, p)
            read_back = read_csv(p)
            self.assertEqual(len(read_back), 1)
            self.assertEqual(read_back[0]["symbol"], "BTCUSDT")
            self.assertEqual(read_back[0]["exit_reason"], "TARGET1_HIT")
        finally:
            if p.exists():
                p.unlink()


if __name__ == "__main__":
    unittest.main()
