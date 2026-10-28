import os
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

os.environ.setdefault("ENV", "development")
os.environ.setdefault("EMAIL_OTP_DEV_RETURN", "true")
os.environ.setdefault("PRISMFLOW_SECRET_KEY", "test-secret-key")
os.environ.setdefault("QUANTOS_MANAGED_LIVE", "1")
_tmp_dir = tempfile.TemporaryDirectory()
os.environ["DATABASE_PATH"] = str(Path(_tmp_dir.name) / "test_prismflow.db")
os.environ["OUTPUTS_ROOT"] = str(Path(_tmp_dir.name) / "outputs")

from fastapi.testclient import TestClient
from app.main import app


class HeadlessApiIntegrationTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        try:
            _tmp_dir.cleanup()
        except Exception:
            pass

    def setUp(self):
        self.client = TestClient(app)
        self.email = f"quant-{uuid4().hex[:10]}@alphacapital.com"
        self.password = "EnterpriseSecurePass123!"

    def _register_user(self):
        req = self.client.post(
            "/auth/register/request-otp",
            json={"email": self.email, "password": self.password, "name": "Lead Quant"},
        )
        self.assertEqual(req.status_code, 200, req.text)
        otp = req.json().get("otp")
        verify = self.client.post(
            "/auth/register/verify",
            json={"email": self.email, "otp": otp},
        )
        self.assertEqual(verify.status_code, 200, verify.text)
        return verify.json()

    def test_headless_api_lifecycle_and_execution(self):
        # 1. Authenticate user
        auth = self._register_user()
        jwt_token = auth["access_token"]
        jwt_headers = {"Authorization": f"Bearer {jwt_token}"}

        # 2. Generate an Enterprise Headless API Key
        key_req = self.client.post(
            "/api/v1/keys",
            json={
                "name": "Jupyter Alpha Research Cluster",
                "mode": "live",
                "permissions": ["data:read", "backtest:run", "orders:write"],
                "expires_in_days": 60,
            },
            headers=jwt_headers,
        )
        self.assertEqual(key_req.status_code, 200, key_req.text)
        key_data = key_req.json()["api_key"]
        api_key_id = key_data["id"]
        raw_secret_key = key_data["api_key_secret"]
        self.assertTrue(raw_secret_key.startswith("qe_live_"))
        self.assertEqual(key_data["name"], "Jupyter Alpha Research Cluster")

        # 3. List API Keys
        list_req = self.client.get("/api/v1/keys", headers=jwt_headers)
        self.assertEqual(list_req.status_code, 200)
        keys_list = list_req.json()["keys"]
        self.assertGreaterEqual(len(keys_list), 1)
        found = [k for k in keys_list if k["id"] == api_key_id]
        self.assertEqual(len(found), 1)
        self.assertNotIn("api_key_secret", found[0], "Raw API key secret leaked in listing!")

        # 4. Programmatic Authentication via X-API-Key Header
        api_headers = {"X-API-Key": raw_secret_key}

        # Fetch market symbols
        symbols_req = self.client.get("/api/v1/market-data/symbols", headers=api_headers)
        self.assertEqual(symbols_req.status_code, 200, symbols_req.text)
        catalog = symbols_req.json()["catalog"]
        self.assertIn("crypto", catalog)
        self.assertIn("BTCUSDT", catalog["crypto"])

        # Bad API key test
        bad_headers = {"X-API-Key": "qe_live_invalidkey1234567890abcdef"}
        bad_req = self.client.get("/api/v1/market-data/symbols", headers=bad_headers)
        self.assertEqual(bad_req.status_code, 401)

        # 5. Extract Historical OHLCV Candles for ML Pipelines
        ohlcv_req = self.client.get(
            "/api/v1/market-data/ohlcv?symbol=BTCUSDT&timeframe=1m&start_date=2026-06-01&end_date=2026-06-02&limit=50",
            headers=api_headers,
        )
        self.assertEqual(ohlcv_req.status_code, 200, ohlcv_req.text)
        ohlcv_data = ohlcv_req.json()
        self.assertEqual(ohlcv_data["symbol"], "BTCUSDT")
        self.assertGreater(ohlcv_data["count"], 0)
        first_bar = ohlcv_data["bars"][0]
        self.assertIn("open", first_bar)
        self.assertIn("high", first_bar)
        self.assertIn("low", first_bar)
        self.assertIn("close", first_bar)
        self.assertIn("volume", first_bar)

        # 6. Programmatic Backtest Submission & Execution
        backtest_req = self.client.post(
            "/api/v1/backtests/run",
            json={
                "strategy_name": "Headless Trend Breakout",
                "symbols": ["BTCUSDT"],
                "timeframe": "1m",
                "start_date": "2026-06-01",
                "end_date": "2026-06-05",
                "initial_capital": 100000.0,
                "strategy_config": {
                    "direction": "both",
                    "breakout_lookback": 20,
                    "risk": {"risk_per_trade_pct": 1.0},
                },
                "sync": True,
            },
            headers=api_headers,
        )
        self.assertEqual(backtest_req.status_code, 200, backtest_req.text)
        bt_data = backtest_req.json()
        self.assertIn("job_id", bt_data)
        job_id = bt_data["job_id"]

        # Fetch Backtest Results
        results_req = self.client.get(f"/api/v1/backtests/{job_id}/results", headers=api_headers)
        self.assertEqual(results_req.status_code, 200, results_req.text)
        res_data = results_req.json()
        self.assertEqual(res_data["job_id"], job_id)
        self.assertIn("summary", res_data)

        # 7. Programmatic Order Submission & Position Querying
        start_sess = self.client.post(
            "/api/v1/orders/session/start",
            json={"symbols": ["BTCUSDT", "ETHUSDT"], "starting_balance": 100000.0},
            headers=api_headers,
        )
        self.assertEqual(start_sess.status_code, 200, start_sess.text)

        # Ensure no open position on BTCUSDT before submitting
        self.client.post("/api/v1/positions/close", json={"symbol": "BTCUSDT"}, headers=api_headers)

        order_req = self.client.post(
            "/api/v1/orders",
            json={
                "symbol": "BTCUSDT",
                "side": "BUY",
                "qty": 0.5,
                "order_type": "MARKET",
            },
            headers=api_headers,
        )
        self.assertEqual(order_req.status_code, 200, order_req.text)
        self.assertEqual(order_req.json()["status"], "FILLED")

        positions_req = self.client.get("/api/v1/positions", headers=api_headers)
        self.assertEqual(positions_req.status_code, 200)
        pos_data = positions_req.json()
        self.assertIn("balance", pos_data)

        # 8. API Key Revocation
        revoke_req = self.client.delete(f"/api/v1/keys/{api_key_id}", headers=jwt_headers)
        self.assertEqual(revoke_req.status_code, 200)

        # Verify revoked key fails immediately
        revoked_check = self.client.get("/api/v1/market-data/symbols", headers=api_headers)
        self.assertEqual(revoked_check.status_code, 401)
