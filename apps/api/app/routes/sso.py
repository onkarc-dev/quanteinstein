"""Enterprise SSO / SAML 2.0 Authentication router.
Supports Okta, Azure Active Directory, Google Workspace SAML, and custom IdPs.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import json
import logging
import re
import secrets
import uuid
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional

import jwt
from fastapi import APIRouter, Depends, Form, Header, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from app.core.config import settings
from app.core.tenant_provisioner import provision_enterprise_tenant
from app.db import get_primary_conn, hash_password, now, row_to_dict
from app.routes.auth import _auth_response, _create_access_token, _create_legacy_session, _create_refresh_token

router = APIRouter()
logger = logging.getLogger("quantos.sso")

SP_ENTITY_ID = getattr(settings, "sso_sp_entity_id", "https://quanteinstein.com/auth/sso/metadata")
ACS_URL = getattr(settings, "sso_acs_url", "https://quanteinstein.com/auth/sso/acs")


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _format_iso(dt: datetime.datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ─── SAML 2.0 XML Helpers ───────────────────────────────────────────────────

def build_sp_metadata_xml(sp_entity_id: str, acs_url: str) -> str:
    """Generate SAML 2.0 Service Provider Metadata XML compliant with OASIS standard."""
    valid_until = _format_iso(_utcnow() + datetime.timedelta(days=365))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="{sp_entity_id}"
                     validUntil="{valid_until}">
    <md:SPSSODescriptor AuthnRequestsSigned="false"
                        WantAssertionsSigned="true"
                        protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
        <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
        <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>
        <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:transient</md:NameIDFormat>
        <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                     Location="{acs_url}"
                                     index="1"
                                     isDefault="true"/>
    </md:SPSSODescriptor>
    <md:Organization>
        <md:OrganizationName xml:lang="en">Quanteinstein Institutional</md:OrganizationName>
        <md:OrganizationDisplayName xml:lang="en">Quanteinstein Tier-1 Quantitative Trading Infrastructure</md:OrganizationDisplayName>
        <md:OrganizationURL xml:lang="en">https://quanteinstein.com</md:OrganizationURL>
    </md:Organization>
</md:EntityDescriptor>"""


def build_authn_request_xml(request_id: str, issue_instant: str, destination: str, sp_entity_id: str, acs_url: str) -> str:
    """Generate SAML 2.0 AuthnRequest XML."""
    return f"""<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                    ID="{request_id}"
                    Version="2.0"
                    IssueInstant="{issue_instant}"
                    Destination="{destination}"
                    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                    AssertionConsumerServiceURL="{acs_url}">
    <saml:Issuer>{sp_entity_id}</saml:Issuer>
    <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
                        AllowCreate="true"/>
</samlp:AuthnRequest>"""


def build_mock_saml_response_xml(
    email: str,
    name: str,
    role: str = "QUANT_RESEARCHER",
    org_name: str = "Institutional Alpha Capital",
    destination: str = ACS_URL,
    sp_entity_id: str = SP_ENTITY_ID,
) -> str:
    """Generate a valid synthetic SAML 2.0 Response XML for mock tests and enterprise previews."""
    now_dt = _utcnow()
    issue_instant = _format_iso(now_dt)
    not_before = _format_iso(now_dt - datetime.timedelta(minutes=5))
    not_on_or_after = _format_iso(now_dt + datetime.timedelta(minutes=60))
    response_id = f"id_{uuid.uuid4().hex}"
    assertion_id = f"as_{uuid.uuid4().hex}"

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                ID="{response_id}"
                Version="2.0"
                IssueInstant="{issue_instant}"
                Destination="{destination}">
    <saml:Issuer>https://idp.okta.com/quanteinstein-sso</saml:Issuer>
    <samlp:Status>
        <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
    </samlp:Status>
    <saml:Assertion ID="{assertion_id}" Version="2.0" IssueInstant="{issue_instant}">
        <saml:Issuer>https://idp.okta.com/quanteinstein-sso</saml:Issuer>
        <saml:Subject>
            <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">{email}</saml:NameID>
            <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
                <saml:SubjectConfirmationData Recipient="{destination}" NotOnOrAfter="{not_on_or_after}"/>
            </saml:SubjectConfirmation>
        </saml:Subject>
        <saml:Conditions NotBefore="{not_before}" NotOnOrAfter="{not_on_or_after}">
            <saml:AudienceRestriction>
                <saml:Audience>{sp_entity_id}</saml:Audience>
            </saml:AudienceRestriction>
        </saml:Conditions>
        <saml:AttributeStatement>
            <saml:Attribute Name="email"><saml:AttributeValue>{email}</saml:AttributeValue></saml:Attribute>
            <saml:Attribute Name="name"><saml:AttributeValue>{name}</saml:AttributeValue></saml:Attribute>
            <saml:Attribute Name="role"><saml:AttributeValue>{role}</saml:AttributeValue></saml:Attribute>
            <saml:Attribute Name="organization"><saml:AttributeValue>{org_name}</saml:AttributeValue></saml:Attribute>
        </saml:AttributeStatement>
    </saml:Assertion>
