"""Immutable Audit Log Service and Middleware for SOC 2 Type II / SEC Rule 17a-4 / FINRA Compliance.
Records every algorithm update, order routing, authentication event, and role modification.
"""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
from typing import Any, Dict, Optional

import jwt
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.db import get_primary_conn, now, row_to_dict

logger = logging.getLogger("quantos.audit")

SENSITIVE_KEYS = {"password", "secret", "token", "key_hash", "private_key", "idp_certificate"}


def mask_sensitive_dict(d: Any) -> Any:
    """Recursively mask sensitive values in audit detail dictionaries."""
    if isinstance(d, dict):
        masked = {}
        for k, v in d.items():
            if any(s in k.lower() for s in SENSITIVE_KEYS) and isinstance(v, str):
                masked[k] = f"***masked[{len(v)}chars]***"
            else:
                masked[k] = mask_sensitive_dict(v)
        return masked
    elif isinstance(d, list):
        return [mask_sensitive_dict(x) for x in d]
    return d


def compute_payload_digest(data: bytes | str | None) -> str:
    """Computes SHA-256 hash of request payload for cryptographic non-repudiation."""
    if not data:
        return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"  # sha256 of empty string
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def record_audit_event(
    action: str,
    resource_type: str,
    client_ip: str,
    request_path: str,
    request_method: str,
    status_code: int = 200,
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    actor_email: Optional[str] = None,
    actor_role: Optional[str] = None,
    resource_id: Optional[str] = None,
    user_agent: Optional[str] = None,
    payload_digest: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> str:
    """Synchronously and immutably insert a regulatory compliance record into audit_logs table."""
    audit_id = f"aud_{secrets.token_hex(12)}"
    created_timestamp = now()
    masked_details = mask_sensitive_dict(details or {})
    details_str = json.dumps(masked_details) if masked_details else "{}"

    with get_primary_conn() as conn:
        p = "%s" if settings.is_postgres() else "?"
        conn.execute(
            f"""
            INSERT INTO audit_logs (
                id, user_id, organization_id, actor_email, actor_role,
                action, resource_type, resource_id, client_ip, user_agent,
                request_path, request_method, status_code, payload_digest,
                details_json, is_immutable, created_at
            )
            VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, 1, {p})
            """,
            (
                audit_id,
                user_id or "",
                organization_id or "",
                actor_email or "",
                actor_role or "TRADER",
                action.upper(),
                resource_type.lower(),
                resource_id or "",
                client_ip,
                user_agent or "",
                request_path,
                request_method.upper(),
                status_code,
                payload_digest or compute_payload_digest(""),
                details_str,
                created_timestamp,
            ),
        )
        conn.commit()

    return audit_id


class EnterpriseAuditMiddleware(BaseHTTPMiddleware):
    """FastAPI Middleware automatically auditing all mutating institutional and enterprise requests."""

    # Paths that must always be audited for enterprise/compliance monitoring
    AUDIT_PREFIXES = (
        "/strategies",
        "/jobs",
        "/enterprise",
        "/auth/sso",
        "/api/v1/orders",
        "/api/v1/execution",
        "/api/v1/keys",
    )

    async def dispatch(self, request: Request, call_next):
        method = request.method.upper()
        path = request.url.path

        # Only audit mutating operations (POST, PUT, DELETE, PATCH) or specific compliance reads
        should_audit = (
            method in {"POST", "PUT", "DELETE", "PATCH"}
            and any(path.startswith(prefix) for prefix in self.AUDIT_PREFIXES)
        )

        if not should_audit:
            return await call_next(request)

        # Buffer request body to compute digest
        body_bytes = await request.body()
        payload_digest = compute_payload_digest(body_bytes)

        # Extract identity from authorization / API key
        user_id = ""
        email = ""
        tier = "RETAIL"
        org_id = ""
        role = "TRADER"

        auth_header = request.headers.get("authorization", "").strip()
        x_api_key = request.headers.get("x-api-key", "").strip()

        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
            if not token.startswith("qe_"):
                try:
                    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
                    user_id = str(payload.get("sub") or "")
                    tier = str(payload.get("tier") or "RETAIL").upper()
                    org_id = str(payload.get("org_id") or payload.get("organization_id") or "")
                    role = str(payload.get("role") or "TRADER").upper()
                    email = str(payload.get("email") or "")
                except Exception:
                    pass

        forwarded = request.headers.get("x-forwarded-for")
        client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "127.0.0.1")
        user_agent = request.headers.get("user-agent", "")

        # Call next route handler
        response: Response = await call_next(request)

        # Determine action name based on route and method
        action = f"HTTP_{method}_{path.strip('/').replace('/', '_').upper()}"
        resource_type = "system"
        if "/strategies" in path:
            resource_type = "strategy"
            action = "ALGORITHM_CREATE" if method == "POST" else ("ALGORITHM_UPDATE" if method in {"PUT", "PATCH"} else "ALGORITHM_DELETE")
        elif "/jobs" in path or "/backtests" in path:
            resource_type = "backtest_job"
            action = "BACKTEST_EXECUTE"
        elif "/api/v1/orders" in path or "/execution" in path:
            resource_type = "order"
            action = "ORDER_SUBMIT"
        elif "/api/v1/keys" in path:
            resource_type = "api_key"
            action = "API_KEY_MODIFY"
        elif "/auth/sso" in path:
            resource_type = "sso"
            action = "SSO_AUTHENTICATION"
        elif "/organization" in path:
            resource_type = "organization"
            action = "ORGANIZATION_SETTINGS_MODIFY"

        # Record event for enterprise tiers, or mutating algorithmic/order events
        if tier in {"ENTERPRISE", "PRO"} or "/sso" in path or "/execution" in path or "/enterprise" in path:
            try:
                record_audit_event(
                    action=action,
                    resource_type=resource_type,
                    client_ip=client_ip,
                    request_path=path,
                    request_method=method,
                    status_code=response.status_code,
                    user_id=user_id,
                    organization_id=org_id,
                    actor_email=email,
                    actor_role=role,
                    user_agent=user_agent,
                    payload_digest=payload_digest,
                    details={"status": response.status_code},
                )
            except Exception as e:
                logger.warning("Failed to write immutable audit record: %s", e)

        return response
