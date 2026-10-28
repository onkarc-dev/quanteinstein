-- ==============================================================================
-- Quanteinstein FinTech Platform: Broker & Exchange Integrations Migration
-- ==============================================================================

CREATE TABLE IF NOT EXISTS retail_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exchange_name TEXT NOT NULL,
    account_label TEXT NOT NULL DEFAULT 'Primary Account',
    encrypted_api_key TEXT NOT NULL,
    encrypted_api_secret TEXT NOT NULL,
    encrypted_passphrase TEXT,
    key_prefix TEXT NOT NULL DEFAULT '',
    is_testnet INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'CONNECTED',
    last_ping_at TEXT,
    ping_status TEXT,
    ping_latency_ms REAL,
    ping_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retail_connections_user_id ON retail_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_retail_connections_user_exchange ON retail_connections(user_id, exchange_name);

CREATE TABLE IF NOT EXISTS enterprise_fix_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    prime_broker_name TEXT NOT NULL,
    sender_comp_id TEXT NOT NULL,
    target_comp_id TEXT NOT NULL,
    host_ip TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 9800,
    fix_version TEXT NOT NULL DEFAULT 'FIX.4.4',
    tls_enabled INTEGER NOT NULL DEFAULT 1,
    tls_certificate_path TEXT,
    tls_ca_path TEXT,
    encrypted_password TEXT,
    heartbeat_interval_sec INTEGER NOT NULL DEFAULT 30,
    account_identifier TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'CONNECTED',
    last_heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enterprise_fix_connections_user_id ON enterprise_fix_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_fix_connections_org_id ON enterprise_fix_connections(organization_id);
