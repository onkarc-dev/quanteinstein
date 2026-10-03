"""Test Supabase JWT authentication and user provisioning."""
import time
import unittest
import jwt
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_conn


class TestSupabaseAuth(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user_id = "test-supabase-user-uuid-1234"
        self.email = "trader-supabase@test.com"

    def test_supabase_token_authenticates_and_provisions_user(self):
        # Create a mock Supabase JWT
        payload = {
            "iss": "https://fbfnlpylhfyeqlpzgebq.supabase.co/auth/v1",
            "sub": self.user_id,
            "aud": "authenticated",
            "role": "authenticated",
            "email": self.email,
            "exp": int(time.time()) + 3600,
            "user_metadata": {"name": "Supabase Trader"},
        }
        token = jwt.encode(payload, "dummy-secret-key", algorithm="HS256")

        # Test GET /strategies with this token
        headers = {"Authorization": f"Bearer {token}"}
        res = self.client.get("/strategies", headers=headers)
        self.assertEqual(res.status_code, 200)

        # Test POST /strategies with this token
        strat_payload = {
            "name": "Supabase Test Strategy",
            "symbols": ["BTCUSDT"],
            "timeframe": "1m",
            "user_strategy_id": "TEST_SUPABASE_STRAT",
            "strategy": {"lookback": 20},
        }
        res_create = self.client.post("/strategies", json=strat_payload, headers=headers)
        self.assertEqual(res_create.status_code, 200)
        data = res_create.json()
        self.assertEqual(data["user_strategy_id"], "TEST_SUPABASE_STRAT")

        # Second create with same ID should update (idempotent 200, not 409)
        res_create_again = self.client.post("/strategies", json=strat_payload, headers=headers)
        self.assertEqual(res_create_again.status_code, 200)

        # Verify user was saved in db
        with get_conn() as conn:
            row = conn.execute("SELECT id, email, name FROM users WHERE id = ?", (self.user_id,)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["email"], self.email)
            self.assertEqual(row["name"], "Supabase Trader")


if __name__ == "__main__":
    unittest.main()
