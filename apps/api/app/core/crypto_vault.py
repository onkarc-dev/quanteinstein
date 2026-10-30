"""High-assurance AES-256-GCM & AWS KMS Envelope Credential Vault for Quanteinstein.

Features:
- Dual-tier cryptographic security:
  * Default / Retail Tier: NIST SP 800-38D compliant AES-256-GCM authenticated encryption
    with PBKDF2-HMAC-SHA256 (100,000 iterations) key strengthening.
  * Enterprise / Institutional Tier: Optional AWS KMS Envelope Encryption Driver
    using Customer Master Keys (CMKs) to generate unique 256-bit Data Encryption Keys (DEKs).
- Unique 96-bit cryptographically secure initialization vectors (nonces) per encryption.
- Tamper-evident 128-bit authentication tags (GHASH).
- Zero plain-text persistence on disk or database.
- Safe API key masking and prefix extraction for UI rendering.
"""
from __future__ import annotations

import base64
import hashlib
import os
import struct
from typing import Optional, Tuple

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False

try:
    import boto3
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False

from app.core.config import settings

VAULT_PREFIX_AES = "aes256gcm:"
VAULT_PREFIX_KMS = "awskms:"
VAULT_PREFIX = VAULT_PREFIX_AES
SALT = b"quanteinstein_broker_vault_salt_v1"


def is_production() -> bool:
    """Returns True if the system is operating in institutional production mode."""
    env = (os.getenv("ENVIRONMENT") or os.getenv("QUANTEINSTEIN_ENV") or os.getenv("APP_ENV") or "").lower()
    return env in ("production", "prod")


def check_production_security():
    """Fail-closed assertion: rejects running with local fallback keys when ENVIRONMENT=production."""
    if is_production():
        if not _kms_driver.is_available:
            raise RuntimeError(
                "CRITICAL SECURITY VIOLATION: Production mode (ENVIRONMENT=production) requires active AWS KMS "
                "envelope encryption with a verified Customer Master Key (CMK). "
                "Booting with local fallback keys in production is strictly prohibited by SOC 2 Type II / SEC controls."
            )


def _derive_vault_key() -> bytes:
    """Derives a fixed 256-bit (32 bytes) symmetric key from server secret."""
    explicit_key = os.getenv("CREDENTIALS_ENCRYPTION_KEY")
    if is_production() and not explicit_key:
        raise RuntimeError(
            "CRITICAL SECURITY VIOLATION: Production environment requires an explicitly defined "
            "CREDENTIALS_ENCRYPTION_KEY. Hardcoded fallback secrets are forbidden."
        )

    master_secret = (
        explicit_key
        or getattr(settings, "secret_key", "")
        or "quanteinstein-master-vault-encryption-secret-default-key-32b"
    ).encode("utf-8")

    # PBKDF2-HMAC-SHA256 with 100,000 rounds for robust key strengthening
    return hashlib.pbkdf2_hmac("sha256", master_secret, SALT, 100_000, 32)


class AwsKmsEnvelopeDriver:
    """Enterprise envelope encryption driver backed by AWS KMS."""

    def __init__(self, key_id: Optional[str] = None):
        self._key_id = key_id
        self._client = None

    @property
    def key_id(self) -> Optional[str]:
        return self._key_id or os.getenv("AWS_KMS_KEY_ID") or os.getenv("AWS_KMS_KEY_ARN")

    @property
    def is_available(self) -> bool:
        return bool(self.key_id and (HAS_BOTO3 or os.getenv("MOCK_AWS_KMS") == "1"))

    def _get_client(self):
        if not self._client and HAS_BOTO3 and self.key_id:
            region = os.getenv("AWS_REGION", "us-east-1")
            self._client = boto3.client("kms", region_name=region)
        return self._client

    def generate_data_key(self) -> Tuple[bytes, bytes]:
        """Generates a 256-bit plaintext data key and its encrypted counterpart."""
        if os.getenv("MOCK_AWS_KMS") == "1" or not HAS_BOTO3:
            # Deterministic envelope simulation for testing/CI without active AWS credentials
            plaintext_dek = os.urandom(32)
            mock_enc_dek = b"mock_kms_encrypted_dek:" + base64.b64encode(plaintext_dek)
            return plaintext_dek, mock_enc_dek

        client = self._get_client()
        resp = client.generate_data_key(KeyId=self.key_id, KeySpec="AES_256")
        return resp["Plaintext"], resp["CiphertextBlob"]

    def decrypt_data_key(self, encrypted_dek: bytes) -> bytes:
        """Decrypts the encrypted DEK using the AWS KMS CMK."""
        if os.getenv("MOCK_AWS_KMS") == "1" or encrypted_dek.startswith(b"mock_kms_encrypted_dek:"):
            # Mock decryption in development
            raw_b64 = encrypted_dek[len(b"mock_kms_encrypted_dek:"):]
            return base64.b64decode(raw_b64)

        client = self._get_client()
        resp = client.decrypt(CiphertextBlob=encrypted_dek)
        return resp["Plaintext"]


_kms_driver = AwsKmsEnvelopeDriver()


def is_kms_enabled() -> bool:
    """Returns True if AWS KMS enterprise driver is configured and operational."""
    return _kms_driver.is_available


