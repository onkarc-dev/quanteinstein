"""Unit tests for the admin platform telemetry and oversight API."""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
ADMIN_HEADERS = {"X-Admin-Key": "onkarchouguletrader"}


def test_admin_unauthorized_access():
    """Ensure unauthenticated/unauthorized users cannot access admin endpoints."""
    assert client.get("/admin/overview").status_code == 403
    assert client.get("/admin/users").status_code == 403
    assert client.get("/admin/backtests").status_code == 403
    assert client.get("/admin/paper-sessions").status_code == 403
    assert client.get("/admin/activity").status_code == 403
    assert client.post("/admin/users/test_user/toggle-status", json={"suspended": True}).status_code == 403


def test_admin_overview():
    response = client.get("/admin/overview", headers=ADMIN_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "kpis" in data
    assert "system_health" in data

    kpis = data["kpis"]
    assert kpis["total_registered_users"] >= 0
    assert kpis["total_backtests_run"] >= 0
    assert kpis["active_paper_sessions_now"] >= 0


def test_admin_users():
    response = client.get("/admin/users", headers=ADMIN_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "users" in data
    assert len(data["users"]) > 0

    first_user = data["users"][0]
    assert "email" in first_user
    assert "status" in first_user
    assert "backtests_count" in first_user


def test_admin_backtests_and_paper_sessions():
    bt_res = client.get("/admin/backtests", headers=ADMIN_HEADERS)
    assert bt_res.status_code == 200
    bt_data = bt_res.json()
    assert "backtests" in bt_data

    ps_res = client.get("/admin/paper-sessions", headers=ADMIN_HEADERS)
    assert ps_res.status_code == 200
    ps_data = ps_res.json()
    assert "sessions" in ps_data


def test_admin_activity():
    response = client.get("/admin/activity", headers=ADMIN_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert "activities" in data


def test_admin_toggle_user_status():
    payload = {"suspended": True}
    res = client.post("/admin/users/test_trader_id/toggle-status", json=payload, headers=ADMIN_HEADERS)
    assert res.status_code == 200
    assert res.json()["account_status"] == "SUSPENDED"

    # Reactivate
    res2 = client.post("/admin/users/test_trader_id/toggle-status", json={"suspended": False}, headers=ADMIN_HEADERS)
    assert res2.status_code == 200
    assert res2.json()["account_status"] == "ACTIVE"

