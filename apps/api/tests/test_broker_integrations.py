import os
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_primary_conn, row_to_dict
from app.core.crypto_vault import decrypt_credential

class TestBrokerIntegrationsAndTriModeRouter:
    client = TestClient(app)
    retail_id = "test_broker_retail_user"
    retail_token = "qe_tok_broker_retail_123"
    enterprise_id = "test_broker_enterprise_user"
    enterprise_token = "qe_tok_broker_enterprise_456"

    @pytest.fixture(autouse=True)
    def setup_users(self):
        with get_primary_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO users (id, email, password_hash, tier, name, onboarding_completed, created_at)
                VALUES (?, ?, ?, ?, ?, 1, '2026-01-01T00:00:00Z')
                """,
                (self.retail_id, "broker_retail@example.com", "hash", "RETAIL", "Retail Investor"),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at)
                VALUES (?, ?, '2099-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
                """,
                (self.retail_token, self.retail_id),
            )

            conn.execute(
                """
                INSERT OR REPLACE INTO users (id, email, password_hash, tier, name, onboarding_completed, created_at)
                VALUES (?, ?, ?, ?, ?, 1, '2026-01-01T00:00:00Z')
                """,
                (self.enterprise_id, "fund_partner@institutional.com", "hash", "ENTERPRISE", "Fund Partner"),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at)
                VALUES (?, ?, '2099-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
                """,
                (self.enterprise_token, self.enterprise_id),
            )
            conn.commit()

        yield

        with get_primary_conn() as conn:
            conn.execute("DELETE FROM retail_connections WHERE user_id LIKE 'test_broker_%'")
            conn.execute("DELETE FROM enterprise_fix_connections WHERE user_id LIKE 'test_broker_%'")
            conn.execute("DELETE FROM enterprise_execution_settings WHERE user_id LIKE 'test_broker_%'")
            conn.execute("DELETE FROM fix_audit_trail WHERE user_id LIKE 'test_broker_%'")
            conn.execute("DELETE FROM sessions WHERE token IN (?, ?)", (self.retail_token, self.enterprise_token))
            conn.execute("DELETE FROM users WHERE id IN (?, ?)", (self.retail_id, self.enterprise_id))
            conn.commit()

    def test_catalog_endpoint(self):
        res = self.client.get("/api/v1/brokers/catalog")
        assert res.status_code == 200
        data = res.json()
        assert len(data["crypto_exchanges"]) == 25
        assert len(data["forex_brokers"]) == 6
        assert len(data["prime_brokers"]) == 5
        assert data["total_retail"] == 31

    def test_retail_connect_and_encryption(self):
        headers = {"Authorization": f"Bearer {self.retail_token}"}
        raw_key = "binance_live_api_key_8899aabbcc"
        raw_secret = "binance_super_secret_payload_11223344"

        # 1. Connect Binance
        res = self.client.post(
            "/api/v1/brokers/retail/connect",
            json={
                "exchange_name": "binance",
                "account_label": "Algotrading Account",
                "api_key": raw_key,
                "api_secret": raw_secret,
                "is_testnet": False,
            },
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["exchange_name"] == "binance"
        assert "binanc" in data["key_prefix"]
        assert raw_secret not in str(data)

        # 2. Verify Database contains encrypted ciphertexts
        with get_primary_conn() as conn:
            row = conn.execute(
                "SELECT * FROM retail_connections WHERE user_id = ?",
                (self.retail_id,),
            ).fetchone()
            assert row is not None
            d = row_to_dict(row)
            assert d["encrypted_api_key"].startswith("aes256gcm:")
            assert d["encrypted_api_secret"].startswith("aes256gcm:")
            assert raw_key != d["encrypted_api_key"]
            assert raw_secret != d["encrypted_api_secret"]

            # Decrypt verify
            assert decrypt_credential(d["encrypted_api_key"]) == raw_key
            assert decrypt_credential(d["encrypted_api_secret"]) == raw_secret

        # 3. Test ping endpoint
        ping_res = self.client.post(
            "/api/v1/brokers/retail/test",
            json={"exchange_name": "binance", "api_key": raw_key, "api_secret": raw_secret},
            headers=headers,
        )
        assert ping_res.status_code == 200
        assert ping_res.json()["ok"] is True
        assert ping_res.json()["status"] == "VERIFIED"
        assert ping_res.json()["ping_latency_ms"] > 0

        # 4. List connections
        list_res = self.client.get("/api/v1/brokers/retail", headers=headers)
        assert list_res.status_code == 200
        conns = list_res.json()["connections"]
        assert len(conns) == 1
        assert conns[0]["exchange_name"] == "binance"
        assert conns[0]["is_active"] is True

    def test_tri_mode_execution_interceptor(self):
        retail_headers = {"Authorization": f"Bearer {self.retail_token}"}
        enterprise_headers = {"Authorization": f"Bearer {self.enterprise_token}"}

        # ---------------------------------------------------------
        # Scenario A: Retail user in SIMULATED mode -> SIMULATOR
        # ---------------------------------------------------------
        start_res = self.client.post(
            "/live-paper/start",
            json={"symbols": ["BTCUSDT"], "starting_balance": 100000.0},
            headers=retail_headers,
        )
        assert start_res.status_code == 200

        res_paper = self.client.post(
            "/api/v1/execution/order",
            json={"symbol": "BTCUSDT", "side": "BUY", "qty": 0.25, "mode": "SIMULATED"},
            headers=retail_headers,
        )
        assert res_paper.status_code == 200
        assert res_paper.json()["execution_route"] == "SIMULATOR"

        # ---------------------------------------------------------
        # Scenario B: Retail user attempting LIVE mode without connection -> 400
        # ---------------------------------------------------------
        res_no_conn = self.client.post(
            "/api/v1/execution/order",
            json={"symbol": "BTCUSDT", "side": "BUY", "qty": 0.25, "mode": "LIVE"},
            headers=retail_headers,
        )
        assert res_no_conn.status_code == 400
        assert "connect an exchange in the retail broker hub" in res_no_conn.json()["detail"].lower()

        # Connect Coinbase for retail user
        self.client.post(
            "/api/v1/brokers/retail/connect",
            json={
                "exchange_name": "coinbase",
                "account_label": "Coinbase Pro Account",
                "api_key": "coinbase_live_key_9999",
                "api_secret": "coinbase_live_secret_7777",
            },
            headers=retail_headers,
        )

        # ---------------------------------------------------------
        # Scenario C: Retail user in LIVE mode with active connection -> RETAIL_REST_CCXT
        # ---------------------------------------------------------
        res_live_retail = self.client.post(
            "/api/v1/execution/order",
            json={"symbol": "BTCUSDT", "side": "BUY", "qty": 0.5, "mode": "LIVE"},
            headers=retail_headers,
        )
        assert res_live_retail.status_code == 200
        live_trade = res_live_retail.json()
        assert live_trade["ok"] is True
        assert live_trade["execution_route"] == "RETAIL_REST_CCXT"
        assert live_trade["tier"] == "RETAIL"
        assert live_trade["exchange"] == "coinbase"
        assert live_trade["status"] == "FILLED"
        assert live_trade["broker_order_id"].startswith("ORD-COINBASE-")
        assert live_trade["fill_price"] > 0

        # ---------------------------------------------------------
        # Scenario D: Retail user cannot access enterprise FIX setup -> 403
        # ---------------------------------------------------------
        fix_res = self.client.get("/api/v1/brokers/fix", headers=retail_headers)
        assert fix_res.status_code == 403

        # ---------------------------------------------------------
        # Scenario E: Enterprise user connects FIX & trades LIVE -> LIVE_FIX
        # ---------------------------------------------------------
        # Configure Goldman Sachs GSET FIX connection
        fix_conn_res = self.client.post(
            "/api/v1/brokers/fix/connect",
            json={
                "prime_broker_name": "Goldman Sachs Electronic Trading (GSET)",
                "sender_comp_id": "QUANTEINSTEIN_PROD",
                "target_comp_id": "GS_GSET_FIX",
                "host_ip": "fix.gset.goldmansachs.com",
                "port": 9800,
                "fix_version": "FIX.4.4",
                "tls_enabled": True,
                "heartbeat_interval_sec": 30,
            },
            headers=enterprise_headers,
        )
        assert fix_conn_res.status_code == 200
        assert fix_conn_res.json()["ok"] is True

        # Test FIX session
        test_session_res = self.client.post(
            "/api/v1/brokers/fix/test-session",
            json={"prime_broker_name": "Goldman Sachs Electronic Trading (GSET)", "fix_version": "FIX.4.4"},
            headers=enterprise_headers,
        )
        assert test_session_res.status_code == 200
        assert test_session_res.json()["status"] == "SESSION_ESTABLISHED"
        assert test_session_res.json()["handshake_latency_us"] > 0

        # Set mode to LIVE_FIX
        self.client.post("/api/v1/execution/mode", json={"mode": "LIVE_FIX"}, headers=enterprise_headers)

        # Submit LIVE Enterprise Order
        res_live_fix = self.client.post(
            "/api/v1/execution/order",
            json={"symbol": "BTCUSDT", "side": "BUY", "qty": 1.0, "mode": "LIVE"},
            headers=enterprise_headers,
        )
        assert res_live_fix.status_code == 200
        fix_trade = res_live_fix.json()
        assert fix_trade["ok"] is True
        assert fix_trade["execution_route"] == "LIVE_FIX"
        assert fix_trade["tier"] == "ENTERPRISE"
        assert fix_trade["status"] == "FILLED"
        assert fix_trade["broker_order_id"].startswith("PB-QE-FIX-")
        assert fix_trade["fix_details"]["version"] == "FIX.4.4"

    def test_enterprise_tls_certificate_upload(self):
        enterprise_headers = {"Authorization": f"Bearer {self.enterprise_token}"}
        retail_headers = {"Authorization": f"Bearer {self.retail_token}"}

        sample_pem = (
            b"-----BEGIN CERTIFICATE-----\n"
            b"MIIBkTCB+wIJAL7c8R/e...QUANTEINSTEIN_PRIME_BROKER_CLIENT_CERT\n"
            b"-----END CERTIFICATE-----\n"
        )

        # 1. Retail upload blocked
        res_retail = self.client.post(
            "/api/v1/brokers/fix/upload-cert",
            files={"file": ("client_cert.pem", sample_pem, "application/x-pem-file")},
            headers=retail_headers,
        )
        assert res_retail.status_code == 403

        # 2. Enterprise upload succeeds
        res_ent = self.client.post(
            "/api/v1/brokers/fix/upload-cert",
            files={"file": ("goldman_sachs_client.pem", sample_pem, "application/x-pem-file")},
            headers=enterprise_headers,
        )
        assert res_ent.status_code == 200
        data = res_ent.json()
        assert data["ok"] is True
        assert data["filename"] == "goldman_sachs_client.pem"
        assert len(data["sha256_fingerprint"]) > 10
        assert os.path.exists(data["stored_path"])

        # Clean up uploaded cert
        try:
            os.remove(data["stored_path"])
        except Exception:
            pass
