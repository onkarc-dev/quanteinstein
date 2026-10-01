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


class AuthApiIntegrationTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        try:
            _tmp_dir.cleanup()
        except Exception:
            pass

    def setUp(self):
        self.client = TestClient(app)
        self.email = f"auth-{uuid4().hex[:12]}@example.com"
        self.password = "StrongPass123"

    def _register_user(self):
        req = self.client.post(
            "/auth/register/request-otp",
            json={"email": self.email, "password": self.password, "name": "Auth Test"},
        )
        self.assertEqual(req.status_code, 200, req.text)
        otp = req.json().get("otp")
        self.assertTrue(otp)
        verify = self.client.post(
            "/auth/register/verify",
            json={"email": self.email, "otp": otp},
        )
        self.assertEqual(verify.status_code, 200, verify.text)
        return verify.json()

    def test_register_login_refresh_logout_flow(self):
        registered = self._register_user()
        self.assertIn("access_token", registered)
        self.assertIn("refresh_token", registered)

        bad = self.client.post(
            "/auth/login",
            json={"email": self.email, "password": "wrong-password"},
        )
        self.assertEqual(bad.status_code, 401)

        login = self.client.post(
            "/auth/login",
            json={"email": self.email, "password": self.password},
        )
        self.assertEqual(login.status_code, 200, login.text)
        body = login.json()
        self.assertIn("access_token", body)
        self.assertIn("refresh_token", body)

        refresh = self.client.post(
            "/auth/refresh",
            json={"refresh_token": body["refresh_token"]},
        )
        self.assertEqual(refresh.status_code, 200, refresh.text)
        rotated = refresh.json()
        self.assertIn("access_token", rotated)
        self.assertIn("refresh_token", rotated)
        self.assertNotEqual(body["refresh_token"], rotated["refresh_token"])

        replay_old_refresh = self.client.post(
            "/auth/refresh",
            json={"refresh_token": body["refresh_token"]},
        )
        self.assertEqual(replay_old_refresh.status_code, 401)

        logout = self.client.post(
            "/auth/logout",
            headers={"Authorization": f"Bearer {rotated['access_token']}"},
        )
        self.assertEqual(logout.status_code, 200, logout.text)

        revoked_refresh = self.client.post(
            "/auth/refresh",
            json={"refresh_token": rotated["refresh_token"]},
        )
        self.assertEqual(revoked_refresh.status_code, 401)

    def test_register_rejects_weak_password(self):
        resp = self.client.post(
            "/auth/register/request-otp",
            json={"email": self.email, "password": "123", "name": "Weak"},
        )
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