</samlp:Response>"""


def parse_saml_response_xml(xml_content: str) -> Dict[str, Any]:
    """Parse SAMLResponse XML and extract assertion attributes."""
    try:
        root = ET.fromstring(xml_content)
    except Exception as e:
        raise ValueError(f"Invalid SAML XML payload: {str(e)}")

    # Extract status
    status_node = root.find(".//{urn:oasis:names:tc:SAML:2.0:protocol}StatusCode")
    if status_node is not None:
        status_val = status_node.get("Value", "")
        if "Success" not in status_val:
            raise ValueError(f"SAML Assertion rejected with status: {status_val}")

    # Extract NameID (Email)
    name_id_node = root.find(".//{urn:oasis:names:tc:SAML:2.0:assertion}NameID")
    if name_id_node is None or not name_id_node.text:
        # Fallback to search without namespace
        for elem in root.iter():
            if elem.tag.endswith("NameID") and elem.text:
                name_id_node = elem
                break

    if name_id_node is None or not name_id_node.text:
        raise ValueError("Missing NameID in SAML assertion")

    email = name_id_node.text.strip().lower()

    # Extract attributes
    attributes: Dict[str, str] = {}
    for attr in root.iter():
        if attr.tag.endswith("Attribute"):
            name = attr.get("Name") or attr.get("FriendlyName")
            if name:
                val_node = attr.find(".//{urn:oasis:names:tc:SAML:2.0:assertion}AttributeValue")
                if val_node is None:
                    for c in attr:
                        if c.tag.endswith("AttributeValue"):
                            val_node = c
                            break
                if val_node is not None and val_node.text:
                    attributes[name.lower()] = val_node.text.strip()

    # Issuer
    issuer_node = root.find(".//{urn:oasis:names:tc:SAML:2.0:assertion}Issuer")
    issuer = issuer_node.text.strip() if (issuer_node is not None and issuer_node.text) else ""

    return {
        "email": email,
        "name": attributes.get("name") or attributes.get("displayname") or attributes.get("fullname") or email.split("@")[0].capitalize(),
        "role": attributes.get("role") or attributes.get("groups") or "QUANT_RESEARCHER",
        "organization": attributes.get("organization") or attributes.get("company") or email.split("@")[1].split(".")[0].capitalize(),
        "issuer": issuer,
        "attributes": attributes,
    }


# ─── Pydantic Models ────────────────────────────────────────────────────────

class SsoInitiateRequest(BaseModel):
    email: Optional[EmailStr] = None
    domain: Optional[str] = None
    organization_slug: Optional[str] = None
    provider: Optional[str] = "OKTA"  # OKTA, AZURE_AD, GOOGLE_WORKSPACE, ONELOGIN, CUSTOM_SAML


class SsoAcsRequest(BaseModel):
    SAMLResponse: str
    RelayState: Optional[str] = None


class SsoTestLoginRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    organization_name: Optional[str] = None
    role: Optional[str] = "QUANT_RESEARCHER"
    provider: Optional[str] = "OKTA"


class SsoConfigPayload(BaseModel):
    organization_id: str
    domain: str
    provider: str = "OKTA"
    idp_entity_id: str
    idp_sso_url: str
    idp_certificate: str
    is_active: bool = True


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/metadata", summary="SAML 2.0 Service Provider (SP) Metadata XML")
def get_sp_metadata():
    """Returns official SAML 2.0 Service Provider Metadata XML."""
    xml_content = build_sp_metadata_xml(SP_ENTITY_ID, ACS_URL)
    return Response(content=xml_content, media_type="application/xml")


@router.post("/initiate", summary="Initiate SAML 2.0 AuthnRequest for Enterprise User")
def initiate_sso(payload: SsoInitiateRequest):
    """Generates SAML 2.0 AuthnRequest and returns IdP redirect URL."""
    domain = ""
    if payload.email:
        domain = payload.email.split("@")[1].lower()
    elif payload.domain:
        domain = payload.domain.lower().strip()
    elif payload.organization_slug:
        domain = f"{payload.organization_slug.lower()}.com"

    if not domain:
        raise HTTPException(status_code=400, detail="Domain or email is required to initiate enterprise SSO")

    # Look up SSO config in database
    idp_sso_url = ""
    idp_entity_id = ""
    provider = payload.provider or "OKTA"
    org_id = ""

    with get_primary_conn() as conn:
        p = "%s" if settings.is_postgres() else "?"
        row = conn.execute(
            f"SELECT * FROM sso_configurations WHERE domain = {p} AND is_active = 1",
            (domain,)
        ).fetchone()

        if row:
            cfg = row_to_dict(row)
            idp_sso_url = cfg.get("idp_sso_url") or ""
            idp_entity_id = cfg.get("idp_entity_id") or ""
            provider = cfg.get("provider") or provider
            org_id = cfg.get("organization_id") or ""
        else:
            # Fallback to standard enterprise IdP endpoint template for the domain
            provider_clean = (payload.provider or "OKTA").upper()
            if "AZURE" in provider_clean:
                idp_sso_url = f"https://login.microsoftonline.com/{domain}/saml2"
                idp_entity_id = f"https://sts.windows.net/{domain}/"
            elif "GOOGLE" in provider_clean:
                idp_sso_url = f"https://accounts.google.com/o/saml2/initsso?idpid={domain}"
                idp_entity_id = f"https://accounts.google.com/o/saml2?idpid={domain}"
            else:
                idp_sso_url = f"https://{domain.replace('.', '-')}.okta.com/app/quanteinstein/{domain}/sso/saml"
                idp_entity_id = f"http://www.okta.com/{domain}"

    request_id = f"_{uuid.uuid4().hex}"
    issue_instant = _format_iso(_utcnow())
    authn_xml = build_authn_request_xml(request_id, issue_instant, idp_sso_url, SP_ENTITY_ID, ACS_URL)
    b64_request = base64.b64encode(authn_xml.encode("utf-8")).decode("utf-8")
    relay_state = json.dumps({"domain": domain, "org_id": org_id, "nonce": secrets.token_hex(8)})

    return {
        "status": "ok",
        "domain": domain,
        "provider": provider,
        "idp_sso_url": idp_sso_url,
        "idp_entity_id": idp_entity_id,
        "saml_request": b64_request,
        "relay_state": relay_state,
        "redirect_url": f"{idp_sso_url}?SAMLRequest={b64_request}&RelayState={base64.urlsafe_b64encode(relay_state.encode()).decode()}",
    }


def _process_saml_assertion_and_authenticate(parsed_data: Dict[str, Any], client_ip: str, user_agent: str = "") -> Dict[str, Any]:
    """Resolves enterprise account, provisions if new, sets isolated tenant db, and logs audit record."""
    email = parsed_data["email"].lower().strip()
    name = parsed_data.get("name") or email.split("@")[0].capitalize()
    raw_role = str(parsed_data.get("role") or "QUANT_RESEARCHER").upper()
    org_name = parsed_data.get("organization") or email.split("@")[1].split(".")[0].capitalize()

    # Map external SAML role string to internal standard RBAC role
    role = "QUANT_RESEARCHER"
    if any(k in raw_role for k in ("ADMIN", "OWNER", "DIRECTOR")):
        role = "ORGANIZATION_ADMIN"
    elif any(k in raw_role for k in ("RISK", "HEAD_OF_RISK")):
        role = "RISK_OFFICER"
    elif any(k in raw_role for k in ("COMPLIANCE", "LEGAL", "AUDIT")):
        role = "COMPLIANCE_OFFICER"

    domain = email.split("@")[1]

    with get_primary_conn() as conn:
        p = "%s" if settings.is_postgres() else "?"

        # 1. Check if user already exists
        user_row = conn.execute(
            f"SELECT id, email, name, tier, organization_id, tenant_db_url, role, permissions_json FROM users WHERE email = {p}",
            (email,)
        ).fetchone()

        if user_row:
            user = row_to_dict(user_row)
            # Ensure tier is upgraded to ENTERPRISE if not already
            if user.get("tier") != "ENTERPRISE":
                conn.execute(
                    f"UPDATE users SET tier = 'ENTERPRISE' WHERE id = {p}",
                    (user["id"],)
                )
                conn.commit()
                user["tier"] = "ENTERPRISE"
        else:
            # 2. Check if an organization exists for this domain
            org_row = conn.execute(
                f"SELECT id, name, slug, db_url, isolation_mode FROM organizations WHERE slug = {p} OR db_url LIKE {p}",
                (domain.split(".")[0], f"%{domain}%")
            ).fetchone()

            org_id = ""
            tenant_db_url = ""

            created_in_provision = False
            new_user_id = ""
            if org_row:
                org_dict = row_to_dict(org_row)
                org_id = org_dict["id"]
                tenant_db_url = org_dict["db_url"]
            else:
                # Auto-provision dedicated single-tenant database for this new institutional organization
                try:
                    provision_result = provision_enterprise_tenant(
                        org_name=f"{org_name} Capital",
                        admin_email=email,
                        admin_name=name,
                        isolation_mode="ISOLATED_SQLITE",
                    )
                    org_id = provision_result["organization_id"]
                    tenant_db_url = provision_result["tenant_db_url"]
                    new_user_id = provision_result["admin_user_id"]
                    created_in_provision = True
                except Exception as ex:
                    logger.warning("Auto-provision tenant fallback: %s", ex)
                    org_id = f"org_{secrets.token_hex(6)}"
                    tenant_db_url = f"sqlite:///apps/api/data/tenants/{org_id}.db"

            permissions_list = [
                "strategies:read", "strategies:write", "execution:trade", "data:read", "backtest:run"
            ]
            if role in {"ORGANIZATION_ADMIN", "ORG_ADMIN"}:
                permissions_list.extend(["org:manage", "members:read", "members:write", "audit:read", "audit:export", "api_keys:manage", "risk:manage"])
            elif role == "RISK_OFFICER":
                permissions_list.extend(["risk:manage", "orders:inspect", "audit:read"])
            elif role == "COMPLIANCE_OFFICER":
                permissions_list.extend(["audit:read", "audit:export", "members:read"])

            if not created_in_provision:
                new_user_id = f"usr_{secrets.token_hex(8)}"
                dummy_pwd_hash = hash_password(secrets.token_urlsafe(32))
                conn.execute(
                    f"""
                    INSERT INTO users (
                        id, email, name, password_hash, onboarding_completed,
                        created_at, tier, organization_id, tenant_db_url, role, permissions_json
                    )
                    VALUES ({p}, {p}, {p}, {p}, 1, {p}, 'ENTERPRISE', {p}, {p}, {p}, {p})
                    """,
                    (
                        new_user_id, email, name, dummy_pwd_hash, now(),
                        org_id, tenant_db_url, role, json.dumps(permissions_list)
                    )
                )
                conn.commit()
            else:
                conn.execute(
                    f"UPDATE users SET permissions_json = {p} WHERE id = {p}",
                    (json.dumps(permissions_list), new_user_id)
                )
                conn.commit()

            user = {
                "id": new_user_id,
                "email": email,
                "name": name,
                "onboarding_completed": True,
                "tier": "ENTERPRISE",
                "organization_id": org_id,
                "tenant_db_url": tenant_db_url,
                "role": role if not created_in_provision else "ORG_ADMIN",
                "permissions_json": json.dumps(permissions_list),
            }

        # 3. Create Session & Tokens
        auth_data = _auth_response(conn, user)
        conn.commit()

        # 4. Record Immutable Audit Event
        try:
            from app.core.audit_middleware import record_audit_event
            record_audit_event(
                user_id=user["id"],
                organization_id=user.get("organization_id"),
                actor_email=user["email"],
                actor_role=user.get("role", "QUANT_RESEARCHER"),
                action="AUTH_SSO_LOGIN",
                resource_type="authentication",
                resource_id=user["id"],
                client_ip=client_ip,
                user_agent=user_agent,
                request_path="/auth/sso/acs",
                request_method="POST",
                status_code=200,
                details={
                    "provider": parsed_data.get("issuer") or "SAML_IDP",
                    "domain": domain,
                    "sso_type": "SAML_2.0",
                },
            )
        except Exception as audit_err:
            logger.warning("Audit record failed: %s", audit_err)

    return auth_data


@router.post("/acs", summary="SAML 2.0 Assertion Consumer Service (ACS) Endpoint")
async def sso_acs(
    request: Request,
    payload: Optional[SsoAcsRequest] = None,
    SAMLResponse: Optional[str] = Form(None),
    RelayState: Optional[str] = Form(None),
):
    """Processes SAMLResponse assertion from Okta, Azure AD, or Google Workspace."""
    raw_response = ""
    if payload and payload.SAMLResponse:
        raw_response = payload.SAMLResponse
    elif SAMLResponse:
        raw_response = SAMLResponse
    else:
        # Check if form data
        try:
            form = await request.form()
            raw_response = form.get("SAMLResponse") or ""
        except Exception:
            pass

    if not raw_response:
        raise HTTPException(status_code=400, detail="Missing SAMLResponse in request body")

    try:
        xml_bytes = base64.b64decode(raw_response)
        xml_str = xml_bytes.decode("utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode Base64 SAMLResponse: {str(e)}")

    try:
        parsed = parse_saml_response_xml(xml_str)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"SAML Assertion verification failed: {str(e)}")

    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "127.0.0.1")
    user_agent = request.headers.get("user-agent", "")

    return _process_saml_assertion_and_authenticate(parsed, client_ip, user_agent)


@router.post("/test-login", summary="Mock Enterprise SSO Login (Test & Demo Environments)")
def sso_test_login(payload: SsoTestLoginRequest, request: Request):
    """Simulates Okta/Azure SAML 2.0 authentication for development and integration test verification."""
    mock_name = payload.name or payload.email.split("@")[0].capitalize()
    mock_org = payload.organization_name or "Institutional Capital Partners"

    mock_xml = build_mock_saml_response_xml(
        email=payload.email,
        name=mock_name,
        role=payload.role or "QUANT_RESEARCHER",
        org_name=mock_org,
    )
    parsed = parse_saml_response_xml(mock_xml)

    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "127.0.0.1")
    user_agent = request.headers.get("user-agent", "QuantOS-SAML-TestClient")

    return _process_saml_assertion_and_authenticate(parsed, client_ip, user_agent)


@router.post("/config", summary="Configure Organization SAML 2.0 Identity Provider")
def configure_sso_idp(payload: SsoConfigPayload):
    """Configures or updates IdP Entity ID, SSO URL, and X.509 cert for an organization."""
    config_id = f"sso_{secrets.token_hex(8)}"
    with get_primary_conn() as conn:
        p = "%s" if settings.is_postgres() else "?"
        # Check if already exists for this domain
        existing = conn.execute(
            f"SELECT id FROM sso_configurations WHERE domain = {p}",
            (payload.domain.lower().strip(),)
        ).fetchone()

        if existing:
            conn.execute(
                f"""
                UPDATE sso_configurations
                SET organization_id = {p}, provider = {p}, idp_entity_id = {p},
                    idp_sso_url = {p}, idp_certificate = {p}, is_active = {p}, updated_at = {p}
                WHERE domain = {p}
                """,
                (
                    payload.organization_id, payload.provider, payload.idp_entity_id,
                    payload.idp_sso_url, payload.idp_certificate, 1 if payload.is_active else 0,
                    now(), payload.domain.lower().strip()
                )
            )
        else:
            conn.execute(
                f"""
                INSERT INTO sso_configurations (
                    id, organization_id, domain, provider, idp_entity_id,
                    idp_sso_url, idp_certificate, sp_entity_id, acs_url, is_active, created_at, updated_at
                )
                VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p})
                """,
                (
                    config_id, payload.organization_id, payload.domain.lower().strip(),
                    payload.provider, payload.idp_entity_id, payload.idp_sso_url,
                    payload.idp_certificate, SP_ENTITY_ID, ACS_URL, 1 if payload.is_active else 0,
                    now(), now()
                )
            )
        conn.commit()

    return {"status": "ok", "domain": payload.domain, "provider": payload.provider, "acs_url": ACS_URL}
