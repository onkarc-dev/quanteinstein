"""QuantOS configuration.

Loads environment variables from the repository .env file when present and keeps
safe local defaults while failing fast on unsafe production authentication secrets.
"""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path


def _as_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _as_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


class Settings:
    """Small dependency-free settings loader used by API, worker, and tests."""

    _INSECURE_SECRET_VALUES = {
        "dev-insecure-default-key-change-in-prod",
        "change-this-before-public-deploy",
    }
    _MIN_PRODUCTION_SECRET_LENGTH = 32

    def __init__(self):
        self.project_root: Path = Path(__file__).resolve().parents[4]
        self.api_root: Path = Path(__file__).resolve().parents[2]

        try:
            from dotenv import load_dotenv
            env_path = self.project_root / ".env"
            if env_path.exists():
                load_dotenv(env_path)
        except ImportError:
            pass

        self.env: str = os.getenv("ENV", os.getenv("NODE_ENV", "development")).lower()
        self.is_prod: bool = self.env in {"production", "prod"}

        # Database
        raw_db_url = os.getenv("DATABASE_URL", "").strip()
        if raw_db_url.startswith("postgres"):
            self.database_url = raw_db_url
            self.db_backend = "postgresql"
        elif raw_db_url.startswith("sqlite:///"):
            self.database_url = raw_db_url
            self.database_path = raw_db_url.replace("sqlite:///", "", 1)
            self.db_backend = "sqlite"
        else:
            self.database_path = os.getenv("DATABASE_PATH", "prismflow.db")
            self.database_url = f"sqlite:///{self.api_root / self.database_path}"
            self.db_backend = "sqlite"

        # Redis / queue
        self.redis_url: str = os.getenv("REDIS_URL", "").strip()

        # Auth
        self.secret_key: str = os.getenv("PRISMFLOW_SECRET_KEY", "").strip()
        self.using_insecure_secret = False
        if not self.secret_key:
            self.using_insecure_secret = True
            if self.is_prod:
                raise RuntimeError(
                    "PRISMFLOW_SECRET_KEY is required when ENV=production. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
                )
            self.secret_key = "dev-" + secrets.token_urlsafe(48)
        if self.secret_key in self._INSECURE_SECRET_VALUES or len(self.secret_key) < self._MIN_PRODUCTION_SECRET_LENGTH:
            self.using_insecure_secret = True
            if self.is_prod:
                raise RuntimeError(
                    "PRISMFLOW_SECRET_KEY is insecure for production. "
                    "Use a stable random secret of at least 32 characters. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
                )
        self.session_ttl_seconds = _as_int("SESSION_TTL_SECONDS", 900)
        self.refresh_ttl_seconds = _as_int("REFRESH_TTL_SECONDS", 2592000)
        self.access_token_ttl_seconds = _as_int("ACCESS_TOKEN_TTL_SECONDS", self.session_ttl_seconds)

        # Email / OTP
        self.smtp_host = os.getenv("SMTP_HOST", "").strip()
        self.smtp_port = _as_int("SMTP_PORT", 587)
        self.smtp_user = os.getenv("SMTP_USER", "").strip()
        self.smtp_password = os.getenv("SMTP_PASSWORD", "")
        self.smtp_from = os.getenv("SMTP_FROM", self.smtp_user or "no-reply@quantos.local").strip()
        self.smtp_tls = _as_bool(os.getenv("SMTP_TLS", "true"), True)
        otp_default = "false" if self.is_prod else "true"
        self.email_otp_dev_return = _as_bool(os.getenv("EMAIL_OTP_DEV_RETURN", otp_default), not self.is_prod)

        # Outputs / logs
        self.outputs_root = os.getenv("OUTPUTS_ROOT", "outputs")
        self.log_file = os.getenv("LOG_FILE", str(self.outputs_dir / "quantos_api.log"))

        # Product safety — intentionally immutable at runtime.
        self.safe_mode = True
        self.real_money_enabled = False
        self.broker_integration_enabled = False

        # Server
        self.api_host = os.getenv("API_HOST", "127.0.0.1")
        self.api_port = _as_int("API_PORT", 8000)
        self.rate_limit_per_minute = _as_int("RATE_LIMIT_PER_MINUTE", 120)

        # CORS
        cors_default = "https://www.quanteinstein.com,https://quanteinstein.com,http://localhost:3000,http://127.0.0.1:3000"
        cors_raw = os.getenv("CORS_ORIGINS", cors_default)
        self.cors_origins = [o.strip().rstrip("/") for o in cors_raw.split(",") if o.strip()]
        self.cors_all_enabled = "*" in self.cors_origins
        self.supabase_jwt_secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()

        # Production hardening
        self.enforce_https = _as_bool(os.getenv("ENFORCE_HTTPS", "false"), False)

        # Runtime dirs should exist before logging or job creation.
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        Path(self.log_file).parent.mkdir(parents=True, exist_ok=True)

    @property
    def db_file(self) -> Path:
        p = Path(getattr(self, "database_path", "prismflow.db"))
        return p if p.is_absolute() else self.api_root / p

    @property
    def outputs_dir(self) -> Path:
        p = Path(self.outputs_root)
        return p if p.is_absolute() else self.project_root / p

    @property
    def engine_binary(self) -> Path:
        override = os.getenv("ENGINE_BINARY_PATH", "").strip()
        if override:
            p = Path(override)
            return p if p.is_absolute() else self.project_root / p
        candidates = []
        if sys.platform.startswith("win"):
            candidates.extend([
                self.project_root / "build" / "Release" / "prism_backtest.exe",
                self.project_root / "build" / "prism_backtest.exe",
            ])
        else:
            candidates.extend([
                self.project_root / "build" / "Release" / "prism_backtest",
                self.project_root / "build" / "prism_backtest",
                self.project_root / "build_fresh" / "prism_backtest",
            ])
        return next((p for p in candidates if p.exists()), candidates[0])

    @property
    def live_paper_binary(self) -> Path:
        override = os.getenv("QUANTOS_LIVE_PAPER_BINARY", os.getenv("LIVE_PAPER_BINARY_PATH", "")).strip()
        if override:
            p = Path(override)
            return p if p.is_absolute() else self.project_root / p
        candidates = []
        if sys.platform.startswith("win"):
            candidates.extend([
                self.project_root / "build" / "Release" / "prism_live_paper_trading.exe",
                self.project_root / "build" / "prism_live_paper_trading.exe",
            ])
        if not sys.platform.startswith("win"):
            candidates.append(Path("/app/build/Release/prism_live_paper_trading"))
            candidates.extend([
                self.project_root / "build" / "Release" / "prism_live_paper_trading",
                self.project_root / "build" / "prism_live_paper_trading",
            ])
        return next((p for p in candidates if p.exists()), candidates[0])

    def is_postgres(self) -> bool:
        return self.db_backend == "postgresql"

    def has_redis(self) -> bool:
        return bool(self.redis_url)

    def production_warnings(self) -> list[str]:
        warnings: list[str] = []
        if self.is_prod and self.db_backend != "postgresql":
            warnings.append("DATABASE_URL is not PostgreSQL; use Postgres for public production.")
        if self.is_prod and self.using_insecure_secret:
            warnings.append("PRISMFLOW_SECRET_KEY is missing or insecure.")
        if self.is_prod and self.email_otp_dev_return:
            warnings.append("EMAIL_OTP_DEV_RETURN must be false in production.")
        if self.is_prod and not self.smtp_host:
            warnings.append("SMTP_HOST is not configured; OTP email delivery will fail.")
        if self.is_prod and self.cors_all_enabled:
            warnings.append("CORS_ORIGINS contains '*'; restrict it to your frontend domain.")
        if self.is_prod and not self.enforce_https:
            warnings.append("ENFORCE_HTTPS is false; enable it behind a HTTPS proxy for public launch.")
        return warnings

    def __repr__(self) -> str:
        return f"Settings(env={self.env}, db_backend={self.db_backend}, has_redis={self.has_redis()}, safe_mode={self.safe_mode})"


settings = Settings()
