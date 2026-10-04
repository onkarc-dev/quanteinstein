import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app


class StrategyNameDisambiguationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.email = f"disambig-{uuid4().hex[:12]}@example.com"
        self.password = "StrongPass123"
        self.token = self._register_and_login()
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def _register_and_login(self):
        req = self.client.post(
            "/auth/register/request-otp",
            json={"email": self.email, "password": self.password, "name": "Disambig Test"},
        )
        self.assertEqual(req.status_code, 200, req.text)
        otp = req.json().get("otp")
        verify = self.client.post(
            "/auth/register/verify",
            json={"email": self.email, "otp": otp},
        )
        self.assertEqual(verify.status_code, 200, verify.text)
        return verify.json()["access_token"]

    def test_same_strategy_name_disambiguation(self):
        # 1st creation: "PRISM"
        p1 = {
            "name": "PRISM",
            "symbols": ["BTCUSDT"],
            "timeframe": "1m",
            "strategy": {"direction": "both"},
        }
        res1 = self.client.post("/strategies", json=p1, headers=self.headers)
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertEqual(data1["name"], "PRISM")
        self.assertEqual(data1["display_name"], "PRISM")

        # 2nd creation: same name "PRISM"
        p2 = {
            "name": "PRISM",
            "symbols": ["ETHUSDT"],
            "timeframe": "5m",
            "strategy": {"direction": "long_only"},
        }
        res2 = self.client.post("/strategies", json=p2, headers=self.headers)
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data2["name"], "PRISM (1)")
        self.assertEqual(data2["display_name"], "PRISM (1)")

        # 3rd creation: same name "PRISM"
        p3 = {
            "name": "PRISM",
            "symbols": ["SOLUSDT"],
            "timeframe": "15m",
            "strategy": {"direction": "both"},
        }
        res3 = self.client.post("/strategies", json=p3, headers=self.headers)
        self.assertEqual(res3.status_code, 200)
        data3 = res3.json()
        self.assertEqual(data3["name"], "PRISM (2)")
        self.assertEqual(data3["display_name"], "PRISM (2)")

        # Verify listing has all three disambiguated properly
        list_res = self.client.get("/strategies", headers=self.headers)
        self.assertEqual(list_res.status_code, 200)
        items = list_res.json()
        self.assertEqual(len(items), 3)
        # Newest first
        self.assertEqual(items[0]["display_name"], "PRISM (2)")
        self.assertEqual(items[1]["display_name"], "PRISM (1)")
        self.assertEqual(items[2]["display_name"], "PRISM")


if __name__ == "__main__":
    unittest.main()
