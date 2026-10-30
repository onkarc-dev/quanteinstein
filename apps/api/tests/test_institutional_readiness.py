import os
import secrets
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.shm_order_bridge import (
    shm_order_bridge,
    ShmOrderSubmission,
    ShmExecutionReport,
    SHM_MAGIC_ORDER_SUB,
    SHM_MAGIC_EXEC_REP,
)
from app.core.institutional_risk_gateway import (
    risk_gateway,
    BorrowLocateManager,
)
from app.core.audit_middleware import (
    record_audit_event,
    verify_merkle_audit_chain,
    compute_payload_digest,
)
from app.core.crypto_vault import (
    encrypt_credential,
    decrypt_credential,
    is_production,
    check_production_security,
)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_shm_binary_struct_alignment():
    """Validates #pragma pack(push, 1) exact binary struct sizing."""
    import ctypes
    assert ctypes.sizeof(ShmOrderSubmission) == 353
    assert ctypes.sizeof(ShmExecutionReport) == 368


def test_shm_order_bridge_dispatch_and_poll():
    """Tests zero-copy shared-memory IPC dispatch and execution polling."""
    sub = shm_order_bridge.submit_order_ipc(
        user_id="inst_user_99",
        org_id="tier1alpha_org",
        symbol="NVDA",
        side="BUY",
        quantity=500.0,
        order_type="LIMIT",
        limit_price=135.50,
        asset_class="EQUITY",
    )
    assert sub["status"] == "QUEUED_IPC"
    assert sub["symbol"] == "NVDA"
    assert sub["side"] == "BUY"
    assert sub["limit_price"] == 135.50
    assert sub["ipc_latency_us"] < 5.0

    exec_rep = shm_order_bridge.poll_execution_report_ipc(sub["client_order_id"], timeout_ms=300)
    assert exec_rep is not None
    assert exec_rep["client_order_id"] == sub["client_order_id"]
    assert exec_rep["symbol"] == "NVDA"
    assert exec_rep["status"] == "FILLED"
    assert exec_rep["qty"] == 500.0
    assert exec_rep["fill_price"] == 135.50


def test_sec_reg_sho_rule_203b1_borrow_locate_verification():
    """Enforces SEC Reg SHO borrow locate verification for short sales."""
    mgr = BorrowLocateManager()
    
    # 1. Reject unverified short sale without locate ID
    approved, rej, alloc = mgr.verify_and_allocate_locate(
        org_id="tier1alpha_org",
        symbol="TSLA",
        quantity=100.0,
        locate_id=None,
    )
    assert approved is False
    assert "Rule 203(b)(1)" in (rej or "")

    # 2. Reject short sale with invalid/non-existent locate ID
    approved, rej, alloc = mgr.verify_and_allocate_locate(
        org_id="tier1alpha_org",
        symbol="TSLA",
        quantity=100.0,
        locate_id="NON_EXISTENT_LOCATE_999",
    )
    assert approved is False
    assert "Specified Borrow Locate ID" in (rej or "")

    # 3. Add legitimate Prime Broker borrow locate
    loc = mgr.add_locate(
        org_id="tier1alpha_org",
        symbol="TSLA",
        quantity=5000.0,
        locate_id="LOC-PB-TSLA-001",
        borrow_rate_bps=65.0,
        prime_broker="GS_GSET",
        is_hard_to_borrow=True,
    )
    assert loc.locate_id == "LOC-PB-TSLA-001"

    # 4. Successful verification and allocation
    approved, rej, alloc = mgr.verify_and_allocate_locate(
        org_id="tier1alpha_org",
        symbol="TSLA",
        quantity=200.0,
        locate_id="LOC-PB-TSLA-001",
    )
    assert approved is True
    assert alloc["locate_id"] == "LOC-PB-TSLA-001"
    assert alloc["borrow_rate_bps"] == 65.0

    # 5. Full gateway validation enforces short locate
    gw_app, gw_rej, _ = risk_gateway.validate_order(
        org_id="tier1alpha_org",
        symbol="TSLA",
        side="SHORT_SELL",
        qty=100.0,
        price=220.0,
        bbo_price=220.0,
        borrow_locate_id=None,
    )
    assert gw_app is False
    assert "Rule 203(b)(1)" in (gw_rej or "")


def test_cryptographic_merkle_tree_hash_chain():
    """Validates Merkle-tree cryptographic hash chaining and tamper-evidence."""
    test_org = f"tier1_merkle_{secrets.token_hex(4)}"
    # Record chained audit events
    id1 = record_audit_event(
        action="ORDER_SUBMISSION_DMA",
        resource_type="FIX_ORDER",
        client_ip="127.0.0.1",
        request_path="/api/v1/execution/order",
        request_method="POST",
        user_id="aud_usr_1",
        organization_id=test_org,
        actor_email="quant1@tier1.com",
        actor_role="ORGANIZATION_ADMIN",
        resource_id="ord_101",
        payload_digest=compute_payload_digest('{"symbol": "NVDA", "qty": 100}'),
    )
    assert id1 is not None

    id2 = record_audit_event(
        action="ORDER_EXECUTION_FILL",
        resource_type="EXEC_REPORT",
        client_ip="127.0.0.1",
        request_path="/api/v1/execution/order",
        request_method="POST",
        user_id="aud_usr_1",
        organization_id=test_org,
        actor_email="quant1@tier1.com",
        actor_role="ORGANIZATION_ADMIN",
        resource_id="rep_101",
        payload_digest=compute_payload_digest('{"symbol": "NVDA", "qty": 100, "fill_price": 135.50}'),
    )
    assert id2 is not None

    # Verify Merkle chain integrity
    res = verify_merkle_audit_chain(test_org)
    assert res["chain_status"] == "SECURE_VERIFIED"
    assert res["total_blocks_verified"] >= 2
    assert res["root_merkle_hash"] is not None
    assert res["verification_latency_us"] >= 0


def test_kms_fails_closed_in_production(monkeypatch):
    """Enforces that KMS fails-closed without fallbacks when ENVIRONMENT=production."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("AWS_KMS_KEY_ID", raising=False)
    monkeypatch.delenv("GCP_KMS_KEY_NAME", raising=False)

    assert is_production() is True
    # In production without KMS configuration, check_production_security raises RuntimeError
    with pytest.raises(RuntimeError) as exc_info:
        check_production_security()
    assert "CRITICAL SECURITY VIOLATION: Production mode" in str(exc_info.value)

    # encrypt_credential must also fail-closed in production without KMS
    with pytest.raises(RuntimeError) as exc_info:
        encrypt_credential("secret_api_key_12345")
    assert "CRITICAL SECURITY VIOLATION: Production" in str(exc_info.value)
