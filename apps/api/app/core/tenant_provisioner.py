"""Automated Single-Tenant Provisioning Engine for Enterprise Clients.

Allows instant automated provisioning of isolated single-tenant databases (Supabase/Postgres or isolated schema)
for Tier-1 Institutional Hedge Funds while leaving the shared multi-tenant retail database completely intact.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.tenant_router import get_tenant_conn
from app.db import (
    get_conn,
    hash_password,
    now,
    row_to_dict,
    _SQLITE_DDL,
    _POSTGRES_DDL,
    SCHEMA_VERSION,
)

logger = logging.getLogger("quantos.tenant_provisioner")

# Additional Enterprise DDL (e.g. Immutable Audit Logs & Compliance for Step 4)
_ENTERPRISE_AUDIT_DDL = """
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
"""


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_]+", "_", name.strip().lower())
    return slug.strip("_") or f"org_{uuid.uuid4().hex[:8]}"


def provision_enterprise_tenant(
    org_name: str,
    admin_email: str,
    admin_name: str,
    isolation_mode: str = "DEDICATED_SCHEMA",
    custom_db_url: Optional[str] = None,
    admin_password: Optional[str] = None,
) -> Dict[str, Any]:
    """Automated provisioning of an isolated single-tenant database environment for an enterprise hedge fund.

    Supported isolation modes:
    - DEDICATED_SCHEMA: Creates an isolated PostgreSQL schema ("tenant_<org_slug>") within enterprise Postgres/Supabase.
    - DEDICATED_DATABASE: Connects to a dedicated external Supabase/PostgreSQL database via custom_db_url.
    - ISOLATED_SQLITE: Creates an isolated, dedicated SQLite database file (e.g., for staging or local testing).
    """
    clean_org_name = org_name.strip()
    org_slug = _slugify(clean_org_name)
    org_id = f"org_{uuid.uuid4().hex[:12]}"
    clean_admin_email = admin_email.strip().lower()

    logger.info(
        "Starting enterprise provisioning: org='%s' (slug=%s) mode=%s admin=%s",
        clean_org_name,
        org_slug,
        isolation_mode,
        clean_admin_email,
    )

    # 1. Determine Tenant Database Target URL
    if custom_db_url:
        tenant_db_url = custom_db_url.strip()
    elif isolation_mode == "DEDICATED_SCHEMA" and settings.is_postgres():
        schema_name = f"tenant_{org_slug}"
        # Append schema query param to Postgres connection string
        delimiter = "&" if "?" in settings.database_url else "?"
        tenant_db_url = f"{settings.database_url}{delimiter}schema={schema_name}"
    else:
        # Default local/staging isolated database file
        tenant_db_file = settings.api_root / "tenants" / f"{org_slug}.db"
        tenant_db_file.parent.mkdir(parents=True, exist_ok=True)
        tenant_db_url = f"sqlite:///{tenant_db_file}"

    # 2. Initialize Schema in the Dedicated Tenant Database
    _init_tenant_schema(tenant_db_url, org_slug, isolation_mode)

    # 3. Register Organization in Catalog & Bind Admin User
    with get_conn() as primary_conn:
        p = "%s" if settings.is_postgres() else "?"

        # Ensure organizations table exists in catalog
        primary_conn.execute(f"""
            CREATE TABLE IF NOT EXISTS organizations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                tier TEXT NOT NULL DEFAULT 'ENTERPRISE',
                db_url TEXT NOT NULL,
                isolation_mode TEXT NOT NULL DEFAULT 'DEDICATED_SCHEMA',
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE'
            )
        """)

        # Insert Organization
        primary_conn.execute(f"""
            INSERT INTO organizations (id, name, slug, tier, db_url, isolation_mode, created_at, status)
            VALUES ({p}, {p}, {p}, 'ENTERPRISE', {p}, {p}, {p}, 'ACTIVE')
            ON CONFLICT(slug) DO UPDATE SET db_url = excluded.db_url, status = 'ACTIVE'
        """, (org_id, clean_org_name, org_slug, tenant_db_url, isolation_mode, now()))

        # Check or Create Enterprise Admin User
        user_row = primary_conn.execute(
            f"SELECT id, email FROM users WHERE email = {p}", (clean_admin_email,)
        ).fetchone()

        if user_row:
            user_dict = row_to_dict(user_row)
            user_id = user_dict["id"]
            # Upgrade existing user to Enterprise with tenant binding
            primary_conn.execute(f"""
                UPDATE users
                SET tier = 'ENTERPRISE', organization_id = {p}, tenant_db_url = {p}, role = 'ORG_ADMIN'
                WHERE id = {p}
            """, (org_id, tenant_db_url, user_id))
        else:
            user_id = uuid.uuid4().hex
            pwd_hash = hash_password(admin_password or "EnterprisePass123!")
            primary_conn.execute(f"""
                INSERT INTO users (id, email, name, password_hash, onboarding_completed, created_at, tier, organization_id, tenant_db_url, role)
                VALUES ({p}, {p}, {p}, {p}, 1, {p}, 'ENTERPRISE', {p}, {p}, 'ORG_ADMIN')
            """, (user_id, clean_admin_email, admin_name, pwd_hash, now(), org_id, tenant_db_url))

        primary_conn.commit()

    logger.info("Enterprise tenant provisioned successfully: org_id=%s admin_id=%s", org_id, user_id)

    return {
        "status": "PROVISIONED",
        "organization_id": org_id,
        "organization_name": clean_org_name,
        "slug": org_slug,
        "tier": "ENTERPRISE",
        "isolation_mode": isolation_mode,
        "tenant_db_url": tenant_db_url,
        "admin_user_id": user_id,
        "admin_email": clean_admin_email,
        "created_at": now(),
    }


def _init_tenant_schema(tenant_db_url: str, org_slug: str, isolation_mode: str) -> None:
    """Run core DDL and compliance tables inside the isolated single-tenant database."""
    conn = get_tenant_conn(tenant_db_url)
    try:
        is_pg = tenant_db_url.startswith("postgres")

        if is_pg and isolation_mode == "DEDICATED_SCHEMA":
            schema_name = f"tenant_{org_slug}"
            cur = conn.cursor()
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}";')
            cur.execute(f'SET search_path TO "{schema_name}", public;')
            ddl_to_run = _POSTGRES_DDL + "\n" + _ENTERPRISE_AUDIT_DDL
            for stmt in ddl_to_run.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt)
            cur.close()
            conn.commit()
        elif is_pg:
            cur = conn.cursor()
            ddl_to_run = _POSTGRES_DDL + "\n" + _ENTERPRISE_AUDIT_DDL
            for stmt in ddl_to_run.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt)
            cur.close()
            conn.commit()
        else:
            # SQLite single-tenant file
            ddl_to_run = _SQLITE_DDL + "\n" + _ENTERPRISE_AUDIT_DDL
            conn.executescript(ddl_to_run)
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)",
                (SCHEMA_VERSION, now()),
            )
            conn.commit()
    finally:
        conn.close()


def verify_tenant_health(tenant_db_url: str) -> Dict[str, Any]:
    """Execute a ping and verify query against an isolated tenant database."""
    try:
        conn = get_tenant_conn(tenant_db_url)
        try:
            if hasattr(conn, "execute"):
                res = conn.execute("SELECT COUNT(*) FROM strategies").fetchone()
                count = res[0] if res else 0
            else:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM strategies")
                res = cur.fetchone()
                count = res[0] if isinstance(res, (tuple, list)) else res.get("count", 0)
                cur.close()
            return {"status": "HEALTHY", "accessible": True, "strategies_count": count}
        finally:
            conn.close()
    except Exception as e:
        logger.exception("Tenant health check failed for URL: %s", tenant_db_url)
        return {"status": "DEGRADED", "accessible": False, "error": str(e)}
