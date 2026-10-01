"""Tests for configuration and database layer."""
import unittest
import tempfile
import os
import sys
from pathlib import Path

# Add api app to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "api"))

from app.core.config import Settings
from app import db


class TestSettings(unittest.TestCase):
    """Test configuration loading."""

    def test_settings_defaults_to_sqlite(self):
        os.environ.pop("DATABASE_URL", None)
        settings = Settings()
        self.assertEqual(settings.db_backend, "sqlite")
        self.assertFalse(settings.is_postgres())

    def test_settings_recognizes_postgres(self):
        os.environ["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/test"
        settings = Settings()
        self.assertEqual(settings.db_backend, "postgresql")
        self.assertTrue(settings.is_postgres())
        os.environ.pop("DATABASE_URL")

    def test_settings_has_redis_flag(self):
        os.environ.pop("REDIS_URL", None)
        settings = Settings()
        self.assertFalse(settings.has_redis())
        os.environ["REDIS_URL"] = "redis://localhost:6379/0"
        settings = Settings()
        self.assertTrue(settings.has_redis())
        os.environ.pop("REDIS_URL")

    def test_settings_safe_mode_always_true(self):
        settings = Settings()
        self.assertTrue(settings.safe_mode)
        self.assertFalse(settings.real_money_enabled)
        self.assertFalse(settings.broker_integration_enabled)


class TestDB(unittest.TestCase):
    """Test database layer (SQLite only, since no postgres in test env)."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        os.environ["DATABASE_PATH"] = "test.db"
        # Reset settings to use temp dir
        from app.core import config
        config.settings.api_root = Path(self.tmpdir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_db_init_creates_tables(self):
        db.init_db()
        conn = db.get_conn()
        # Check users table exists
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        self.assertIsNotNone(cursor.fetchone())
        conn.close()

    def test_db_seeds_demo_user(self):
        db.init_db()
        conn = db.get_conn()
        row = conn.execute("SELECT id, email FROM users WHERE id='demo_user'").fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row_to_dict(row)["email"], "demo@prismflow.com")
        conn.close()

    def test_hash_password_consistency(self):
        h1 = db.hash_password("test123")
        h2 = db.hash_password("test123")
        self.assertTrue(db.verify_password("test123", h1))
        self.assertTrue(db.verify_password("test123", h2))
        self.assertFalse(db.verify_password("wrong", h1))
        # Unique salts ensure distinct hash representations
        self.assertNotEqual(h1, h2)

    def test_now_returns_iso_string(self):
        n = db.now()
        self.assertIn("T", n)
        self.assertIn("Z", n)


def row_to_dict(row):
    if isinstance(row, dict):
        return row
    return dict(row)


if __name__ == "__main__":
    unittest.main()
