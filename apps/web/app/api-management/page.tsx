'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, getUser, type AuthUser } from '../../lib/api';

interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  rate_limit_per_minute: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: number;
}

export default function ApiManagementPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create Key Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyMode, setKeyMode] = useState<'live' | 'test'>('live');
  const [expiresDays, setExpiresDays] = useState(90);
  const [creating, setCreating] = useState(false);

  // Secret Display Modal State
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Python Quickstart Code Tab
  const [activeTab, setActiveTab] = useState<'keys' | 'quickstart'>('keys');

  useEffect(() => {
    const u = getUser();
    setUser(u);
    loadKeys();
  }, []);

  async function loadKeys() {
    try {
      setLoading(true);
      setError(null);
      const res: any = await api('/api/v1/keys');
      if (res && Array.isArray(res.keys)) {
        setKeys(res.keys);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    try {
      setCreating(true);
      setError(null);
      const res: any = await api('/api/v1/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: keyName.trim(),
          mode: keyMode,
          permissions: ['data:read', 'backtest:run', 'orders:write'],
          expires_in_days: expiresDays,
        }),
      });

      if (res?.api_key?.api_key_secret) {
        setCreatedSecret(res.api_key.api_key_secret);
        setShowCreateModal(false);
        setKeyName('');
        await loadKeys();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to generate API key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!confirm('Are you sure you want to revoke this API key? This will immediately disconnect all running Python/Jupyter scripts using this key.')) {
      return;
    }
    try {
      await api(`/api/v1/keys/${keyId}`, { method: 'DELETE' });
      await loadKeys();
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke key');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const isEnterprise =
    user?.tier === 'ENTERPRISE' ||
    user?.role === 'ADMIN' ||
    user?.role === 'ORG_ADMIN' ||
    user?.email?.toLowerCase() === 'onkarchouguletrader@gmail.com';

  const pythonSnippet = `import requests
import pandas as pd

# 1. Initialize Headless Quant Client
API_BASE = "https://quantos-api.onrender.com/api/v1"
API_KEY = "${createdSecret || 'qe_live_your_api_key_here'}"
HEADERS = {"X-API-Key": API_KEY}

# 2. Extract Terabyte-Scale Historical OHLCV into a Pandas DataFrame
ohlcv_resp = requests.get(
    f"{API_BASE}/market-data/ohlcv",
    headers=HEADERS,
    params={
        "symbol": "BTCUSDT",
        "timeframe": "1m",
        "start_date": "2026-06-01",
        "end_date": "2026-06-15",
        "limit": 50000,
    }
)
df = pd.DataFrame(ohlcv_resp.json()["bars"])
print(f"Loaded {len(df)} candles into DataFrame:")
print(df.head())

# 3. Submit Programmatic Backtest from Python ML Pipeline
backtest_payload = {
    "strategy_name": "Jupyter Alpha Signal V1",
    "symbols": ["BTCUSDT"],
    "timeframe": "1m",
    "start_date": "2026-06-01",
    "end_date": "2026-06-15",
    "strategy_config": {
        "direction": "both",
        "breakout_lookback": 20,
        "risk": {"risk_per_trade_pct": 1.0}
    },
    "sync": True
}
bt_resp = requests.post(f"{API_BASE}/backtests/run", headers=HEADERS, json=backtest_payload)
results = bt_resp.json()
print("Backtest Execution Completed:")
print(f"Sharpe Ratio: {results['metrics']['sharpe_ratio']}")
print(f"Total Trades: {results['metrics']['total_trades']}")
print(f"Total Return: {results['metrics']['total_return_pct']}%")

# 4. Programmatic Order Execution
order_resp = requests.post(
    f"{API_BASE}/orders",
    headers=HEADERS,
    json={"symbol": "BTCUSDT", "side": "BUY", "qty": 0.25, "order_type": "MARKET"}
)
print("Order Status:", order_resp.json()["status"])
`;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 24 }}>🔑</span>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: '#f8fafc', margin: 0 }}>Headless API Management</h1>
            <span style={{
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))',
              border: '1px solid rgba(129, 140, 248, 0.4)',
              color: '#a5b4fc',
              fontSize: 11,
              fontWeight: 800,
              padding: '3px 9px',
              borderRadius: 999,
              letterSpacing: 0.5,
            }}>
              ENTERPRISE TIER
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0, maxWidth: 680 }}>
            Provision high-throughput API keys for Python/Jupyter quantitative research, algorithmic execution bots, and terabyte-scale historical market data extraction.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#ffffff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
            }}
          >
            <span>+</span> Generate API Key
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div style={{ display: 'flex', gap: 12, borderBottom: '1px solid #1e293b', paddingBottom: 12, marginBottom: 24 }}>
        <button
          onClick={() => setActiveTab('keys')}
          style={{
            background: activeTab === 'keys' ? '#1e293b' : 'transparent',
            border: 'none',
            color: activeTab === 'keys' ? '#ffffff' : '#94a3b8',
            padding: '8px 16px',
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Active API Keys ({keys.length})
        </button>
        <button
          onClick={() => setActiveTab('quickstart')}
          style={{
            background: activeTab === 'quickstart' ? '#1e293b' : 'transparent',
            border: 'none',
            color: activeTab === 'quickstart' ? '#ffffff' : '#94a3b8',
            padding: '8px 16px',
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Python & Jupyter Quickstart
        </button>
      </div>

      {/* Enterprise Upgrade Banner for Non-Enterprise users */}
      {!isEnterprise && (
        <div style={{
          background: 'rgba(234, 179, 8, 0.1)',
          border: '1px solid rgba(234, 179, 8, 0.3)',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ color: '#facc15', fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
              Tier Upgrade Available
            </div>
            <div style={{ color: '#cbd5e1', fontSize: 13 }}>
              Your account is currently on Retail Tier (standard rate limits: 120 req/min). Enterprise Tier unlocks isolated single-tenant databases, 3,600 req/min programmatic throughput, and dedicated WebSocket feeds.
            </div>
          </div>
          <Link
            href="/dashboard"
            style={{
              background: '#eab308',
              color: '#000000',
              fontWeight: 800,
              fontSize: 12,
              padding: '8px 14px',
              borderRadius: 6,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Explore Enterprise
          </Link>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          color: '#f87171',
          padding: '12px 16px',
          borderRadius: 8,
          marginBottom: 20,
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Active Tab View */}
      {activeTab === 'keys' && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#111827', borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <th style={{ padding: '14px 18px' }}>Label / Name</th>
                <th style={{ padding: '14px 18px' }}>Prefix</th>
                <th style={{ padding: '14px 18px' }}>Rate Limit</th>
                <th style={{ padding: '14px 18px' }}>Permissions</th>
                <th style={{ padding: '14px 18px' }}>Created</th>
                <th style={{ padding: '14px 18px' }}>Last Used</th>
                <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: '36px 18px', textAlign: 'center', color: '#64748b' }}>
                    Loading API keys...
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px 18px', textAlign: 'center' }}>
                    <div style={{ color: '#94a3b8', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>No API keys generated yet</div>
                    <p style={{ color: '#64748b', fontSize: 12, margin: 0, marginBottom: 16 }}>
                      Create an API key to access historical market data and backtest engines from Jupyter notebooks.
                    </p>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      style={{
                        background: '#1e293b',
                        color: '#f8fafc',
                        border: '1px solid #334155',
                        padding: '8px 16px',
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      + Generate Your First Key
                    </button>
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} style={{ borderBottom: '1px solid #1e293b', transition: 'background 0.15s' }}>
                    <td style={{ padding: '14px 18px', color: '#f8fafc', fontWeight: 700 }}>
                      {k.name}
                    </td>
                    <td style={{ padding: '14px 18px', fontFamily: 'monospace', color: '#818cf8', fontWeight: 700 }}>
                      {k.key_prefix}••••••••
                    </td>
                    <td style={{ padding: '14px 18px', color: '#94a3b8' }}>
                      <span style={{ color: '#38bdf8', fontWeight: 700 }}>{k.rate_limit_per_minute}</span> req/min
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(k.permissions || []).map((p) => (
                          <span
                            key={p}
                            style={{
                              background: '#1e293b',
                              color: '#94a3b8',
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontFamily: 'monospace',
                            }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '14px 18px', color: '#64748b', fontSize: 12 }}>
                      {k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '14px 18px', color: '#64748b', fontSize: 12 }}>
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleRevokeKey(k.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.12)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '5px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Python Quickstart View */}
      {activeTab === 'quickstart' && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ color: '#f8fafc', fontSize: 16, fontWeight: 800, margin: '0 0 4px 0' }}>
                Python & Jupyter Notebook Client
              </h3>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                Copy and run this self-contained script in your Jupyter Notebook or Python research script.
              </p>
            </div>
            <button
              onClick={() => copyToClipboard(pythonSnippet)}
              style={{
                background: copied ? '#10b981' : '#1e293b',
                color: '#ffffff',
                border: '1px solid #334155',
                padding: '8px 14px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {copied ? '✓ Copied to Clipboard' : 'Copy Code Snippet'}
            </button>
          </div>
          <pre style={{
            background: '#090d16',
            border: '1px solid #1e293b',
            padding: 20,
            borderRadius: 8,
            overflowX: 'auto',
            color: '#38bdf8',
            fontSize: 12,
            lineHeight: 1.6,
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          }}>
            {pythonSnippet}
          </pre>
        </div>
      )}

      {/* Modal: Generate API Key */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20,
        }}>
          <div style={{
            background: '#111827',
            border: '1px solid #1e293b',
            borderRadius: 14,
            width: '100%',
            maxWidth: 480,
            padding: 26,
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          }}>
            <h3 style={{ color: '#ffffff', fontSize: 18, fontWeight: 800, marginTop: 0, marginBottom: 6 }}>
              Generate Programmatic API Key
            </h3>
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
              Keys provide full programmatic access to market data, backtest clusters, and order routing.
            </p>
            <form onSubmit={handleCreateKey}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Key Name / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Jupyter Alpha Research Cluster"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: '#0b0f19',
                    border: '1px solid #334155',
                    color: '#ffffff',
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Environment Mode
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setKeyMode('live')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: keyMode === 'live' ? 'rgba(99, 102, 241, 0.2)' : '#0b0f19',
                      border: keyMode === 'live' ? '1px solid #6366f1' : '1px solid #334155',
                      color: keyMode === 'live' ? '#ffffff' : '#94a3b8',
                      borderRadius: 6,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Live (qe_live_...)
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeyMode('test')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: keyMode === 'test' ? 'rgba(99, 102, 241, 0.2)' : '#0b0f19',
                      border: keyMode === 'test' ? '1px solid #6366f1' : '1px solid #334155',
                      color: keyMode === 'test' ? '#ffffff' : '#94a3b8',
                      borderRadius: 6,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Sandbox / Test (qe_test_...)
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 22 }}>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Validity Period
                </label>
                <select
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#0b0f19',
                    border: '1px solid #334155',
                    color: '#ffffff',
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                >
                  <option value={30}>30 Days</option>
                  <option value={90}>90 Days (Recommended)</option>
                  <option value={180}>180 Days</option>
                  <option value={365}>1 Year</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    background: '#1e293b',
                    color: '#94a3b8',
                    border: '1px solid #334155',
                    padding: '9px 16px',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    background: '#6366f1',
                    color: '#ffffff',
                    border: 'none',
                    padding: '9px 18px',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: creating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {creating ? 'Generating...' : 'Create Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Secret Created (Shown Once) */}
      {createdSecret && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20,
        }}>
          <div style={{
            background: '#111827',
            border: '1px solid #10b981',
            borderRadius: 14,
            width: '100%',
            maxWidth: 520,
            padding: 28,
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#10b981', fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
              <span>✓</span> API Key Generated Successfully
            </div>
            <p style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
              Please copy your secret key now. For institutional security compliance, this key will <strong style={{ color: '#f43f5e' }}>never be displayed again</strong>.
            </p>

            <div style={{
              background: '#090d16',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '12px 14px',
              fontFamily: 'monospace',
              fontSize: 13,
              color: '#38bdf8',
              wordBreak: 'break-all',
              marginBottom: 20,
              userSelect: 'all',
            }}>
              {createdSecret}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => copyToClipboard(createdSecret)}
                style={{
                  background: copied ? '#10b981' : '#6366f1',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 18px',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {copied ? '✓ Copied' : 'Copy Key'}
              </button>
              <button
                onClick={() => setCreatedSecret(null)}
                style={{
                  background: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '10px 16px',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                I Have Saved It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
