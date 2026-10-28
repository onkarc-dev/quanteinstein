import os
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

os.environ.setdefault("ENV", "development")
os.environ.setdefault("EMAIL_OTP_DEV_RETURN", "true")
os.environ.setdefault("PRISMFLOW_SECRET_KEY", "test-secret-key")
_tmp_dir = tempfile.TemporaryDirectory()
os.environ["DB_FILE"] = str(Path(_tmp_dir.name) / "test_prismflow.db")
os.environ["OUTPUTS_ROOT"] = str(Path(_tmp_dir.name) / "outputs")

from fastapi.testclient import TestClient

from app.main import app
from app.db import get_conn


class EnterpriseTenantRoutingTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        try:
            _tmp_dir.cleanup()
        except Exception:
            pass

    def setUp(self):
        self.client = TestClient(app)
        self.retail_email = f"retail-{uuid4().hex[:10]}@example.com"
        self.enterprise_email = f"hedgefund-{uuid4().hex[:10]}@alphacapital.com"
        self.password = "EnterpriseUltraPass123!"

    def _register_retail(self):
        req = self.client.post(
            "/auth/register/request-otp",
            json={"email": self.retail_email, "password": self.password, "name": "Retail Trader"},
        )
        self.assertEqual(req.status_code, 200, req.text)
        otp = req.json().get("otp")
        verify = self.client.post(
            "/auth/register/verify",
            json={"email": self.retail_email, "otp": otp},
        )
        self.assertEqual(verify.status_code, 200, verify.text)
        return verify.json()

    def test_dual_tier_routing_and_isolation(self):
        # 1. Register retail user and verify shared multi-tenant defaults
        retail_auth = self._register_retail()
        retail_token = retail_auth["access_token"]
        retail_headers = {"Authorization": f"Bearer {retail_token}"}

        # Check retail profile
        retail_me = self.client.get("/auth/me", headers=retail_headers)
        self.assertEqual(retail_me.status_code, 200)
        self.assertEqual(retail_me.json()["tier"], "RETAIL")

        # Check tenant metadata for retail user
        retail_tenant = self.client.get("/enterprise/me", headers=retail_headers)
        self.assertEqual(retail_tenant.status_code, 200)
        retail_t_data = retail_tenant.json()
        self.assertEqual(retail_t_data["tier"], "RETAIL")
        self.assertEqual(retail_t_data["database_isolation"], "MULTI_TENANT_SHARED")

        # 2. Provision Enterprise Tenant (Single-Tenant isolated database)
        admin_headers = {"X-Admin-Key": "test-secret-key"}
        prov_req = self.client.post(
            "/enterprise/provision",
            json={
                "organization_name": "Alpha Horizon Quant Fund",
                "admin_email": self.enterprise_email,
                "admin_name": "Dr. Sarah Chen",
                "isolation_mode": "ISOLATED_SQLITE",
                "admin_password": self.password,
            },
            headers=admin_headers,
        )
        self.assertEqual(prov_req.status_code, 200, prov_req.text)
        prov_data = prov_req.json()["tenant"]
        self.assertEqual(prov_data["status"], "PROVISIONED")
        self.assertEqual(prov_data["tier"], "ENTERPRISE")
        self.assertTrue(prov_data["tenant_db_url"].startswith("sqlite:///"))

        # Verify organizations listing
        orgs_resp = self.client.get("/enterprise/organizations", headers=admin_headers)
        self.assertEqual(orgs_resp.status_code, 200)
        self.assertGreaterEqual(orgs_resp.json()["count"], 1)

        # 3. Login as Enterprise Admin
        ent_login = self.client.post(
            "/auth/login",
            json={"email": self.enterprise_email, "password": self.password},
        )
        self.assertEqual(ent_login.status_code, 200, ent_login.text)
        ent_auth = ent_login.json()
        ent_token = ent_auth["access_token"]
        self.assertEqual(ent_auth["user"]["tier"], "ENTERPRISE")
        self.assertEqual(ent_auth["user"]["role"], "ORG_ADMIN")
        ent_headers = {"Authorization": f"Bearer {ent_token}"}

        # 4. Check Enterprise Tenant Routing & Health
        ent_me = self.client.get("/enterprise/me", headers=ent_headers)
        self.assertEqual(ent_me.status_code, 200)
        ent_t_data = ent_me.json()
        self.assertEqual(ent_t_data["tier"], "ENTERPRISE")
        self.assertEqual(ent_t_data["database_isolation"], "SINGLE_TENANT_ISOLATED")
        self.assertTrue(ent_t_data["active_tenant_db_url"].startswith("sqlite:///"))

        health_resp = self.client.get("/enterprise/health", headers=ent_headers)
        self.assertEqual(health_resp.status_code, 200)
        self.assertEqual(health_resp.json()["health"]["status"], "HEALTHY")

        # 5. Verify Data Isolation
        # Enterprise user creates a strategy
        strat_resp = self.client.post(
            "/strategies",
            json={
                "name": "Institutional Arbitrage V1",
                "kind": "alpha",
                "symbols": ["BTCUSDT", "ETHUSDT"],
                "parameters": {"lookback": 20, "zscore_threshold": 2.5},
            },
            headers=ent_headers,
        )
        self.assertEqual(strat_resp.status_code, 200, strat_resp.text)
        created_strategy = strat_resp.json()
        strategy_id = created_strategy["id"]

        # Strategy must exist in the enterprise isolated tenant database
        ent_strats = self.client.get("/strategies", headers=ent_headers)
        self.assertEqual(ent_strats.status_code, 200)
        ent_ids = [s["id"] for s in ent_strats.json()]
        self.assertIn(strategy_id, ent_ids)

        # Check primary shared database directly: the strategy MUST NOT be in the shared database
        with get_conn() as primary_conn:
            shared_row = primary_conn.execute(
                "SELECT id, name FROM strategies WHERE id = ?", (strategy_id,)
            ).fetchone()
            self.assertIsNone(shared_row, "Enterprise strategy leaked into retail shared database!")
