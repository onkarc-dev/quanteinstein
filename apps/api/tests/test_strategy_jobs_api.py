import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

os.environ.setdefault("ENV", "development")
os.environ.setdefault("EMAIL_OTP_DEV_RETURN", "true")
os.environ.setdefault("PRISMFLOW_SECRET_KEY", "test-secret-key")
_tmp_dir = tempfile.TemporaryDirectory()
os.environ["DB_FILE"] = str(Path(_tmp_dir.name) / "test_prismflow_jobs.db")
os.environ["OUTPUTS_ROOT"] = str(Path(_tmp_dir.name) / "outputs")

from fastapi.testclient import TestClient

from app.main import app


class StrategyJobsApiTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        try:
            _tmp_dir.cleanup()
        except Exception:
            pass

    def setUp(self):
        self.client = TestClient(app)
        self.email = f"jobs-{uuid4().hex[:12]}@example.com"
        self.password = "StrongPass123"
        self.token = self._register_and_login()
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def _register_and_login(self):
        req = self.client.post(
            "/auth/register/request-otp",
            json={"email": self.email, "password": self.password, "name": "Jobs Test"},
        )
        self.assertEqual(req.status_code, 200, req.text)
        otp = req.json().get("otp")
        verify = self.client.post(
            "/auth/register/verify",
            json={"email": self.email, "otp": otp},
        )
        self.assertEqual(verify.status_code, 200, verify.text)
        return verify.json()["access_token"]

    def _create_strategy(self):
        payload = {
            "user_strategy_id": f"STRAT_{uuid4().hex[:8]}",
            "name": "Integration Test Strategy",
            "symbols": ["BTCUSDT"],
            "timeframe": "1m",
            "bar_seconds": 60,
            "strategy": {
                "name": "Breakout Retest",
                "breakout_lookback": 20,
                "retest_tolerance_pct": 0.001,
                "min_setup_score": 6.5,
                "max_retest_bars": 30,
                "signal_cooldown_bars": 5,
                "ttl_bars": 40,
                "min_close_position": 0.5,
            },
        }
        resp = self.client.post("/strategies", json=payload, headers=self.headers)
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def test_strategy_create_list_get_and_submit_backtest(self):
        strategy = self._create_strategy()
        strategy_id = strategy["id"]

        listed = self.client.get("/strategies", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertTrue(any(s["id"] == strategy_id for s in listed.json()))

        fetched = self.client.get(f"/strategies/{strategy_id}", headers=self.headers)
        self.assertEqual(fetched.status_code, 200, fetched.text)
        self.assertEqual(fetched.json()["id"], strategy_id)

        fake_result = {
            "job_id": "patched-job-id",
            "status": "completed",
            "output_dir": str(Path(_tmp_dir.name) / "outputs" / "patched-job-id"),
            "summary": {"total_trades": 0},
            "trade_count": 0,
            "trades_available": True,
        }
        with patch("app.routes.jobs.run_engine_sync", return_value=fake_result):
            submitted = self.client.post(
                "/jobs/submit-backtest",
                json={
                    "strategy_id": strategy_id,
                    "symbols": ["BTCUSDT"],
                    "timeframe": "1m",
                    "config": {"source": "test"},
                },
                headers=self.headers,
            )
        self.assertEqual(submitted.status_code, 200, submitted.text)
        body = submitted.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["mode"], "sync_demo")

        jobs = self.client.get("/jobs/", headers=self.headers)
        self.assertEqual(jobs.status_code, 200, jobs.text)
        self.assertGreaterEqual(len(jobs.json().get("jobs", [])), 1)

    def test_multi_symbol_backtest_submits_async_without_blocking(self):
        create_res = self.client.post(
            "/strategies",
            json={
                "name": "Async Basket Test",
                "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
                "timeframe": "1m",
                "risk_per_trade_pct": 1.0,
            },
            headers=self.headers,
        )
        self.assertEqual(create_res.status_code, 200, create_res.text)
        strategy_id = create_res.json()["id"]

        with patch("app.routes.jobs.run_engine_sync") as mock_engine:
            submitted = self.client.post(
                "/jobs/submit-backtest",
                json={
                    "strategy_id": strategy_id,
                    "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
                    "timeframe": "1m",
                    "config": {"source": "test_multi"},
                },
                headers=self.headers,
            )
            self.assertEqual(submitted.status_code, 200, submitted.text)
            body = submitted.json()
            self.assertEqual(body["status"], "queued")
            self.assertIn("job_id", body)
            # Verify run_engine_sync was dispatched via background tasks
            mock_engine.assert_called_once()

            job_id = body["job_id"]
            job_status = self.client.get(f"/jobs/{job_id}", headers=self.headers)
            self.assertEqual(job_status.status_code, 200)
            self.assertEqual(job_status.json()["symbols"], ["BTCUSDT", "ETHUSDT", "SOLUSDT"])

    def test_strategy_requires_auth(self):
        resp = self.client.get("/strategies")
        self.assertIn(resp.status_code, {401, 403})


if __name__ == "__main__":
    unittest.main()
