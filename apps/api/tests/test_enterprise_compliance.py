"""Unit and integration tests for Enterprise Compliance, SAML 2.0 SSO, Immutable Audit Trail, and RBAC."""
import datetime
import json
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_primary_conn, now
from app.core.config import settings
from app.core.tenant_provisioner import _init_tenant_schema

client = TestClient(app)

TENANT_URL = "sqlite:///apps/api/data/tenants/org_tier1.db"


def get_token_for(user_id: str, email: str, tier: str, org_id: str, role: str) -> str:
    import jwt
    exp = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
    token = jwt.encode(
        {
            "sub": user_id,
            "email": email,
            "tier": tier,
            "org_id": org_id,
            "role": role,
            "typ": "access",
            "exp": exp,
        },
        settings.secret_key,
        algorithm="HS256",
    )
    with get_primary_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, '2099-01-01T00:00:00Z', ?)",
            (token, user_id, now())
        )
        conn.commit()
    return token


@pytest.fixture(autouse=True)
def setup_test_users():
    """Seed test enterprise users with discrete RBAC roles and initialize tenant schema."""
    # Ensure tenant schema has all core tables
    _init_tenant_schema(TENANT_URL, "tier1alpha", "ISOLATED_SQLITE")

    with get_primary_conn() as conn:
        # Cleanup any previous test artifacts
        conn.execute("DELETE FROM users WHERE email IN ('risk_analyst@tier1alpha.com', 'hacker@test.com', 'portfolio_mgr@citadelhedge.internal')")

        # 1. Enterprise Organization
        conn.execute(
            """
            INSERT OR REPLACE INTO organizations (id, name, slug, tier, db_url, isolation_mode, created_at, status)
            VALUES ('org_tier1', 'Tier 1 Alpha Management', 'tier1alpha', 'ENTERPRISE', ?, 'DEDICATED_SCHEMA', '2026-01-01T00:00:00Z', 'ACTIVE')
            """,
            (TENANT_URL,)
        )

        # 2. Org Admin
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, email, name, password_hash, onboarding_completed, created_at, tier, organization_id, tenant_db_url, role, permissions_json)
            VALUES ('usr_org_admin', 'admin@tier1alpha.com', 'Sarah Admin', 'dummy', 1, '2026-01-01T00:00:00Z', 'ENTERPRISE', 'org_tier1', ?, 'ORGANIZATION_ADMIN', '["org:manage","members:read","members:write","audit:read"]')
            """,
            (TENANT_URL,)
        )

        # 3. Quant Researcher
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, email, name, password_hash, onboarding_completed, created_at, tier, organization_id, tenant_db_url, role, permissions_json)
            VALUES ('usr_quant_trader', 'trader@tier1alpha.com', 'Alex Quant', 'dummy', 1, '2026-01-01T00:00:00Z', 'ENTERPRISE', 'org_tier1', ?, 'QUANT_RESEARCHER', '["strategies:read","strategies:write","execution:trade"]')
            """,
            (TENANT_URL,)
        )

        # 4. Compliance Officer
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, email, name, password_hash, onboarding_completed, created_at, tier, organization_id, tenant_db_url, role, permissions_json)
            VALUES ('usr_compliance_officer', 'compliance@tier1alpha.com', 'Marcus Legal', 'dummy', 1, '2026-01-01T00:00:00Z', 'ENTERPRISE', 'org_tier1', ?, 'COMPLIANCE_OFFICER', '["audit:read","audit:export"]')
            """,
            (TENANT_URL,)
        )

        # 5. Retail User
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, email, name, password_hash, onboarding_completed, created_at, tier, organization_id, tenant_db_url, role, permissions_json)
            VALUES ('usr_retail_user', 'retail_student@gmail.com', 'Bob Student', 'dummy', 1, '2026-01-01T00:00:00Z', 'RETAIL', NULL, NULL, 'TRADER', '[]')
            """
        )
        conn.commit()


# ─── Task 1: SAML 2.0 / SSO Tests ──────────────────────────────────────────

def test_sso_sp_metadata_endpoint():
    """Verify SAML 2.0 Service Provider Metadata XML endpoint."""
    res = client.get("/auth/sso/metadata")
    assert res.status_code == 200
    assert "application/xml" in res.headers["content-type"]
    xml_str = res.text
    assert "EntityDescriptor" in xml_str
    assert "SPSSODescriptor" in xml_str
    assert "AssertionConsumerService" in xml_str
    assert "emailAddress" in xml_str


