import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("QUANTOS_MANAGED_LIVE", "1")

from app.main import app
from app.db import get_primary_conn


class TestInstitutionalFixExecution:
    client = TestClient(app)
    retail_id = "test_exec_retail_user"
    retail_token = "qe_tok_retail_test_123"
    enterprise_id = "test_exec_enterprise_user"
    enterprise_token = "qe_tok_enterprise_test_456"

    @pytest.fixture(autouse=True)
    def setup_users(self):
        with get_primary_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO users (id, email, password_hash, tier, name, onboarding_completed, created_at)
                VALUES (?, ?, ?, ?, ?, 1, '2026-01-01T00:00:00Z')
                """,
                (self.retail_id, "retail_trader@example.com", "hash", "RETAIL", "Retail Student"),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at)
                VALUES (?, ?, '2099-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
                """,
                (self.retail_token, self.retail_id),
            )

            conn.execute(
                """
                INSERT OR REPLACE INTO users (id, email, password_hash, tier, name, onboarding_completed, created_at)
                VALUES (?, ?, ?, ?, ?, 1, '2026-01-01T00:00:00Z')
                """,
                (self.enterprise_id, "fund_manager@tier1alpha.com", "hash", "ENTERPRISE", "Hedge Fund PM"),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at)
                VALUES (?, ?, '2099-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
                """,
                (self.enterprise_token, self.enterprise_id),
            )
            conn.commit()

        yield

        with get_primary_conn() as conn:
            conn.execute("DELETE FROM enterprise_execution_settings WHERE user_id LIKE 'test_exec_%'")
            conn.execute("DELETE FROM fix_audit_trail WHERE user_id LIKE 'test_exec_%'")
            conn.execute("DELETE FROM sessions WHERE token IN (?, ?)", (self.retail_token, self.enterprise_token))
            conn.execute("DELETE FROM users WHERE id IN (?, ?)", (self.retail_id, self.enterprise_id))
            conn.commit()

    def test_retail_user_cannot_access_live_fix(self):
        headers = {"Authorization": f"Bearer {self.retail_token}"}

        # 1. Retail execution status is strictly SIMULATED
        res = self.client.get("/api/v1/execution/status", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["tier"] == "RETAIL"
        assert data["execution_mode"] == "SIMULATED"
        assert data["can_trade_live"] is False
        assert data["available_modes"] == ["SIMULATED"]

        # 2. Retail user trying to enable LIVE_FIX must receive 403 Forbidden
        res_mode = self.client.post("/api/v1/execution/mode", json={"mode": "LIVE_FIX"}, headers=headers)
        assert res_mode.status_code == 403
        assert "restricted to Enterprise Tier" in res_mode.json()["detail"]

        # 3. Retail user trying to select prime broker must receive 403 Forbidden
        res_pb = self.client.post("/api/v1/execution/prime-broker", json={"broker_id": "GS_GSET"}, headers=headers)
        assert res_pb.status_code == 403

        # 4. Retail user submitting order is routed to simulator
        start_res = self.client.post(
            "/live-paper/start",
            json={"symbols": ["BTCUSDT"], "starting_balance": 100000.0},
            headers=headers,
        )
        assert start_res.status_code == 200

        order_res = self.client.post(
            "/live-paper/order",
            json={"symbol": "BTCUSDT", "side": "BUY", "qty": 0.5},
            headers=headers,
        )
        assert order_res.status_code == 200
        res_json = order_res.json()
        assert res_json.get("ok") is True
        assert res_json.get("execution_route") == "SIMULATOR"

    def test_enterprise_user_live_fix_lifecycle(self):
        headers = {"Authorization": f"Bearer {self.enterprise_token}"}

        # 1. Check initial Enterprise status
        res = self.client.get("/api/v1/execution/status", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["tier"] == "ENTERPRISE"
        assert data["execution_mode"] == "SIMULATED"
        assert data["can_trade_live"] is True
        assert "LIVE_FIX" in data["available_modes"]
        assert len(data["supported_brokers"]) >= 3

        # 2. Switch active Prime Broker to B2C2 Institutional
        pb_res = self.client.post(
            "/api/v1/execution/prime-broker",
            json={"broker_id": "B2C2_PRIME"},
            headers=headers,
        )
        assert pb_res.status_code == 200
        assert pb_res.json()["active_broker"]["id"] == "B2C2_PRIME"
        assert pb_res.json()["active_broker"]["target_comp_id"] == "B2C2_PROD_FIX"

        # 3. Toggle execution mode to LIVE_FIX
        mode_res = self.client.post(
            "/api/v1/execution/mode",
            json={"mode": "LIVE_FIX"},
            headers=headers,
        )
        assert mode_res.status_code == 200
        mode_data = mode_res.json()
        assert mode_data["execution_mode"] == "LIVE_FIX"
        assert mode_data["active_broker"]["status"] == "CONNECTED"
        assert mode_data["active_broker"]["protocol"] == "FIX.4.4"

        # 4. Submit Live Order via FIX Route
        order_res = self.client.post(
            "/api/v1/execution/order",
            json={"symbol": "BTCUSDT", "side": "BUY", "qty": 0.75, "order_type": "MARKET"},
            headers=headers,
        )
        assert order_res.status_code == 200
        trade = order_res.json()
        assert trade["ok"] is True
        assert trade["execution_route"] == "LIVE_FIX"
        assert trade["status"] == "FILLED"
        assert trade["symbol"] == "BTCUSDT"
        assert trade["side"] == "BUY"
        assert trade["qty"] == 0.75
        assert trade["fill_price"] > 0
        assert trade["broker_order_id"].startswith("PB-QE-FIX-")
        assert trade["fix_details"]["version"] == "FIX.4.4"
        assert trade["fix_details"]["msg_type"] == "8"
        assert trade["fix_details"]["total_latency_us"] > 0
        assert "B2C2" in trade["prime_broker"]

        # 5. Check FIX Audit Trail (SOC 2 / regulatory compliance log)
        audit_res = self.client.get("/api/v1/execution/audit-trail?limit=10", headers=headers)
        assert audit_res.status_code == 200
        audit_logs = audit_res.json()["audit_logs"]
        assert len(audit_logs) >= 1
        latest = audit_logs[0]
        assert latest["symbol"] == "BTCUSDT"
        assert latest["side"] == "BUY"
        assert latest["msg_type"] == "8"
        assert latest["latency_us"] > 0

        # 6. Test Fat-Finger protection (exceeding $1,000,000 ceiling)
        fat_finger_res = self.client.post(
            "/api/v1/execution/order",
            json={"symbol": "BTCUSDT", "side": "BUY", "qty": 50000.0},
            headers=headers,
        )
        assert fat_finger_res.status_code == 400
        assert "fat-finger limit" in fat_finger_res.json()["detail"].lower()

        # 7. Switch back to SIMULATED
        switch_back = self.client.post(
            "/api/v1/execution/mode",
            json={"mode": "SIMULATED"},
            headers=headers,
        )
        assert switch_back.status_code == 200
        assert switch_back.json()["execution_mode"] == "SIMULATED"
