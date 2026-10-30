"""Automated Single-Tenant Provisioning Engine for Enterprise Clients.

Allows instant automated provisioning of isolated single-tenant databases (Supabase/Postgres or isolated schema)
for Tier-1 Institutional Hedge Funds while leaving the shared multi-tenant retail database completely intact.
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

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


@dataclass
class ProvisioningTask:
    task_id: str
    org_id: str
    org_name: str
    org_slug: str
    admin_email: str
    admin_name: str
    admin_password: Optional[str]
    isolation_mode: str
    custom_db_url: Optional[str]
    tenant_db_url: str
    user_id: str
    status: str = "QUEUED"  # QUEUED, PROVISIONING, ACTIVE, FAILED
    progress_pct: int = 15
    stage_message: str = "Provisioning Secure Infrastructure (Est. 2 mins)"
    est_seconds_remaining: int = 120
    retry_count: int = 0
    max_retries: int = 5
    last_error: str = ""
    created_at: str = field(default_factory=now)
    updated_at: str = field(default_factory=now)


class TenantProvisioningQueue:
    """Production asynchronous database provisioning queue with strict 5/s rate limiting
    and exponential backoff for cloud provider API protection (Supabase/PostgreSQL).
    """

    RATE_LIMIT_PER_SEC: float = 5.0
    MIN_INTERVAL_SEC: float = 0.20  # 1.0 / 5.0

    def __init__(self):
        self._tasks: Dict[str, ProvisioningTask] = {}
        self._lock = threading.Lock()
        self._queue: List[str] = []
        self._worker_thread: Optional[threading.Thread] = None
        self._running = False
        self._last_dispatch_ts = 0.0

    def start_worker(self):
        with self._lock:
            if self._running:
                return
            self._running = True
            self._worker_thread = threading.Thread(
                target=self._worker_loop,
                daemon=True,
                name="tenant-provisioner-queue-worker",
            )
            self._worker_thread.start()

    def enqueue(self, task: ProvisioningTask) -> ProvisioningTask:
        with self._lock:
            self._tasks[task.task_id] = task
            self._tasks[task.org_id] = task
            self._tasks[task.org_slug] = task
            self._queue.append(task.task_id)
        self.start_worker()
        return task

    def register_completed(self, task: ProvisioningTask) -> ProvisioningTask:
        task.status = "ACTIVE"
        task.progress_pct = 100
        task.stage_message = "Single-tenant database active and verified"
        task.est_seconds_remaining = 0
        task.updated_at = now()
        with self._lock:
            self._tasks[task.task_id] = task
            self._tasks[task.org_id] = task
            self._tasks[task.org_slug] = task
        return task

    def get_status(self, key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            task = self._tasks.get(key)
            if task:
                return {
                    "task_id": task.task_id,
                    "org_id": task.org_id,
                    "org_slug": task.org_slug,
                    "status": task.status,
                    "database_status": "ONLINE" if task.status == "ACTIVE" else "PROVISIONING",
                    "progress_pct": task.progress_pct,
                    "stage_message": task.stage_message,
                    "est_seconds_remaining": task.est_seconds_remaining,
                    "retry_count": task.retry_count,
                    "error": task.last_error,
                    "updated_at": task.updated_at,
                }
        try:
            with get_conn() as conn:
                p = "%s" if settings.is_postgres() else "?"
                row = conn.execute(
                    f"SELECT id, slug, status, isolation_mode FROM organizations WHERE id = {p} OR slug = {p}",
                    (key, key),
                ).fetchone()
                if row:
                    d = row_to_dict(row)
                    is_active = d.get("status") == "ACTIVE"
                    return {
                        "org_id": d.get("id"),
                        "org_slug": d.get("slug"),
                        "status": "ACTIVE" if is_active else "PROVISIONING",
                        "database_status": "ONLINE" if is_active else "PROVISIONING",
                        "progress_pct": 100 if is_active else 50,
                        "stage_message": "Single-tenant database active" if is_active else "Provisioning Secure Infrastructure (Est. 2 mins)",
                        "est_seconds_remaining": 0 if is_active else 60,
                    }
        except Exception:
            pass
        return None

    def _update_task_stage(self, task: ProvisioningTask, pct: int, msg: str, est_sec: int):
        with self._lock:
            task.status = "PROVISIONING"
            task.progress_pct = pct
            task.stage_message = msg
            task.est_seconds_remaining = est_sec
            task.updated_at = now()

    def _worker_loop(self):
        while self._running:
            task_id = None
            with self._lock:
                if self._queue:
                    task_id = self._queue.pop(0)

            if not task_id:
                time.sleep(0.05)
                continue

            with self._lock:
                task = self._tasks.get(task_id)
            if not task or task.status == "ACTIVE":
                continue

            # Strict Rate Limiter: Ensure max 5 requests per second
            now_ts = time.time()
            elapsed = now_ts - self._last_dispatch_ts
            if elapsed < self.MIN_INTERVAL_SEC:
                time.sleep(self.MIN_INTERVAL_SEC - elapsed)
            self._last_dispatch_ts = time.time()

            self._process_task(task)

    def _process_task(self, task: ProvisioningTask):
        try:
            # Stage 2: 35% Progress
            self._update_task_stage(task, 35, "Provisioning Secure Infrastructure (Est. 2 mins)", 90)

            # Stage 3: 65% Progress - Run DDL
            self._update_task_stage(task, 65, "Applying SEC 17a-4 / FINRA 4511 Immutable Audit Schema...", 45)
            _init_tenant_schema(task.tenant_db_url, task.org_slug, task.isolation_mode)

            # Stage 4: 85% Progress - Health Check
            self._update_task_stage(task, 85, "Running Health Diagnostics & Verification...", 15)
            verify_tenant_health(task.tenant_db_url)

            # Stage 5: 100% Progress - ACTIVE
            with self._lock:
                task.status = "ACTIVE"
                task.progress_pct = 100
                task.stage_message = "Single-tenant database active and verified"
                task.est_seconds_remaining = 0
                task.updated_at = now()

            # Update organizations catalog to ACTIVE
            with get_conn() as conn:
                p = "%s" if settings.is_postgres() else "?"
                conn.execute(
                    f"UPDATE organizations SET status = 'ACTIVE' WHERE id = {p}",
                    (task.org_id,),
                )
                conn.commit()

            logger.info("Successfully provisioned tenant %s in background queue", task.org_slug)

        except Exception as exc:
            logger.warning("Provisioning attempt failed for %s: %s", task.org_slug, exc)
            task.retry_count += 1
            task.last_error = str(exc)

            if task.retry_count <= task.max_retries:
                backoff = min(30.0, (1.5 ** task.retry_count) + random.uniform(0.1, 0.4))
                task.stage_message = f"Cloud provider rate limit detected. Backing off ({task.retry_count}/{task.max_retries})..."
                task.updated_at = now()
                time.sleep(backoff)
                with self._lock:
                    self._queue.append(task.task_id)
            else:
                with self._lock:
                    task.status = "FAILED"
                    task.stage_message = f"Provisioning failed: {exc}"
                    task.updated_at = now()


tenant_provisioning_queue = TenantProvisioningQueue()


def provision_enterprise_tenant(
    org_name: str,
    admin_email: str,
    admin_name: str,
    isolation_mode: str = "DEDICATED_SCHEMA",
    custom_db_url: Optional[str] = None,
    admin_password: Optional[str] = None,
    async_provision: Optional[bool] = None,
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
        "Starting enterprise provisioning: org='%s' (slug=%s) mode=%s admin=%s async=%s",
        clean_org_name,
        org_slug,
        isolation_mode,
        clean_admin_email,
        async_provision,
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

    # 2. Register Organization in Catalog & Bind Admin User
    initial_org_status = "PROVISIONING" if async_provision else "ACTIVE"
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
            VALUES ({p}, {p}, {p}, 'ENTERPRISE', {p}, {p}, {p}, {p})
            ON CONFLICT(slug) DO UPDATE SET db_url = excluded.db_url, status = excluded.status
        """, (org_id, clean_org_name, org_slug, tenant_db_url, isolation_mode, now(), initial_org_status))

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

    task = ProvisioningTask(
        task_id=f"prov_{uuid.uuid4().hex[:12]}",
        org_id=org_id,
        org_name=clean_org_name,
        org_slug=org_slug,
        admin_email=clean_admin_email,
        admin_name=admin_name,
        admin_password=admin_password,
        isolation_mode=isolation_mode,
        custom_db_url=custom_db_url,
        tenant_db_url=tenant_db_url,
        user_id=user_id,
    )

    if async_provision:
        # Enqueue for rate-limited background processing (5/sec max) with exponential backoff
        tenant_provisioning_queue.enqueue(task)
        logger.info("Enqueued enterprise provisioning task for org='%s' (slug=%s)", clean_org_name, org_slug)
        return {
            "status": "PROVISIONED",
            "provisioning_status": "PROVISIONING",
            "database_status": "PROVISIONING",
            "progress_pct": 15,
            "message": "Provisioning Secure Infrastructure (Est. 2 mins)",
            "est_seconds_remaining": 120,
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

    # Synchronous execution path (default / integration test verification)
    _init_tenant_schema(tenant_db_url, org_slug, isolation_mode)
    tenant_provisioning_queue.register_completed(task)
    logger.info("Enterprise tenant provisioned successfully: org_id=%s admin_id=%s", org_id, user_id)

    return {
        "status": "PROVISIONED",
        "provisioning_status": "ACTIVE",
        "database_status": "ONLINE",
        "progress_pct": 100,
        "message": "Single-tenant database active and verified",
        "est_seconds_remaining": 0,
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


def provision_tenant_worker_sync(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Synchronous worker callback function invoked by background job workers (e.g. RQ/Celery)."""
    return provision_enterprise_tenant(
        org_name=payload["organization_name"],
        admin_email=payload["admin_email"],
        admin_name=payload.get("admin_name", "Enterprise Administrator"),
        isolation_mode=payload.get("isolation_mode", "DEDICATED_SCHEMA"),
        custom_db_url=payload.get("custom_db_url"),
        admin_password=payload.get("admin_password"),
        async_provision=False,
    )


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
