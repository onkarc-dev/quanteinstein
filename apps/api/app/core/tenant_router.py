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

    if scheme.startswith("sqlite"):
        return _get_sqlite_tenant_conn(tenant_db_url)
    elif scheme.startswith("postgres"):
        return _get_postgres_tenant_conn(tenant_db_url)
    else:
        raise ValueError(f"Unsupported tenant database scheme: {scheme}")


def _get_sqlite_tenant_conn(tenant_db_url: str):
    """Handle isolated SQLite single-tenant database file."""
    # sqlite:///path/to/tenant.db
    path_part = tenant_db_url.replace("sqlite:///", "", 1).replace("sqlite://", "", 1)
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
    """Handle isolated PostgreSQL / Supabase single-tenant instance or dedicated schema."""
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        raise RuntimeError(
            "psycopg2 is required for Enterprise PostgreSQL single-tenant routing. "
            "Install with: pip install psycopg2-binary"
        )

    # Check for dedicated schema query parameter: e.g. postgresql://...?schema=tenant_hedgefund_a
    parsed = urllib.parse.urlparse(tenant_db_url)
    qs = urllib.parse.parse_qs(parsed.query)
    schema_name = qs.get("schema", [None])[0]

    # Clean URL without custom query params for psycopg2 connect
    clean_url = tenant_db_url
    if schema_name:
        # Reconstruct base URL without the custom 'schema' param to prevent psycopg2 driver error
        clean_qs = {k: v for k, v in qs.items() if k != "schema"}
        new_query = urllib.parse.urlencode(clean_qs, doseq=True)
        clean_url = urllib.parse.urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment
        ))

    conn = psycopg2.connect(clean_url, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False

    if schema_name:
        # Set the PostgreSQL search_path to the isolated enterprise tenant schema
        cur = conn.cursor()
        safe_schema = "".join(c for c in schema_name if c.isalnum() or c == "_")
        cur.execute(f'SET search_path TO "{safe_schema}", public;')
        cur.close()

    return conn
