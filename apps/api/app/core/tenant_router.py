"""Tenant connection router.

Provides connection routing and connection pool caching for isolated enterprise single-tenant databases.
If an enterprise client has a dedicated PostgreSQL database (Supabase instance) or isolated PostgreSQL schema,
all queries during the enterprise session are routed directly to their isolated database.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import urllib.parse
from pathlib import Path
from typing import Any, Dict

from app.core.config import settings

logger = logging.getLogger("quantos.tenant_router")

# Cache tenant connection parameters and connection references
_TENANT_POOLS: Dict[str, Any] = {}


def get_tenant_conn(tenant_db_url: str):
    """Return a database connection specifically configured for the given tenant database URL."""
    if not tenant_db_url:
        raise ValueError("tenant_db_url cannot be empty")

    parsed = urllib.parse.urlparse(tenant_db_url)
    scheme = parsed.scheme.lower()

    if scheme.startswith("sqlite") or scheme == "file" or tenant_db_url.startswith("file:"):
        return _get_sqlite_tenant_conn(tenant_db_url)
    elif scheme.startswith("postgres"):
        return _get_postgres_tenant_conn(tenant_db_url)
    else:
        raise ValueError(f"Unsupported tenant database scheme: {scheme}")


def _get_sqlite_tenant_conn(tenant_db_url: str):
    """Handle isolated SQLite single-tenant database file."""
    # sqlite:///path/to/tenant.db or file:path/to/tenant.db
    path_part = tenant_db_url.replace("sqlite:///", "", 1).replace("sqlite://", "", 1).replace("file://", "", 1).replace("file:", "", 1)
    db_path = Path(path_part)
    if not db_path.is_absolute():
        db_path = settings.api_root / db_path

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=10000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def _get_postgres_tenant_conn(tenant_db_url: str):
    """Handle isolated PostgreSQL dedicated database or dedicated schema."""
    import psycopg2
    import psycopg2.extras

    parsed = urllib.parse.urlparse(tenant_db_url)
    query_params = urllib.parse.parse_qs(parsed.query)

    # Dedicated schema isolation (search_path)
    target_schema = None
    if "currentSchema" in query_params:
        target_schema = query_params["currentSchema"][0]
    elif "options" in query_params:
        for opt in query_params["options"]:
            if "-c search_path=" in opt:
                target_schema = opt.split("-c search_path=", 1)[1].strip()

    conn = psycopg2.connect(tenant_db_url, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False

    if target_schema:
        cur = conn.cursor()
        # Sanitize schema identifier to alphanumeric/underscore
        clean_schema = "".join(c for c in target_schema if c.isalnum() or c == "_")
        if clean_schema:
            cur.execute(f"SET search_path TO {clean_schema}, public;")
            cur.close()

    return conn


def evict_tenant_pool(tenant_db_url: str):
    """Remove cached connections when a tenant is reconfigured or decommissioned."""
    if tenant_db_url in _TENANT_POOLS:
        del _TENANT_POOLS[tenant_db_url]
