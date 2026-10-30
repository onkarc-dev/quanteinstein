import os
import uuid
import pytest
from app.db import get_primary_conn, now, row_to_dict
from app.core.crypto_vault import (
    encrypt_credential,
    decrypt_credential,
    mask_credential,
    extract_key_prefix,
    VAULT_PREFIX,
)


class TestBrokerVaultAndSchema:
    @pytest.fixture(autouse=True)
    def setup_cleanup(self):
        self.test_user_id = f"test_user_vault_{uuid.uuid4().hex[:8]}"
        with get_primary_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, password_hash, name, tier, role, onboarding_completed, created_at) VALUES (?, ?, 'testhash', ?, ?, ?, 1, ?)",
                (self.test_user_id, f"vault_{uuid.uuid4().hex[:6]}@example.com", "Vault Tester", "ENTERPRISE", "ORGANIZATION_ADMIN", now()),
            )
            conn.commit()

        yield

        with get_primary_conn() as conn:
            conn.execute("DELETE FROM retail_connections WHERE user_id = ?", (self.test_user_id,))
            conn.execute("DELETE FROM enterprise_fix_connections WHERE user_id = ?", (self.test_user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (self.test_user_id,))
            conn.commit()

    def test_aes_256_gcm_encryption_and_decryption(self):
        secret_raw = "binance_live_secret_48f9a2b0c1e8d7"
        encrypted = encrypt_credential(secret_raw)

        # 1. Prefix verification
        assert encrypted.startswith(VAULT_PREFIX), "Encrypted payload must use standard vault prefix"
        assert encrypted != secret_raw, "Raw secret must never match encrypted string"

        # 2. Decryption
        decrypted = decrypt_credential(encrypted)
        assert decrypted == secret_raw, "Decrypted secret must match original plain text"

    def test_tamper_detection(self):
        secret_raw = "kraken_secret_99887766554433"
        encrypted = encrypt_credential(secret_raw)

        # Tamper with the base64 ciphertext
        prefix_len = len(VAULT_PREFIX)
        body = list(encrypted[prefix_len:])
        body[15] = 'Z' if body[15] != 'Z' else 'A'
        tampered = VAULT_PREFIX + "".join(body)

        with pytest.raises(ValueError):
            decrypt_credential(tampered)

    def test_credential_masking(self):
        api_key = "vm89a7f3e1d2c4b5a69876543210b4c8"
        masked = mask_credential(api_key, visible_start=4, visible_end=4)
        assert masked.startswith("vm89")
        assert masked.endswith("b4c8")
        assert "•" in masked
        assert "a7f3e1d2c4b5" not in masked

        prefix = extract_key_prefix(api_key, 6)
        assert prefix == "vm89a7"

    def test_retail_connection_db_persistence(self):
        api_key_plain = "binance_prod_key_112233"
        api_secret_plain = "binance_prod_secret_445566"
        passphrase_plain = "TradeSecurePass99!"

        enc_key = encrypt_credential(api_key_plain)
        enc_sec = encrypt_credential(api_secret_plain)
        enc_pass = encrypt_credential(passphrase_plain)
        prefix = extract_key_prefix(api_key_plain)

        conn_id = f"ret_conn_{uuid.uuid4().hex[:8]}"
        created_iso = now()

        with get_primary_conn() as conn:
            conn.execute(
                """
                INSERT INTO retail_connections (
                    id, user_id, exchange_name, account_label,
                    encrypted_api_key, encrypted_api_secret, encrypted_passphrase,
                    key_prefix, is_testnet, is_active, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conn_id, self.test_user_id, "binance", "Production Scalp Bot",
                    enc_key, enc_sec, enc_pass, prefix, 0, 1, "CONNECTED", created_iso, created_iso
                ),
            )
            conn.commit()

        # Query back and verify no plaintext in DB
        with get_primary_conn() as conn:
            row = conn.execute("SELECT * FROM retail_connections WHERE id = ?", (conn_id,)).fetchone()
            assert row is not None
            d = row_to_dict(row)

            # Raw values in DB must be ciphertext
            assert d["encrypted_api_key"].startswith(VAULT_PREFIX)
            assert api_key_plain not in d["encrypted_api_key"]
            assert api_secret_plain not in d["encrypted_api_secret"]

            # Decrypting via vault retrieves original credentials
            assert decrypt_credential(d["encrypted_api_key"]) == api_key_plain
            assert decrypt_credential(d["encrypted_api_secret"]) == api_secret_plain
            assert decrypt_credential(d["encrypted_passphrase"]) == passphrase_plain

    def test_enterprise_fix_connection_db_persistence(self):
        conn_id = f"fix_conn_{uuid.uuid4().hex[:8]}"
        created_iso = now()

        with get_primary_conn() as conn:
            conn.execute(
                """
                INSERT INTO enterprise_fix_connections (
                    id, user_id, organization_id, prime_broker_name,
                    sender_comp_id, target_comp_id, host_ip, port,
                    fix_version, tls_enabled, tls_certificate_path,
                    heartbeat_interval_sec, is_active, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conn_id, self.test_user_id, "tier1alpha_org", "Goldman Sachs GSET",
                    "QUANTEINSTEIN_PROD", "GS_GSET_FIX", "192.168.10.45", 9800,
                    "FIX.4.4", 1, "/secure/certs/gs_client_prod.pem",
                    30, 1, "CONNECTED", created_iso, created_iso
                ),
            )
            conn.commit()

        with get_primary_conn() as conn:
            row = conn.execute("SELECT * FROM enterprise_fix_connections WHERE id = ?", (conn_id,)).fetchone()
            assert row is not None
            d = row_to_dict(row)
            assert d["prime_broker_name"] == "Goldman Sachs GSET"
            assert d["sender_comp_id"] == "QUANTEINSTEIN_PROD"
            assert d["target_comp_id"] == "GS_GSET_FIX"
            assert d["port"] == 9800
            assert d["tls_enabled"] == 1

    def test_aws_kms_envelope_encryption_driver(self):
        os.environ["AWS_KMS_KEY_ID"] = "arn:aws:kms:us-east-1:123456789012:key/test-enterprise-cmk"
        os.environ["MOCK_AWS_KMS"] = "1"
        try:
            secret = "goldman_sachs_institutional_client_cert_passphrase_secret"
            # Encrypt with enterprise tier (activating KMS envelope driver)
            encrypted = encrypt_credential(secret, tier="ENTERPRISE")
            assert encrypted.startswith("awskms:"), "Enterprise payload with KMS configured must use awskms prefix"

            # Decrypt back and verify authenticity
            decrypted = decrypt_credential(encrypted)
            assert decrypted == secret, "Decrypted KMS payload must match original plain text"
        finally:
            os.environ.pop("AWS_KMS_KEY_ID", None)
            os.environ.pop("MOCK_AWS_KMS", None)