def test_sso_initiate_authn_request():
    """Verify SAML AuthnRequest packet creation for corporate domain."""
    res = client.post(
        "/auth/sso/initiate",
        json={"email": "trader@tier1alpha.com", "provider": "OKTA"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["domain"] == "tier1alpha.com"
    assert data["provider"] == "OKTA"
    assert "saml_request" in data
    assert "redirect_url" in data
    assert "SAMLRequest=" in data["redirect_url"]


def test_sso_login_and_auto_provisioning():
    """Simulate SAML 2.0 assertion flow, verifying enterprise auto-provisioning and single-tenant DB binding."""
    res = client.post(
        "/auth/sso/test-login",
        json={
            "email": "portfolio_mgr@citadelhedge.internal",
            "name": "Jane Portfolio Mgr",
            "organization_name": "Citadel Alpha Fund",
            "role": "QUANT_RESEARCHER",
        }
    )
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["user"]["email"] == "portfolio_mgr@citadelhedge.internal"
    assert data["user"]["tier"] == "ENTERPRISE"
    assert data["user"]["role"] in {"QUANT_RESEARCHER", "ORG_ADMIN"}

    # Verify user saved in DB with single-tenant isolated DB URL
    with get_primary_conn() as conn:
        row = conn.execute("SELECT tier, organization_id, tenant_db_url FROM users WHERE email = 'portfolio_mgr@citadelhedge.internal'").fetchone()
        assert row is not None
        assert row[0] == "ENTERPRISE"
        assert row[1] != ""
        assert row[2] != ""


# ─── Task 2: Immutable Audit Log Middleware Tests ─────────────────────────

def test_immutable_audit_log_recording():
    """Verify that enterprise mutating operations create non-repudiable audit records."""
    token = get_token_for("usr_quant_trader", "trader@tier1alpha.com", "ENTERPRISE", "org_tier1", "QUANT_RESEARCHER")

    # Mutating operation on strategies
    res = client.post(
        "/strategies",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Statistical Arbitrage E-Mini",
            "symbols": ["BTCUSDT"],
            "timeframe": "1m",
            "strategy": {"name": "Statistical Arbitrage E-Mini"},
        }
    )
    assert res.status_code == 200

    # Verify audit log recorded in database
    with get_primary_conn() as conn:
        row = conn.execute(
            "SELECT action, actor_email, payload_digest, is_immutable FROM audit_logs WHERE actor_email = 'trader@tier1alpha.com' ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        assert row is not None
        assert row[0] in {"ALGORITHM_CREATE", "HTTP_POST_STRATEGIES"}
        assert row[1] == "trader@tier1alpha.com"
        assert len(row[2]) == 64  # valid SHA-256 hex digest
        assert row[3] == 1


# ─── Task 3: Granular RBAC & Organization Tests ───────────────────────────

def test_organization_details_access():
    """Verify enterprise organization details endpoint."""
    admin_token = get_token_for("usr_org_admin", "admin@tier1alpha.com", "ENTERPRISE", "org_tier1", "ORGANIZATION_ADMIN")
    res = client.get(
        "/enterprise/organization/details",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["organization"]["tier"] == "ENTERPRISE"
    assert data["organization"]["database_status"] == "ONLINE"
    assert "compliance" in data["organization"]
    assert data["organization"]["compliance"]["soc2_type2"] == "ATTESTED"


def test_rbac_trader_cannot_invite_or_modify_roles():
    """Trader / Quant Researcher must NOT have permission to invite or modify roles."""
    trader_token = get_token_for("usr_quant_trader", "trader@tier1alpha.com", "ENTERPRISE", "org_tier1", "QUANT_RESEARCHER")

    # Try to invite a member
    invite_res = client.post(
        "/enterprise/organization/members/invite",
        headers={"Authorization": f"Bearer {trader_token}"},
        json={"email": "hacker@test.com", "name": "Hacker", "role": "ORGANIZATION_ADMIN"}
    )
    assert invite_res.status_code == 403
    assert "Only Organization Administrators" in invite_res.json()["detail"]

    # Try to update a role
    update_res = client.put(
        "/enterprise/organization/members/usr_quant_trader/role",
        headers={"Authorization": f"Bearer {trader_token}"},
        json={"role": "ORGANIZATION_ADMIN"}
    )
    assert update_res.status_code == 403


def test_rbac_admin_can_invite_and_update_roles():
    """Organization Admin can invite members and update roles."""
    admin_token = get_token_for("usr_org_admin", "admin@tier1alpha.com", "ENTERPRISE", "org_tier1", "ORGANIZATION_ADMIN")

    # Invite new Risk Officer
    invite_res = client.post(
        "/enterprise/organization/members/invite",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": "risk_analyst@tier1alpha.com",
            "name": "David Risk",
            "role": "RISK_OFFICER",
        }
    )
    assert invite_res.status_code == 200
    invited = invite_res.json()["member"]
    assert invited["email"] == "risk_analyst@tier1alpha.com"
    assert invited["role"] == "RISK_OFFICER"

    # Promote to Compliance Officer
    update_res = client.put(
        f"/enterprise/organization/members/{invited['id']}/role",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"role": "COMPLIANCE_OFFICER"}
    )
    assert update_res.status_code == 200
    assert update_res.json()["new_role"] == "COMPLIANCE_OFFICER"


def test_rbac_compliance_officer_can_view_and_export_audit_logs():
    """Compliance Officer can access and export immutable audit logs."""
    compliance_token = get_token_for("usr_compliance_officer", "compliance@tier1alpha.com", "ENTERPRISE", "org_tier1", "COMPLIANCE_OFFICER")

    # Query audit logs
    logs_res = client.get(
        "/enterprise/organization/audit-logs?limit=10",
        headers={"Authorization": f"Bearer {compliance_token}"}
    )
    assert logs_res.status_code == 200
    data = logs_res.json()
    assert "logs" in data
    assert isinstance(data["logs"], list)

    # Export audit logs as CSV
    export_res = client.get(
        "/enterprise/organization/audit-logs/export?format=csv",
        headers={"Authorization": f"Bearer {compliance_token}"}
    )
    assert export_res.status_code == 200
    assert "text/csv" in export_res.headers["content-type"]
    assert "Audit ID,Timestamp (UTC),Actor Email" in export_res.text


def test_retail_user_cannot_access_enterprise_organization():
    """Retail user must be rejected with 403 Forbidden."""
    retail_token = get_token_for("usr_retail_user", "retail_student@gmail.com", "RETAIL", "", "TRADER")
    res = client.get(
        "/enterprise/organization/details",
        headers={"Authorization": f"Bearer {retail_token}"}
    )
    assert res.status_code == 403
    assert "Enterprise tier subscription required" in res.json()["detail"]