def encrypt_credential(plaintext: Optional[str], tier: str = "RETAIL") -> str:
    """Encrypts a plain-text credential (API key, secret, passphrase).
    
    If tier is 'ENTERPRISE' and AWS KMS is configured, uses AWS KMS envelope encryption.
    Otherwise, uses NIST SP 800-38D compliant local AES-256-GCM encryption.
    """
    if plaintext is None:
        return ""
    plaintext_str = str(plaintext).strip()
    if not plaintext_str:
        return ""

    if not HAS_CRYPTOGRAPHY:
        raise RuntimeError("cryptography library required for AES-256-GCM credential vault")

    is_enterprise = str(tier).upper() in ("ENTERPRISE", "PRO", "INSTITUTIONAL")

    # Mode A: Enterprise AWS KMS Envelope Encryption
    if is_enterprise:
        if _kms_driver.is_available:
            try:
                plaintext_dek, encrypted_dek = _kms_driver.generate_data_key()
                nonce = os.urandom(12)
                aesgcm = AESGCM(plaintext_dek)
                ciphertext = aesgcm.encrypt(nonce, plaintext_str.encode("utf-8"), None)

                # Wire packet: [2-byte dek_len] + [encrypted_dek] + [12-byte nonce] + [ciphertext + tag]
                dek_len = len(encrypted_dek)
                header = struct.pack(">H", dek_len)
                payload = header + encrypted_dek + nonce + ciphertext
                return VAULT_PREFIX_KMS + base64.b64encode(payload).decode("ascii")
            except Exception as exc:
                if is_production():
                    raise RuntimeError(f"CRITICAL: AWS KMS envelope encryption failed in production: {exc}") from exc
                # Fallback to local AES-256-GCM in dev/test only
                pass
        elif is_production():
            raise RuntimeError(
                "CRITICAL: Enterprise tier credential encryption requires active AWS KMS in production mode. "
                "Local encryption fallback is strictly rejected."
            )

    # Mode B: Standard AES-256-GCM with PBKDF2 derived key
    key = _derive_vault_key()
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext_str.encode("utf-8"), None)
    payload = nonce + ciphertext
    return VAULT_PREFIX_AES + base64.b64encode(payload).decode("ascii")


def encrypt_enterprise_credential(plaintext: Optional[str]) -> str:
    """Convenience helper to encrypt with enterprise security tier."""
    return encrypt_credential(plaintext, tier="ENTERPRISE")


def decrypt_credential(ciphertext_blob: Optional[str]) -> str:
    """Decrypts an AES-256-GCM or AWS KMS encrypted credential back to plain-text string.
    
    Auto-detects the encryption prefix ('awskms:' or 'aes256gcm:').
    Raises ValueError if ciphertext is corrupted, tampered with, or tag verification fails.
    """
    if not ciphertext_blob:
        return ""

    blob = str(ciphertext_blob).strip()

    # Case 1: AWS KMS Envelope Payload
    if blob.startswith(VAULT_PREFIX_KMS):
        if not HAS_CRYPTOGRAPHY:
            raise RuntimeError("cryptography library required for AES-256-GCM credential vault")

        encoded = blob[len(VAULT_PREFIX_KMS):]
        try:
            raw_payload = base64.b64decode(encoded.encode("ascii"))
        except Exception as exc:
            raise ValueError("Invalid base64 payload in KMS encrypted credential") from exc

        if len(raw_payload) < 2 + 1 + 12 + 16:
            raise ValueError("KMS credential payload is truncated or corrupted")

        dek_len = struct.unpack(">H", raw_payload[:2])[0]
        encrypted_dek = raw_payload[2 : 2 + dek_len]
        nonce_and_ct = raw_payload[2 + dek_len :]
        nonce = nonce_and_ct[:12]
        ciphertext = nonce_and_ct[12:]

        try:
            plaintext_dek = _kms_driver.decrypt_data_key(encrypted_dek)
            aesgcm = AESGCM(plaintext_dek)
            decrypted_bytes = aesgcm.decrypt(nonce, ciphertext, None)
            return decrypted_bytes.decode("utf-8")
        except Exception as exc:
            raise ValueError(f"AWS KMS envelope decryption failed: {exc}") from exc

    # Case 2: Standard AES-256-GCM Payload
    if blob.startswith(VAULT_PREFIX_AES):
        if not HAS_CRYPTOGRAPHY:
            raise RuntimeError("cryptography library required for AES-256-GCM credential vault")

        encoded = blob[len(VAULT_PREFIX_AES):]
        try:
            raw_payload = base64.b64decode(encoded.encode("ascii"))
        except Exception as exc:
            raise ValueError("Invalid base64 payload in encrypted credential") from exc

        if len(raw_payload) < 28:
            raise ValueError("Encrypted credential payload is truncated or corrupted")

        nonce = raw_payload[:12]
        ciphertext_with_tag = raw_payload[12:]
        key = _derive_vault_key()

        aesgcm = AESGCM(key)
        try:
            decrypted_bytes = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
            return decrypted_bytes.decode("utf-8")
        except Exception as exc:
            raise ValueError("Authentication tag verification failed; credential was tampered with or key is invalid") from exc

    # Return as-is if unencrypted or legacy
    return blob


def extract_key_prefix(api_key: Optional[str], length: int = 6) -> str:
    """Safely extracts the initial characters of an API key for display/indexing."""
    if not api_key:
        return ""
    clean = str(api_key).strip()
    return clean[:length]


def mask_credential(credential: Optional[str], visible_start: int = 4, visible_end: int = 4) -> str:
    """Masks a credential for secure UI rendering without leaking the secret.
    
    Example: 'vm89abcdef1234567890b4c8' -> 'vm89••••••••••••••••b4c8'
    """
    if not credential:
        return "••••••••"
    c = str(credential).strip()
    if len(c) <= visible_start + visible_end:
        return "•" * len(c)
    masked_middle = "•" * max(12, len(c) - (visible_start + visible_end))
    return f"{c[:visible_start]}{masked_middle}{c[-visible_end:]}"
