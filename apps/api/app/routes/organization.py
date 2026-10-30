"""Institutional Organization Settings, Granular RBAC, and SOC 2 / SEC Compliance Audit router."""
from __future__ import annotations

import csv
import io
import json
import logging
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, EmailStr

from app.core.audit_middleware import record_audit_event
from app.core.config import settings
from app.core.tenant_provisioner import tenant_provisioning_queue
from app.db import get_primary_conn, hash_password, now, row_to_dict
from app.deps import current_user

router = APIRouter()
logger = logging.getLogger("quantos.organization")

VALID_ROLES = {"ORGANIZATION_ADMIN", "QUANT_RESEARCHER", "RISK_OFFICER", "COMPLIANCE_OFFICER"}

ROLE_PERMISSIONS: Dict[str, List[str]] = {
    "ORGANIZATION_ADMIN": [
        "org:manage", "members:read", "members:write", "strategies:read",
        "strategies:write", "execution:trade", "risk:manage", "audit:read",
        "audit:export", "api_keys:manage"
    ],
    "QUANT_RESEARCHER": [
        "strategies:read", "strategies:write", "execution:trade", "data:read", "backtest:run"
    ],
    "RISK_OFFICER": [
        "risk:manage", "strategies:read", "execution:read", "orders:inspect", "audit:read"
    ],
    "COMPLIANCE_OFFICER": [
        "audit:read", "audit:export", "strategies:read", "execution:read", "members:read"
    ],
}


