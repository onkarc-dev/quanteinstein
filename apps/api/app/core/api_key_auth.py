"""Enterprise Headless API Key Generation, Hashing, and Validation.

Provides cryptographically secure API keys (qe_live_... / qe_test_...) for direct programmatic
access by institutional hedge funds, automated trading systems, and Jupyter ML pipelines.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import secrets
from typing import Any, Dict, Optional, Tuple

from app.core.config import settings
from app.db import get_primary_conn, now, row_to_dict

KEY_PREFIX_LIVE = "qe_live_"
KEY_PREFIX_TEST = "qe_test_"


def generate_api_key(mode: str = "live") -> Tuple[str, str, str]:
    """Generate a high-entropy API key.
    
    Returns:
        (full_plaintext_key, key_prefix, key_hash)
    """
    prefix = KEY_PREFIX_LIVE if mode == "live" else KEY_PREFIX_TEST
    random_entropy = secrets.token_hex(24)  # 48 hex characters
    full_key = f"{prefix}{random_entropy}"
    key_prefix = full_key[:16]  # e.g. "qe_live_1a2b3c4d"
    key_hash = hashlib.sha256(full_key.encode("utf-8")).hexdigest()
    return full_key, key_prefix, key_hash


def hash_api_key(raw_key: str) -> str:
    """Compute deterministic SHA-256 digest of an API key."""
    return hashlib.sha256(raw_key.strip().encode("utf-8")).hexdigest()


def validate_api_key(raw_key: str) -> Optional[Dict[str, Any]]:
    """Validate API key against primary catalog and return user & tenant credentials if authorized."""
    if not raw_key or not (raw_key.startswith(KEY_PREFIX_LIVE) or raw_key.startswith(KEY_PREFIX_TEST)):
        return None

    key_hash = hash_api_key(raw_key)
    p = "%s" if settings.is_postgres() else "?"

    with get_primary_conn() as conn:
        query = f"""
            SELECT
                a.id as key_id,
                a.user_id,
                a.organization_id,
                a.name as key_name,
                a.permissions_json,
                a.rate_limit_per_minute,
                a.expires_at,
                a.is_active,
                u.email,
                u.name,
                COALESCE(u.tier, 'RETAIL') as tier,
                u.tenant_db_url,
                COALESCE(u.role, 'TRADER') as role
            FROM api_keys a
            JOIN users u ON u.id = a.user_id
            WHERE a.key_hash = {p} AND a.is_active = 1
        """
        row = conn.execute(query, (key_hash,)).fetchone()
        if not row:
            return None

        data = row_to_dict(row)

        # Check expiration
        expires_at = data.get("expires_at")
        if expires_at:
            try:
                exp_dt = datetime.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if datetime.datetime.now(datetime.timezone.utc) > exp_dt:
                    return None
            except Exception:
                pass

        # Update last_used_at timestamp
        try:
            conn.execute(f"UPDATE api_keys SET last_used_at = {p} WHERE id = {p}", (now(), data["key_id"]))
            conn.commit()
        except Exception:
            pass

    perms = []
    try:
        perms = json.loads(data.get("permissions_json") or "[]")
    except Exception:
        perms = ["data:read", "backtest:run", "orders:write"]

    return {
        "id": data["user_id"],
        "email": data["email"],
        "name": data.get("name") or "",
        "tier": data.get("tier") or "RETAIL",
        "organization_id": data.get("organization_id"),
        "tenant_db_url": data.get("tenant_db_url"),
        "role": data.get("role") or "TRADER",
        "api_key_id": data["key_id"],
        "api_key_name": data["key_name"],
        "permissions": perms,
        "rate_limit_per_minute": data.get("rate_limit_per_minute", 1200),
    }
