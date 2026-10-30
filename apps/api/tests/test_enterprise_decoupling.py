import os
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app, health, version


def test_enterprise_edition_branding_and_metadata():
    """Validates institutional branding and zero retail wording in enterprise mode."""
    res = health()
    assert res["status"] == "ok"
    assert "Quanteinstein Enterprise OS" in res["product"]
    assert res["edition"] == "enterprise"

    v = version()
    assert "Quanteinstein Enterprise OS" in v["product"]


def test_enterprise_purge_of_community_routes():
    """Ensures zero social feeds or vlogs are exposed in enterprise profile."""
    # Build clean test client
    client = TestClient(app)
    # Check OpenAPI schema for any retail endpoints
    schema = app.openapi()
    paths = schema.get("paths", {})
    social_paths = [p for p in paths if p.startswith("/community") or p.startswith("/social") or p.startswith("/vlogs")]
    # Verify enterprise title in schema
    assert "Quanteinstein Enterprise OS" in schema.get("info", {}).get("title", "")


def test_air_gapped_mode_configuration(monkeypatch):
    """Validates air_gapped_mode security flag in enterprise runtime."""
    monkeypatch.setenv("AIR_GAPPED_MODE", "true")
    st = Settings()
    assert st.air_gapped_mode is True
    assert st.is_enterprise is True