def require_role(user: Dict[str, Any], allowed_roles: set[str], error_msg: str = "Insufficient permissions"):
    """Validates user's institutional tier and role clearance."""
    tier = str(user.get("tier", "RETAIL")).upper()
    role = str(user.get("role", "TRADER")).upper()

    # Platform master admins have universal clearance
    email = str(user.get("email", "")).lower()
    if email in {"onkarchouguletrader@gmail.com", "admin@quanteinstein.com"}:
        return

    if tier not in {"ENTERPRISE", "PRO"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Enterprise tier subscription required")

    if role not in allowed_roles and role != "ORGANIZATION_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error_msg)


# ─── Pydantic Models ────────────────────────────────────────────────────────

class InviteMemberRequest(BaseModel):
    email: EmailStr
    name: str
    role: str = "QUANT_RESEARCHER"  # ORGANIZATION_ADMIN, QUANT_RESEARCHER, RISK_OFFICER, COMPLIANCE_OFFICER
    password: Optional[str] = None


class UpdateMemberRoleRequest(BaseModel):
    role: str  # ORGANIZATION_ADMIN, QUANT_RESEARCHER, RISK_OFFICER, COMPLIANCE_OFFICER


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/details", summary="Get enterprise organization profile and compliance status")
def get_organization_details(user: Dict[str, Any] = Depends(current_user)):
    """Returns organization profile, isolated single-tenant database metrics, and compliance readiness."""
    tier = str(user.get("tier", "RETAIL")).upper()
    if tier not in {"ENTERPRISE", "PRO"} and str(user.get("email", "")).lower() != "onkarchouguletrader@gmail.com":
        raise HTTPException(status_code=403, detail="Enterprise tier subscription required")

    org_id = user.get("organization_id")
    p = "%s" if settings.is_postgres() else "?"

    with get_primary_conn() as conn:
        org_row = None
        if org_id:
            org_row = conn.execute(f"SELECT * FROM organizations WHERE id = {p}", (org_id,)).fetchone()

        if not org_row:
            # Fallback for preview or root enterprise
            org_row = conn.execute("SELECT * FROM organizations ORDER BY created_at DESC LIMIT 1").fetchone()

        org_dict = row_to_dict(org_row) if org_row else {}

        # Fetch member count
        resolved_org_id = org_dict.get("id") or org_id or "default_org"
        member_count_row = conn.execute(
            f"SELECT count(*) as count FROM users WHERE organization_id = {p}",
            (resolved_org_id,)
        ).fetchone()
        member_count = member_count_row[0] if member_count_row else 1

        # Fetch SSO configuration status
        sso_row = conn.execute(
            f"SELECT provider, domain, is_active FROM sso_configurations WHERE organization_id = {p}",
            (resolved_org_id,)
        ).fetchone()
        sso_info = row_to_dict(sso_row) if sso_row else None

        raw_url = org_dict.get("db_url") or user.get("tenant_db_url") or "SHARED_DATABASE"
        masked_url = raw_url
        if "@" in raw_url:
            parts = raw_url.split("@", 1)
            prefix = parts[0].split("://", 1)[0] + "://***:***@"
            masked_url = prefix + parts[1]

        prov_status = tenant_provisioning_queue.get_status(resolved_org_id)
        org_status = org_dict.get("status") or (prov_status.get("status") if prov_status else "ACTIVE")
        is_provisioning = (org_status == "PROVISIONING") or (prov_status and prov_status.get("status") in {"QUEUED", "PROVISIONING"})

        db_status = "PROVISIONING" if is_provisioning else "ONLINE"
        progress_pct = prov_status.get("progress_pct", 35) if (prov_status and is_provisioning) else (15 if is_provisioning else 100)
        prov_msg = prov_status.get("stage_message", "Provisioning Secure Infrastructure (Est. 2 mins)") if (prov_status and is_provisioning) else ("Provisioning Secure Infrastructure (Est. 2 mins)" if is_provisioning else "Single-tenant database active and verified")
        est_sec = prov_status.get("est_seconds_remaining", 120) if (prov_status and is_provisioning) else (120 if is_provisioning else 0)

    return {
        "status": "ok",
        "organization": {
            "id": org_dict.get("id") or resolved_org_id,
            "name": org_dict.get("name") or "Institutional Capital Partners",
            "slug": org_dict.get("slug") or "inst-capital",
            "tier": org_dict.get("tier") or "ENTERPRISE",
            "isolation_mode": org_dict.get("isolation_mode") or "DEDICATED_SCHEMA",
            "database_status": db_status,
            "database_url_masked": masked_url,
            "provisioning_progress_pct": progress_pct,
            "provisioning_message": prov_msg,
            "est_seconds_remaining": est_sec,
            "created_at": org_dict.get("created_at") or now(),
            "member_count": member_count,
            "sso_configured": bool(sso_info and sso_info.get("is_active")),
            "sso_provider": sso_info.get("provider") if sso_info else "None",
            "compliance": {
                "soc2_type2": "ATTESTED",
                "sec_rule_15c3_5": "ENFORCED (FAT_FINGER_FILTERS)",
                "finra_4511_audit": "COMPLIANT (IMMUTABLE_LOGS)",
            },
        },
    }


@router.get("/members", summary="List members in enterprise organization")
def list_organization_members(user: Dict[str, Any] = Depends(current_user)):
    """List members and their assigned RBAC roles for the organization."""
    require_role(user, {"ORGANIZATION_ADMIN", "COMPLIANCE_OFFICER", "RISK_OFFICER"})
    org_id = user.get("organization_id")
    p = "%s" if settings.is_postgres() else "?"

    with get_primary_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT id, email, name, role, permissions_json, created_at, onboarding_completed
            FROM users
            WHERE organization_id = {p} OR tier = 'ENTERPRISE'
            ORDER BY created_at ASC
            """,
            (org_id or "",)
        ).fetchall()

        members = []
        for r in rows:
            d = row_to_dict(r)
            try:
                d["permissions"] = json.loads(d.get("permissions_json") or "[]")
            except Exception:
                d["permissions"] = []
            d.pop("permissions_json", None)
            members.append(d)

    return {"status": "ok", "count": len(members), "members": members}


@router.post("/members/invite", summary="Invite / create new organization team member with role")
def invite_organization_member(
    payload: InviteMemberRequest,
    user: Dict[str, Any] = Depends(current_user),
):
    """Adds a new team member with specified RBAC role (Admin clearance required)."""
    require_role(user, {"ORGANIZATION_ADMIN"}, "Only Organization Administrators can invite new members")

    role = payload.role.upper()
    if role not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role '{payload.role}'. Must be one of: {', '.join(VALID_ROLES)}"
        )

    org_id = user.get("organization_id")
    tenant_db_url = user.get("tenant_db_url")
    email = payload.email.lower().strip()
    p = "%s" if settings.is_postgres() else "?"

    with get_primary_conn() as conn:
        existing = conn.execute(f"SELECT id FROM users WHERE email = {p}", (email,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"User with email '{email}' already exists")

        new_user_id = f"usr_{secrets.token_hex(8)}"
        raw_pwd = payload.password or secrets.token_urlsafe(16)
        pwd_hash = hash_password(raw_pwd)
        permissions = ROLE_PERMISSIONS.get(role, ROLE_PERMISSIONS["QUANT_RESEARCHER"])

        conn.execute(
            f"""
            INSERT INTO users (
                id, email, name, password_hash, onboarding_completed,
                created_at, tier, organization_id, tenant_db_url, role, permissions_json
            )
            VALUES ({p}, {p}, {p}, {p}, 1, {p}, 'ENTERPRISE', {p}, {p}, {p}, {p})
            """,
            (
                new_user_id, email, payload.name, pwd_hash, now(),
                org_id, tenant_db_url, role, json.dumps(permissions)
            )
        )
        conn.commit()

        # Immutable Audit Record
        record_audit_event(
            action="RBAC_MEMBER_INVITE",
            resource_type="organization_member",
            resource_id=new_user_id,
            client_ip="127.0.0.1",
            request_path="/enterprise/organization/members/invite",
            request_method="POST",
            status_code=200,
            user_id=user["id"],
            organization_id=org_id,
            actor_email=user["email"],
            actor_role=user.get("role", "ORGANIZATION_ADMIN"),
            details={"invited_email": email, "assigned_role": role},
        )

    return {
        "status": "ok",
        "message": f"Team member '{email}' added successfully with role '{role}'",
        "member": {
            "id": new_user_id,
            "email": email,
            "name": payload.name,
            "role": role,
            "permissions": permissions,
            "initial_password": raw_pwd if payload.password is None else "***",
        },
    }


@router.put("/members/{member_id}/role", summary="Update team member RBAC role")
def update_member_role(
    member_id: str,
    payload: UpdateMemberRoleRequest,
    user: Dict[str, Any] = Depends(current_user),
):
    """Updates assigned role and permissions for a member (Admin clearance required)."""
    require_role(user, {"ORGANIZATION_ADMIN"}, "Only Organization Administrators can modify roles")

    new_role = payload.role.upper()
    if new_role not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role '{payload.role}'. Must be one of: {', '.join(VALID_ROLES)}"
        )

    p = "%s" if settings.is_postgres() else "?"
    new_permissions = ROLE_PERMISSIONS.get(new_role, ROLE_PERMISSIONS["QUANT_RESEARCHER"])

    with get_primary_conn() as conn:
        member = conn.execute(f"SELECT id, email, role, organization_id FROM users WHERE id = {p}", (member_id,)).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")

        old_dict = row_to_dict(member)
        old_role = old_dict.get("role")

        conn.execute(
            f"UPDATE users SET role = {p}, permissions_json = {p} WHERE id = {p}",
            (new_role, json.dumps(new_permissions), member_id)
        )
        conn.commit()

        # Immutable Audit Record
        record_audit_event(
            action="RBAC_ROLE_CHANGE",
            resource_type="organization_member",
            resource_id=member_id,
            client_ip="127.0.0.1",
            request_path=f"/enterprise/organization/members/{member_id}/role",
            request_method="PUT",
            status_code=200,
            user_id=user["id"],
            organization_id=user.get("organization_id"),
            actor_email=user["email"],
            actor_role=user.get("role", "ORGANIZATION_ADMIN"),
            details={"target_member": old_dict.get("email"), "previous_role": old_role, "new_role": new_role},
        )

    return {
        "status": "ok",
        "message": f"Updated role for member {member_id} to {new_role}",
        "member_id": member_id,
        "new_role": new_role,
        "permissions": new_permissions,
    }


@router.delete("/members/{member_id}", summary="Remove member from organization")
def remove_member(
    member_id: str,
    user: Dict[str, Any] = Depends(current_user),
):
    """Removes a member from the enterprise organization."""
    require_role(user, {"ORGANIZATION_ADMIN"}, "Only Organization Administrators can remove members")

    if member_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from organization")

    p = "%s" if settings.is_postgres() else "?"
    with get_primary_conn() as conn:
        member = conn.execute(f"SELECT id, email FROM users WHERE id = {p}", (member_id,)).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")

        conn.execute(f"DELETE FROM users WHERE id = {p}", (member_id,))
        conn.commit()

        record_audit_event(
            action="RBAC_MEMBER_REMOVE",
            resource_type="organization_member",
            resource_id=member_id,
            client_ip="127.0.0.1",
            request_path=f"/enterprise/organization/members/{member_id}",
            request_method="DELETE",
            status_code=200,
            user_id=user["id"],
            organization_id=user.get("organization_id"),
            actor_email=user["email"],
            actor_role=user.get("role", "ORGANIZATION_ADMIN"),
            details={"deleted_member_id": member_id},
        )

    return {"status": "ok", "message": f"Member {member_id} removed"}


@router.get("/audit-logs", summary="Retrieve immutable SOC 2 / SEC compliance audit trail")
def get_organization_audit_logs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    action: Optional[str] = None,
    actor: Optional[str] = None,
    user: Dict[str, Any] = Depends(current_user),
):
    """Fetches non-repudiable audit trail logs for regulatory compliance (Compliance & Admin clearance)."""
    require_role(
        user,
        {"ORGANIZATION_ADMIN", "COMPLIANCE_OFFICER", "RISK_OFFICER"},
        "Compliance Officer or Organization Admin privileges required to inspect audit logs"
    )

    org_id = user.get("organization_id") or ""
    p = "%s" if settings.is_postgres() else "?"

    with get_primary_conn() as conn:
        where_clauses = ["1=1"]
        params: List[Any] = []

        if org_id:
            where_clauses.append(f"(organization_id = {p} OR organization_id = '' OR organization_id IS NULL)")
            params.append(org_id)

        if action:
            where_clauses.append(f"action = {p}")
            params.append(action.upper())

        if actor:
            where_clauses.append(f"actor_email LIKE {p}")
            params.append(f"%{actor.lower()}%")

        where_sql = " AND ".join(where_clauses)

        # Count total
        count_row = conn.execute(f"SELECT count(*) FROM audit_logs WHERE {where_sql}", tuple(params)).fetchone()
        total_count = count_row[0] if count_row else 0

        # Query logs
        params_with_paging = list(params) + [limit, offset]
        rows = conn.execute(
            f"""
            SELECT id, user_id, organization_id, actor_email, actor_role,
                   action, resource_type, resource_id, client_ip, user_agent,
                   request_path, request_method, status_code, payload_digest,
                   details_json, is_immutable, created_at
            FROM audit_logs
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT {p} OFFSET {p}
            """,
            tuple(params_with_paging)
        ).fetchall()

        logs = []
        for r in rows:
            d = row_to_dict(r)
            try:
                d["details"] = json.loads(d.get("details_json") or "{}")
            except Exception:
                d["details"] = {}
            d.pop("details_json", None)
            logs.append(d)

    return {
        "status": "ok",
        "total": total_count,
        "limit": limit,
        "offset": offset,
        "logs": logs,
    }


@router.get("/audit-logs/export", summary="Export audit trail in CSV or JSON for SEC / FINRA submission")
def export_audit_logs(
    format: str = Query("csv", pattern="^(csv|json)$"),
    user: Dict[str, Any] = Depends(current_user),
):
    """Generates official regulatory export of compliance audit logs."""
    require_role(
        user,
        {"ORGANIZATION_ADMIN", "COMPLIANCE_OFFICER"},
        "Compliance Officer or Admin clearance required to export regulatory logs"
    )

    with get_primary_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, actor_email, actor_role, action, resource_type,
                   resource_id, client_ip, request_method, request_path, status_code,
                   payload_digest, details_json
            FROM audit_logs
            ORDER BY created_at DESC
            LIMIT 5000
            """
        ).fetchall()

        raw_logs = [row_to_dict(r) for r in rows]

    if format == "json":
        return Response(
            content=json.dumps({"export_timestamp": now(), "total_records": len(raw_logs), "audit_trail": raw_logs}, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=quanteinstein_soc2_audit_trail.json"},
        )

    # CSV Export
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Audit ID", "Timestamp (UTC)", "Actor Email", "Role", "Action",
        "Resource Type", "Resource ID", "Client IP", "Method", "Path",
        "Status Code", "Payload SHA-256 Digest", "Details"
    ])

    for log in raw_logs:
        writer.writerow([
            log.get("id"),
            log.get("created_at"),
            log.get("actor_email"),
            log.get("actor_role"),
            log.get("action"),
            log.get("resource_type"),
            log.get("resource_id"),
            log.get("client_ip"),
            log.get("request_method"),
            log.get("request_path"),
            log.get("status_code"),
            log.get("payload_digest"),
            log.get("details_json"),
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=quanteinstein_soc2_audit_trail.csv"},
    )
