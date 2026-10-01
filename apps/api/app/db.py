"""PRISMFlow database layer.

Supports:
- SQLite (default, zero-config, used for local demo and CI)
- PostgreSQL (production, set DATABASE_URL=postgresql://...)

The public interface is the same for both backends:
    get_conn()   -> context manager returning a connection-like object
    init_db()    -> idempotent schema creation
    row_to_dict()
    hash_password()
    verify_password()
    now()
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict
import uuid
import json

from app.core.config import settings

PBKDF2_PREFIX = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 260_000
SCHEMA_VERSION = "0001_init"
_LAST_SQLITE_INIT_PATH: str | None = None


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def hash_password(password: str, salt: bytes | None = None) -> str:
    """Hash a password using stdlib PBKDF2-SHA256 with a cryptographically secure random salt."""
    if salt is None:
        salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "$".join(
        [
            PBKDF2_PREFIX,
            str(PBKDF2_ITERATIONS),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False
    if stored_hash.startswith(PBKDF2_PREFIX + "$"):
        try:
            _, iterations_raw, salt_raw, digest_raw = stored_hash.split("$", 3)
            iterations = int(iterations_raw)
            salt = base64.b64decode(salt_raw.encode("ascii"))
            expected = base64.b64decode(digest_raw.encode("ascii"))
            actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
            return hmac.compare_digest(actual, expected)
        except Exception:
            return False
    # Backward compatibility for legacy deterministic or pre-hardening SHA-256 hashes.
    try:
        pepper = settings.secret_key.encode("utf-8")
        legacy_salt = hmac.new(pepper, password.encode("utf-8"), hashlib.sha256).digest()[:16]
        legacy_digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), legacy_salt, PBKDF2_ITERATIONS)
        legacy_pbkdf2 = "$".join([
            PBKDF2_PREFIX,
            str(PBKDF2_ITERATIONS),
            base64.b64encode(legacy_salt).decode("ascii"),
            base64.b64encode(legacy_digest).decode("ascii"),
        ])
        if hmac.compare_digest(legacy_pbkdf2, stored_hash):
            return True
    except Exception:
        pass
    legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return hmac.compare_digest(legacy, stored_hash)


def row_to_dict(row) -> Dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        return row
    return dict(row)


# ─── Backend selection ────────────────────────────────────────────────────────

def get_conn():
    """Return an appropriate database connection based on settings."""
    if settings.is_postgres():
        return _get_pg_conn()
    _ensure_sqlite_initialized()
    return _get_sqlite_conn()


def _ensure_sqlite_initialized() -> None:
    global _LAST_SQLITE_INIT_PATH
    db_path = settings.db_file
    db_key = str(db_path.resolve()) if db_path.exists() else str(db_path)
    if _LAST_SQLITE_INIT_PATH != db_key or not db_path.exists():
        _init_sqlite()
        _LAST_SQLITE_INIT_PATH = db_key


def _get_sqlite_conn():
    settings.api_root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_file)
    conn.row_factory = sqlite3.Row
    return conn


def _get_pg_conn():
    """Return a psycopg2 connection with dict-like rows."""
    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(settings.database_url, cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = False
        return conn
    except ImportError:
        raise RuntimeError(
            "psycopg2 is required for PostgreSQL. "
            "Install with: pip install psycopg2-binary\n"
            "Or switch to SQLite by unsetting DATABASE_URL."
        )


# ─── Schema ───────────────────────────────────────────────────────────────────
_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT NOT NULL,
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    symbols_json TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    symbols_json TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    output_dir TEXT NOT NULL,
    stdout TEXT,
    stderr TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(strategy_id) REFERENCES strategies(id)
);
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    symbol TEXT,
    trade_json TEXT NOT NULL,
    r_multiple REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    summary_json TEXT,
    validation_json TEXT,
    dashboard_snapshot_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);
CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT,
    trade_id TEXT,
    rule_broken TEXT,
    emotional_state TEXT,
    manual_override INTEGER DEFAULT 0,
    entry_type TEXT,
    note TEXT,
    r_impact REAL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS onboarding_state (
    user_id TEXT PRIMARY KEY,
    step TEXT NOT NULL DEFAULT 'welcome',
    completed_steps_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS registration_otps (
    email TEXT PRIMARY KEY,
    name TEXT,
    password_hash TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_otps (
    email TEXT PRIMARY KEY,
    otp_code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_wallets (
    user_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    starting_balance REAL NOT NULL DEFAULT 100000,
    current_balance REAL NOT NULL DEFAULT 100000,
    realized_pnl REAL NOT NULL DEFAULT 0,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_trades (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    price REAL DEFAULT 0,
    qty REAL DEFAULT 0,
    pnl REAL DEFAULT 0,
    trade_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created_at ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_job_id ON reports(job_id);
CREATE INDEX IF NOT EXISTS idx_trades_job_id ON trades(job_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_live_trades_user_id ON live_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_live_trades_session_id ON live_trades(session_id);
"""

_POSTGRES_DDL = _SQLITE_DDL.replace("REAL DEFAULT", "DOUBLE PRECISION DEFAULT").replace("REAL NOT NULL", "DOUBLE PRECISION NOT NULL")


def init_db():
    """Idempotent schema creation + demo user seeding."""
    if settings.is_postgres():
        _init_postgres()
    else:
        _init_sqlite()


def _init_sqlite():
    global _LAST_SQLITE_INIT_PATH
    settings.api_root.mkdir(parents=True, exist_ok=True)
    with _get_sqlite_conn() as conn:
        conn.executescript(_SQLITE_DDL)
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)",
            (SCHEMA_VERSION, now()),
        )
        _seed_demo_user_sqlite(conn)
        conn.commit()
    _LAST_SQLITE_INIT_PATH = str(settings.db_file.resolve()) if settings.db_file.exists() else str(settings.db_file)


def _seed_demo_user_sqlite(conn):
    demo_id = "demo_user"
    conn.execute(
        "INSERT OR IGNORE INTO users(id,email,name,password_hash,onboarding_completed,created_at) VALUES(?,?,?,?,?,?)",
        (demo_id, "demo@prismflow.com", "Demo User", hash_password("demo123"), 0, now())
    )
    conn.execute("UPDATE users SET email=? WHERE email=?", ("demo@prismflow.com", "demo@prismflow.local"))
    conn.execute(
        "INSERT OR IGNORE INTO onboarding_state(user_id,step,completed_steps_json,updated_at) VALUES(?,?,?,?)",
        (demo_id, "welcome", "[]", now())
    )


def _init_postgres():
    conn = _get_pg_conn()
    try:
        cur = conn.cursor()
        for stmt in _POSTGRES_DDL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                cur.execute(stmt)
        cur.execute(
            """
            INSERT INTO schema_migrations(version,applied_at)
            VALUES(%s,%s)
            ON CONFLICT(version) DO NOTHING
            """,
            (SCHEMA_VERSION, now()),
        )
        cur.execute(
            """
            INSERT INTO users(id,email,name,password_hash,onboarding_completed,created_at)
            VALUES(%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO NOTHING
            """,
            ("demo_user", "demo@prismflow.com", "Demo User", hash_password("demo123"), 0, now()),
        )
        cur.execute("UPDATE users SET email=%s WHERE email=%s", ("demo@prismflow.com", "demo@prismflow.local"))
        cur.execute(
            """
            INSERT INTO onboarding_state(user_id,step,completed_steps_json,updated_at)
            VALUES(%s,%s,%s,%s)
            ON CONFLICT(user_id) DO NOTHING
            """,
            ("demo_user", "welcome", "[]", now()),
        )
        conn.commit()
    finally:
        conn.close()
