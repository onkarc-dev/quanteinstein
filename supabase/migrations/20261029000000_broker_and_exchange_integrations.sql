-- ==============================================================================
-- Quanteinstein FinTech Platform: Broker & Exchange Integrations Migration
-- Dual-Tier Architecture:
-- 1. Retail Tier (B2C): RetailConnections (AES-256 encrypted API credentials for 25 Crypto & 6 Forex brokers)
-- 2. Enterprise Tier (B2B): EnterpriseFixConnections (Prime Brokerage FIX 4.4/5.0 with TLS SSL certs)
-- ==============================================================================

-- 1. Enable pgcrypto for database-level UUIDs and hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Retail Connections Table
CREATE TABLE IF NOT EXISTS public.retail_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    exchange_name VARCHAR(64) NOT NULL, -- e.g., 'binance', 'coinbase', 'kraken', 'oanda'
    account_label VARCHAR(128) NOT NULL DEFAULT 'Primary Account',
    
    -- High-Assurance AES-256-GCM Encrypted Payloads (Nonce + Ciphertext + Tag in Base64)
    encrypted_api_key TEXT NOT NULL,
    encrypted_api_secret TEXT NOT NULL,
    encrypted_passphrase TEXT, -- Required by OKX, KuCoin, Bitget, etc.
    
    -- Safe prefix for display and indexing without decrypting
    key_prefix VARCHAR(16) NOT NULL DEFAULT '',
    
    -- Connection Configuration
    is_testnet BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(32) NOT NULL DEFAULT 'CONNECTED', -- 'CONNECTED', 'ERROR', 'DISCONNECTED', 'TESTING'
    
    -- Health & Ping Telemetry
    last_ping_at TIMESTAMPTZ,
    ping_status VARCHAR(32),
    ping_latency_ms DOUBLE PRECISION,
    ping_error TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes for lightning-fast lookups during strategy order dispatch
CREATE INDEX IF NOT EXISTS idx_retail_connections_user_id ON public.retail_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_retail_connections_user_exchange ON public.retail_connections(user_id, exchange_name);
CREATE INDEX IF NOT EXISTS idx_retail_connections_active ON public.retail_connections(user_id, is_active) WHERE is_active = TRUE;

-- 3. Enterprise Prime Brokerage FIX Connections Table
CREATE TABLE IF NOT EXISTS public.enterprise_fix_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    
    -- Prime Broker Identity
    prime_broker_name VARCHAR(128) NOT NULL, -- e.g., 'Goldman Sachs GSET', 'Morgan Stanley', 'J.P. Morgan'
    
    -- FIX Network Specification (Tags 49, 56, etc.)
    sender_comp_id VARCHAR(64) NOT NULL,
    target_comp_id VARCHAR(64) NOT NULL,
    host_ip VARCHAR(256) NOT NULL,
    port INTEGER NOT NULL DEFAULT 9800,
    fix_version VARCHAR(16) NOT NULL DEFAULT 'FIX.4.4', -- 'FIX.4.2', 'FIX.4.4', 'FIX.5.0', 'FIX.5.0SP2'
    
    -- Security & Encryption Parameters
    tls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    tls_certificate_path TEXT, -- Secure path to client mTLS certificate (.pem, .crt)
    tls_ca_path TEXT,          -- Path to broker Root CA bundle
    encrypted_password TEXT,   -- FIX Tag 554 Password if required (AES-256 encrypted)
    
    -- Session Management & Rate Control
    heartbeat_interval_sec INTEGER NOT NULL DEFAULT 30, -- FIX Tag 108
    account_identifier VARCHAR(64),                     -- FIX Tag 1
    
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(32) NOT NULL DEFAULT 'CONNECTED',    -- 'CONNECTED', 'LOGGED_OUT', 'ERROR'
    last_heartbeat_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Enterprise Indexes
CREATE INDEX IF NOT EXISTS idx_enterprise_fix_connections_user_id ON public.enterprise_fix_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_fix_connections_org_id ON public.enterprise_fix_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_fix_connections_broker ON public.enterprise_fix_connections(prime_broker_name);

-- 4. Automatic updated_at Trigger
CREATE OR REPLACE FUNCTION update_connection_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_retail_connections_updated_at ON public.retail_connections;
CREATE TRIGGER trg_retail_connections_updated_at
    BEFORE UPDATE ON public.retail_connections
    FOR EACH ROW EXECUTE FUNCTION update_connection_timestamp();

DROP TRIGGER IF EXISTS trg_enterprise_fix_connections_updated_at ON public.enterprise_fix_connections;
CREATE TRIGGER trg_enterprise_fix_connections_updated_at
    BEFORE UPDATE ON public.enterprise_fix_connections
    FOR EACH ROW EXECUTE FUNCTION update_connection_timestamp();

-- 5. Row-Level Security (RLS) Policies
ALTER TABLE public.retail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_fix_connections ENABLE ROW LEVEL SECURITY;

-- Users can only read and modify their own retail connections
CREATE POLICY retail_connections_owner_policy ON public.retail_connections
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Enterprise connections: visible to owner and authorized organization members
CREATE POLICY enterprise_fix_connections_owner_policy ON public.enterprise_fix_connections
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
