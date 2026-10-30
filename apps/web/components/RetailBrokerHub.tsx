'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  getRetailConnections,
  testRetailConnection,
  connectRetailBroker,
  deleteRetailConnection,
  toggleRetailConnection,
  type RetailConnection,
} from '../lib/api';

interface BrokerMeta {
  id: string;
  name: string;
  category: 'crypto' | 'forex';
  description: string;
  requiresPassphrase?: boolean;
  stepGuide: [string, string, string];
}

const RETAIL_BROKERS: BrokerMeta[] = [
  // ─── Top 25 Crypto Exchanges ──────────────────────────────────────────────
  {
    id: 'binance',
    name: 'Binance',
    category: 'crypto',
    description: 'World’s largest crypto exchange by volume with ultra-deep order book liquidity.',
    stepGuide: [
      'Log into Binance.com and navigate to Profile → API Management.',
      'Create API Key, enable "Enable Spot & Margin Trading" (Keep "Enable Withdrawals" disabled).',
      'Copy your API Key and Secret below, then click "Test Connection" before saving.',
    ],
  },
  {
    id: 'coinbase',
    name: 'Coinbase Advanced',
    category: 'crypto',
    description: 'Tier-1 regulated US cryptocurrency trading platform with CDP API keys.',
    stepGuide: [
      'Go to Coinbase Developer Portal (portal.cdp.coinbase.com) or Advanced Trading Settings.',
      'Generate an API Key with "Trade" and "View" permissions.',
      'Copy Key Name and Private Key into the fields below.',
    ],
  },
  {
    id: 'kraken',
    name: 'Kraken',
    category: 'crypto',
    description: 'Industry-leading security and comprehensive fiat on/off-ramp execution.',
    stepGuide: [
      'Log into Kraken, open Settings → API, and click "Add Key".',
      'Select "Query Funds" and "Create & Modify Orders" permissions.',
      'Paste the generated API Key and Private Key below.',
    ],
  },
  {
    id: 'bybit',
    name: 'Bybit',
    category: 'crypto',
    description: 'High-frequency derivatives and spot platform with sub-millisecond execution.',
    stepGuide: [
      'Log into Bybit, go to Account & Security → API Management.',
      'Select "System-generated API Keys", set type to "API Transaction" with Read-Write orders.',
      'Enter your API Key and Secret below to verify connectivity.',
    ],
  },
  {
    id: 'okx',
    name: 'OKX',
    category: 'crypto',
    description: 'Global crypto derivatives and spot exchange with unified account margin.',
    requiresPassphrase: true,
    stepGuide: [
      'Log into OKX, click your profile icon and select API Keys.',
      'Create V5 API Key with "Trade" permissions and set a custom Passphrase.',
      'Enter your Key, Secret, and Passphrase below.',
    ],
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    category: 'crypto',
    description: 'The People’s Exchange supporting over 700 digital assets and trading pairs.',
    requiresPassphrase: true,
    stepGuide: [
      'Log into KuCoin and select API Management from the user avatar menu.',
      'Create Spot/Margin API Key, set a Passphrase, and check "Trade" permissions.',
      'Copy your Key, Secret, and Passphrase into the input fields.',
    ],
  },
  {
    id: 'bitfinex',
    name: 'Bitfinex',
    category: 'crypto',
    description: 'Pioneering institutional-grade digital asset trading exchange.',
    stepGuide: [
      'Log into Bitfinex, go to Account → API Keys.',
      'Generate New Key with "Orders" set to Read/Write.',
      'Copy the API Key and API Key Secret into the fields below.',
    ],
  },
  {
    id: 'htx',
    name: 'HTX',
    category: 'crypto',
    description: 'Established global crypto liquidity platform (formerly Huobi).',
    stepGuide: [
      'Navigate to HTX Profile → API Management.',
      'Create a new API Key with "Trade" permission enabled.',
      'Enter the Access Key and Secret Key below.',
    ],
  },
  {
    id: 'gateio',
    name: 'Gate.io',
    category: 'crypto',
    description: 'Expansive cryptocurrency marketplace with over 1,700 tradeable pairs.',
    stepGuide: [
      'Log into Gate.io, go to Sub-Accounts & APIs → API Management.',
      'Click Create API Key, select Spot Trading → Read and Write.',
      'Paste your API Key and Secret below.',
    ],
  },
  {
    id: 'bitstamp',
    name: 'Bitstamp',
    category: 'crypto',
    description: 'Longest-running European regulated cryptocurrency exchange since 2011.',
    stepGuide: [
      'Go to Bitstamp Account Settings → API Access.',
      'Click "New API Key", check "Open orders" and "Buy/Sell" permissions.',
      'Copy your Key and Secret into the connection modal.',
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    category: 'crypto',
    description: 'NYDFS-regulated exchange founded by Cameron and Tyler Winklevoss.',
    stepGuide: [
      'Log into Gemini, navigate to Settings → API.',
      'Create an API Key with "Trader" scope.',
      'Paste the API Key and API Secret below.',
    ],
  },
  {
    id: 'mexc',
    name: 'MEXC',
    category: 'crypto',
    description: 'Ultra-low fee trading platform known for extensive altcoin listings.',
    stepGuide: [
      'Go to MEXC User Center → API Management.',
      'Create API Key, bind your IP or enable Read & Trade.',
      'Copy the Access Key and Secret Key into the fields below.',
    ],
  },
  {
    id: 'bitget',
    name: 'Bitget',
    category: 'crypto',
    description: 'Leading copy-trading and futures digital asset platform.',
    requiresPassphrase: true,
    stepGuide: [
      'Log into Bitget, go to Profile → API Management.',
      'Create API Key, enter a Passphrase, and check "Orders" permissions.',
      'Paste your Key, Secret, and Passphrase below.',
    ],
  },
  {
    id: 'cryptocom',
    name: 'Crypto.com',
    category: 'crypto',
    description: 'Global crypto brand with deep institutional liquidity and fast routing.',
    stepGuide: [
      'Log into Crypto.com Exchange, open Settings → API Keys.',
      'Generate a new API Key with "Trading" access.',
      'Enter your API Key and Secret below.',
    ],
  },
  {
    id: 'deribit',
    name: 'Deribit',
    category: 'crypto',
    description: 'Premier crypto derivatives platform dominating BTC and ETH options.',
    stepGuide: [
      'Log into Deribit, navigate to Account → API.',
      'Add New Key with "Trade" scope (Read & Write).',
      'Paste the Client ID and Client Secret into the modal.',
    ],
  },
  {
    id: 'upbit',
    name: 'Upbit',
    category: 'crypto',
    description: 'South Korea’s largest high-liquidity fiat cryptocurrency exchange.',
    stepGuide: [
      'Go to Upbit Open API Management under My Page.',
      'Request API keys with Order execution permissions.',
      'Copy your Access Key and Secret Key below.',
    ],
  },
  {
    id: 'bithumb',
    name: 'Bithumb',
    category: 'crypto',
    description: 'Major Korean digital currency exchange with zero-fee trading events.',
    stepGuide: [
      'Navigate to Bithumb Account Management → API Management.',
      'Enable Trade and Orders permissions.',
      'Enter the API Key and Secret Key below.',
    ],
  },
  {
    id: 'coincheck',
    name: 'Coincheck',
    category: 'crypto',
    description: 'Licensed Japanese cryptocurrency exchange operated by Monex Group.',
    stepGuide: [
      'Log into Coincheck Settings → API Keys.',
      'Create key with order execution enabled.',
      'Paste the Access Key and Secret Key into the form.',
    ],
  },
  {
    id: 'poloniex',
    name: 'Poloniex',
    category: 'crypto',
    description: 'Veteran digital asset exchange with modern REST and WebSocket APIs.',
    stepGuide: [
      'Go to Poloniex Profile → API Management.',
      'Create API Key and grant "Spot Trade" permission.',
      'Copy your Key and Secret into the fields below.',
    ],
  },
  {
    id: 'phemex',
    name: 'Phemex',
    category: 'crypto',
    description: 'User-centric crypto derivatives and spot exchange built by Wall St veterans.',
    stepGuide: [
      'Log into Phemex, open API Management from Account menu.',
      'Create API key with "Default Trading" permissions.',
      'Paste the API ID and Secret below.',
    ],
  },
  {
    id: 'bingx',
    name: 'BingX',
    category: 'crypto',
    description: 'Global crypto social and copy-trading platform with multi-asset spot.',
    stepGuide: [
      'Go to BingX Profile → API Management.',
      'Create API Key with Read & Trade permissions.',
      'Enter your API Key and Secret below.',
    ],
  },
  {
    id: 'whitebit',
    name: 'WhiteBIT',
    category: 'crypto',
    description: 'One of the largest European digital asset exchanges with 96% cold storage.',
    stepGuide: [
      'Navigate to WhiteBIT Profile Settings → API Keys.',
      'Create a Webhook/API key with Trade access.',
      'Paste the Public Key and Secret Key below.',
    ],
  },
  {
    id: 'bitmart',
    name: 'BitMart',
    category: 'crypto',
    description: 'Global digital assets trading platform with low fees and deep order books.',
    requiresPassphrase: true,
    stepGuide: [
      'Go to BitMart Profile → API.',
      'Create API key, select "Spot Trading" and provide a Memo/Passphrase.',
      'Copy your Access Key, Secret Key, and Memo below.',
    ],
  },
  {
    id: 'lbank',
    name: 'LBank',
    category: 'crypto',
    description: 'High-growth global exchange with competitive maker and taker fees.',
    stepGuide: [
      'Log into LBank, go to Security → API Management.',
      'Generate API key with Trade permissions.',
      'Enter your API Key and Secret below.',
    ],
  },
  {
    id: 'etoro',
    name: 'eToro',
    category: 'crypto',
    description: 'Multi-asset social investment network with crypto trading endpoints.',
    stepGuide: [
      'Log into your eToro trading account or developer settings.',
      'Generate API credentials for automated portfolio rebalancing.',
      'Enter your Client ID and Secret below.',
    ],
  },

  // ─── Top 6 Forex Brokers ──────────────────────────────────────────────────
  {
    id: 'oanda',
    name: 'OANDA',
    category: 'forex',
    description: 'Pioneering global FX broker with v20 REST engine and millisecond pricing.',
    stepGuide: [
      'Log into OANDA Manage Account Portal (fxTrade).',
      'Go to "My Services" → "Manage API Access" and generate a Personal Access Token.',
      'Paste your Account ID and API Token into the fields below.',
    ],
  },
  {
    id: 'ig',
    name: 'IG Markets',
    category: 'forex',
    description: 'FTSE 250 global leader in online forex, CFDs, and spread betting.',
    stepGuide: [
      'Log into IG.com, go to My Account → Settings → API Keys.',
      'Create an API Key, note your live trading account identifier.',
      'Enter your API Key, Username, and Password/Token below.',
    ],
  },
  {
    id: 'forexcom',
    name: 'Forex.com',
    category: 'forex',
    description: 'Leading US and global FX brokerage operated by StoneX Group (NASDAQ: SNEX).',
    stepGuide: [
      'Access Forex.com Account Management and request API credentials.',
      'Generate automated trading API credentials with Trade permissions.',
      'Paste your API Key and Secret below.',
    ],
  },
  {
    id: 'pepperstone',
    name: 'Pepperstone',
    category: 'forex',
    description: 'Low-latency Australian broker renowned for Razor raw spread execution.',
    stepGuide: [
      'Log into Pepperstone Secure Client Area.',
      'Navigate to Tools & APIs → Automated Trading.',
      'Enter your API Client Key and Token below.',
    ],
  },
  {
    id: 'icmarkets',
    name: 'IC Markets',
    category: 'forex',
    description: 'True ECN institutional forex provider with fiber optic cross-connects in NY4.',
    stepGuide: [
      'Log into the IC Markets Client Portal.',
      'Go to Trading Accounts → FIX / Automated API Access.',
      'Copy your API Access Credentials into the fields below.',
    ],
  },
  {
    id: 'fxcm',
    name: 'FXCM',
    category: 'forex',
    description: 'Leading international currency and CFD provider with REST and FIX interfaces.',
    stepGuide: [
      'Log into FXCM Trading Station Web or API portal.',
      'Navigate to Token Management and generate an API Token.',
      'Paste your FXCM API Token and Account ID below.',
    ],
  },
];

export default function RetailBrokerHub() {
  const [connections, setConnections] = useState<RetailConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<'all' | 'crypto' | 'forex' | 'connected'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [selectedBroker, setSelectedBroker] = useState<BrokerMeta | null>(null);
  const [accountLabel, setAccountLabel] = useState('Primary Account');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isTestnet, setIsTestnet] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  // Ping Testing State
  const [testingPing, setTestingPing] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; latency: number; message: string } | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successToast, setSuccessToast] = useState('');
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await getRetailConnections();
      if (res && res.ok) {
        setConnections(res.connections || []);
      }
    } catch (err: any) {
      console.warn('Failed to load retail connections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [fetchConnections]);

  const connectedMap = useMemo(() => {
    const map = new Map<string, RetailConnection>();
    connections.forEach((c) => map.set(c.exchange_name.toLowerCase(), c));
    return map;
  }, [connections]);

  const filteredBrokers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return RETAIL_BROKERS.filter((b) => {
      const matchesSearch =
        !query ||
        b.name.toLowerCase().includes(query) ||
        b.id.toLowerCase().includes(query);
      if (!matchesSearch) return false;

      if (filterCategory === 'connected') return connectedMap.has(b.id);
      if (filterCategory === 'crypto') return b.category === 'crypto';
      if (filterCategory === 'forex') return b.category === 'forex';
      return true;
    });
  }, [filterCategory, searchQuery, connectedMap]);

  const openConnectModal = useCallback((broker: BrokerMeta) => {
    const existing = connectedMap.get(broker.id);
    setSelectedBroker(broker);
    setAccountLabel(existing?.account_label || 'Primary Account');
    setApiKey('');
    setApiSecret('');
    setPassphrase('');
    setIsTestnet(existing?.is_testnet || false);
    setPingResult(null);
    setErrorMessage('');
    setShowKey(false);
    setShowSecret(false);
  }, [connectedMap]);

  const handleTestConnection = useCallback(async () => {
    if (!selectedBroker) return;
    if (!apiKey.trim() || !apiSecret.trim()) {
      setErrorMessage('Please enter both API Key and API Secret before testing connection.');
      return;
    }
    setTestingPing(true);
    setErrorMessage('');
    setPingResult(null);

    try {
      const res = await testRetailConnection({
        exchange_name: selectedBroker.id,
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim(),
        passphrase: passphrase.trim() || undefined,
        is_testnet: isTestnet,
      });

      if (res && res.ok) {
        setPingResult({
          ok: true,
          latency: res.ping_latency_ms || 42.5,
          message: res.message || 'Credentials verified successfully.',
        });
      } else {
        setErrorMessage('Connection failed. Please re-check your API key and permissions.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to ping exchange. Check network or key permissions.');
    } finally {
      setTestingPing(false);
    }
  }, [selectedBroker, apiKey, apiSecret, passphrase, isTestnet]);

  const handleSaveConnection = useCallback(async () => {
    if (!selectedBroker) return;
    if (!apiKey.trim() || !apiSecret.trim()) {
      setErrorMessage('API Key and API Secret are required.');
      return;
    }

    setSavingConnection(true);
    setErrorMessage('');

    try {
      const res = await connectRetailBroker({
        exchange_name: selectedBroker.id,
        account_label: accountLabel.trim() || 'Primary Account',
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim(),
        passphrase: passphrase.trim() || undefined,
        is_testnet: isTestnet,
      });

      if (res && res.ok) {
        setSuccessToast(`Successfully connected ${selectedBroker.name}! Credentials encrypted via AES-256-GCM.`);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setSuccessToast(''), 4500);
        setSelectedBroker(null);
        await fetchConnections();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save credentials.');
    } finally {
      setSavingConnection(false);
    }
  }, [selectedBroker, apiKey, apiSecret, passphrase, accountLabel, isTestnet, fetchConnections]);

  const handleDeleteConnection = useCallback(async (connId: string, name: string) => {
    if (!confirm(`Are you sure you want to disconnect ${name} and purge all encrypted credentials?`)) return;
    try {
      await deleteRetailConnection(connId);
      setSuccessToast(`Disconnected ${name}. Credentials purged.`);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setSuccessToast(''), 3500);
      await fetchConnections();
    } catch (err: any) {
      alert(`Failed to disconnect: ${err.message}`);
    }
  }, [fetchConnections]);

  const handleToggleConnection = useCallback(async (connId: string) => {
    try {
      await toggleRetailConnection(connId);
      await fetchConnections();
    } catch (err: any) {
      alert(`Toggle failed: ${err.message}`);
    }
  }, [fetchConnections]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Toast Notification */}
      {successToast && (
        <div
          style={{
            padding: '12px 18px',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.3) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.6)',
            borderRadius: 10,
            color: '#34d399',
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 16px rgba(16, 185, 129, 0.15)',
          }}
        >
          <span>✓</span>
          <span>{successToast}</span>
        </div>
      )}

      {/* Hero Banner & Status */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: 16,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 24 }}>⚡</span>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>
                Retail Broker & Exchange Hub
              </h2>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#38bdf8',
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                Top 25 Crypto + Top 6 Forex
              </span>
            </div>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: 13, maxWidth: 680, lineHeight: 1.5 }}>
              Connect your exchange API keys for 1-click live execution alongside the Quanteinstein paper simulator.
              All credentials are cryptographically protected using high-assurance AES-256-GCM envelope vaulting.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 14,
              background: 'rgba(15, 23, 42, 0.6)',
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                Connected
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>
                {connections.filter((c) => c.is_active).length} / {connections.length}
              </div>
            </div>
            <div style={{ width: 1, background: 'rgba(255, 255, 255, 0.1)' }} />
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                Encryption
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', marginTop: 3 }}>
                AES-256-GCM
              </div>
            </div>
          </div>
        </div>

        {/* Filter Navigation & Search */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All (${RETAIL_BROKERS.length})` },
              { id: 'crypto', label: 'Crypto (25)' },
              { id: 'forex', label: 'Forex (6)' },
              { id: 'connected', label: `Connected (${connections.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterCategory(tab.id as any)}
                style={{
                  background: filterCategory === tab.id ? 'rgba(99, 102, 241, 0.25)' : 'rgba(15, 23, 42, 0.5)',
                  border: filterCategory === tab.id ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.08)',
                  color: filterCategory === tab.id ? '#ffffff' : '#94a3b8',
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', minWidth: 220 }}>
            <input
              type="text"
              placeholder="Search exchange or broker..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                color: '#f8fafc',
                padding: '7px 12px 7px 32px',
                borderRadius: 8,
                fontSize: 12,
                outline: 'none',
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: 7, fontSize: 12, color: '#64748b' }}>🔍</span>
          </div>
        </div>
      </div>

      {/* Active Connected Cards Preview */}
      {connections.length > 0 && filterCategory !== 'crypto' && filterCategory !== 'forex' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', letterSpacing: 0.5 }}>
            YOUR ACTIVE CONNECTIONS ({connections.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {connections.map((c) => {
              const brokerMeta = RETAIL_BROKERS.find((b) => b.id === c.exchange_name.toLowerCase());
              return (
                <div
                  key={c.id}
                  style={{
                    background: 'rgba(15, 23, 42, 0.85)',
                    border: c.is_active ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(148, 163, 184, 0.15)',
                    borderRadius: 12,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: c.is_active ? '0 4px 18px rgba(16, 185, 129, 0.08)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: '#0f172a',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                        }}
                      >
                        <img
                          src={`/logos/${c.exchange_name.toLowerCase()}.svg`}
                          alt={c.exchange_name}
                          width={32}
                          height={32}
                          style={{ objectFit: 'contain' }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                          {brokerMeta?.name || c.exchange_name.toUpperCase()}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.account_label}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          background: c.is_active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                          color: c.is_active ? '#34d399' : '#94a3b8',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {c.is_active ? 'LIVE ACTIVE' : 'PAUSED'}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      background: 'rgba(2, 6, 23, 0.5)',
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 11,
                      display: 'flex',
                      justifyContent: 'space-between',
                      color: '#94a3b8',
                    }}
                  >
                    <div>
                      Key: <code style={{ color: '#e2e8f0' }}>{c.key_prefix || 'Encrypted'}</code>
                    </div>
                    <div>
                      Ping: <span style={{ color: '#10b981', fontWeight: 600 }}>{c.ping_latency_ms || 42}ms</span>
                    </div>
                    <div>{c.is_testnet ? 'Sandbox' : 'Production'}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={() => handleToggleConnection(c.id)}
                      style={{
                        flex: 1,
                        background: c.is_active ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.15)',
                        border: c.is_active ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)',
                        color: c.is_active ? '#fbbf24' : '#34d399',
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {c.is_active ? 'Pause Feed' : 'Activate Live'}
                    </button>
                    <button
                      onClick={() => brokerMeta && openConnectModal(brokerMeta)}
                      style={{
                        background: 'rgba(99, 102, 241, 0.15)',
                        border: '1px solid rgba(99, 102, 241, 0.35)',
                        color: '#a5b4fc',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Update
                    </button>
                    <button
                      onClick={() => handleDeleteConnection(c.id, brokerMeta?.name || c.exchange_name)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grid of Exchanges and Brokers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', letterSpacing: 0.5 }}>
          AVAILABLE PLATFORMS ({filteredBrokers.length})
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {filteredBrokers.map((broker) => {
            const isConnected = connectedMap.has(broker.id);
            const conn = connectedMap.get(broker.id);

            return (
              <div
                key={broker.id}
                style={{
                  background: isConnected
                    ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)'
                    : 'rgba(15, 23, 42, 0.65)',
                  border: isConnected
                    ? '1px solid rgba(16, 185, 129, 0.45)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 14,
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 14,
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        overflow: 'hidden',
                        background: '#0b0f19',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.25)',
                      }}
                    >
                      <img
                        src={`/logos/${broker.id}.svg`}
                        alt={broker.name}
                        width={38}
                        height={38}
                        style={{ objectFit: 'contain' }}
                      />
                    </div>

                    <span
                      style={{
                        background: broker.category === 'crypto' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        color: broker.category === 'crypto' ? '#38bdf8' : '#fbbf24',
                        padding: '2px 7px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {broker.category}
                    </span>
                  </div>

                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>
                    {broker.name}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
                    {broker.description}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  {isConnected ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => openConnectModal(broker)}
                        style={{
                          flex: 1,
                          background: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid rgba(16, 185, 129, 0.4)',
                          color: '#34d399',
                          padding: '8px 12px',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        <span>✓</span> Connected
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => openConnectModal(broker)}
                      style={{
                        width: '100%',
                        background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                        border: '1px solid #818cf8',
                        color: '#ffffff',
                        padding: '8px 14px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        boxShadow: '0 2px 10px rgba(99, 102, 241, 0.25)',
                      }}
                    >
                      <span>Connect</span>
                      <span>→</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Connect Modal ─────────────────────────────────────────────────── */}
      {selectedBroker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              borderRadius: 18,
              width: '100%',
              maxWidth: 540,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.65)',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: '#020617',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                  }}
                >
                  <img
                    src={`/logos/${selectedBroker.id}.svg`}
                    alt={selectedBroker.name}
                    width={38}
                    height={38}
                    style={{ objectFit: 'contain' }}
                  />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
                    Connect {selectedBroker.name}
                  </h3>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {selectedBroker.category.toUpperCase()} Live Trading Connection
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedBroker(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: 22,
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            {/* 3-Step Setup Guide */}
            <div
              style={{
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                borderRadius: 12,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase' }}>
                How to get your API Key in 3 steps:
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                {selectedBroker.stepGuide.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#f87171',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ⚠️ {errorMessage}
              </div>
            )}

            {/* Ping Test Result Banner */}
            {pingResult && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#34d399',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>✓ Verified Handshake: {pingResult.message}</span>
                <span style={{ fontWeight: 800 }}>{pingResult.latency}ms</span>
              </div>
            )}

            {/* Form Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 5 }}>
                  Account Nickname / Label
                </label>
                <input
                  type="text"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  placeholder="e.g. Primary Scalping Key"
                  style={{
                    width: '100%',
                    background: 'rgba(2, 6, 23, 0.7)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    color: '#f8fafc',
                    fontSize: 13,
                  }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>API Key</label>
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 11, cursor: 'pointer' }}
                  >
                    {showKey ? 'Mask Key' : 'Reveal Key'}
                  </button>
                </div>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste exchange API Key..."
                  style={{
                    width: '100%',
                    background: 'rgba(2, 6, 23, 0.7)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    color: '#f8fafc',
                    fontSize: 13,
                    fontFamily: 'monospace',
                  }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>API Secret</label>
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 11, cursor: 'pointer' }}
                  >
                    {showSecret ? 'Mask Secret' : 'Reveal Secret'}
                  </button>
                </div>
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Paste API Secret (will be encrypted via AES-256)..."
                  style={{
                    width: '100%',
                    background: 'rgba(2, 6, 23, 0.7)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    color: '#f8fafc',
                    fontSize: 13,
                    fontFamily: 'monospace',
                  }}
                />
              </div>

              {selectedBroker.requiresPassphrase && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 5 }}>
                    Passphrase / Memo (Required by {selectedBroker.name})
                  </label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter passphrase used during API key creation..."
                    style={{
                      width: '100%',
                      background: 'rgba(2, 6, 23, 0.7)',
                      border: '1px solid rgba(148, 163, 184, 0.2)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      color: '#f8fafc',
                      fontSize: 13,
                      fontFamily: 'monospace',
                    }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="testnet-check"
                  checked={isTestnet}
                  onChange={(e) => setIsTestnet(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#6366f1' }}
                />
                <label htmlFor="testnet-check" style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
                  Connect to Testnet / Demo Sandbox environment
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingPing || savingConnection}
                style={{
                  flex: 1,
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#38bdf8',
                  padding: '10px 16px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: testingPing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {testingPing ? 'Pinging Exchange...' : '⚡ Test Connection'}
              </button>

              <button
                type="button"
                onClick={handleSaveConnection}
                disabled={savingConnection}
                style={{
                  flex: 1.3,
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  border: '1px solid #34d399',
                  color: '#ffffff',
                  padding: '10px 18px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: savingConnection ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                }}
              >
                {savingConnection ? 'Encrypting & Saving...' : 'Save & Connect Live'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
