'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getUser, setTierOverride, type AuthUser } from '../../lib/api';
import RetailBrokerHub from '../../components/RetailBrokerHub';
import EnterpriseFixSetup from '../../components/EnterpriseFixSetup';

export default function BrokerIntegrationsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<'retail' | 'enterprise'>('retail');

  useEffect(() => {
    const update = () => {
      const current = getUser();
      setUser(current);
      if (current?.tier === 'ENTERPRISE') {
        setActiveTab('enterprise');
      }
    };
    update();
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);

  const isEnterprise = user?.tier === 'ENTERPRISE' || user?.role === 'ORGANIZATION_ADMIN';

  const handleTierSwitch = (targetTier: 'RETAIL' | 'ENTERPRISE') => {
    const updated = setTierOverride(targetTier);
    setUser(updated);
    setActiveTab(targetTier === 'ENTERPRISE' ? 'enterprise' : 'retail');
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Breadcrumb & Live Mode Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            href="/dashboard"
            style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <span>←</span> Dashboard
          </Link>
          <span style={{ color: '#475569' }}>/</span>
          <span style={{ color: '#f8fafc', fontSize: 13, fontWeight: 600 }}>Broker Connections & Exchange Integrations</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Paper Trading quick link */}
          <Link
            href="/paper-trading"
            style={{
              fontSize: 12,
              color: '#a5b4fc',
              textDecoration: 'none',
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              padding: '5px 12px',
              borderRadius: 6,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>⚡</span> Open Paper Trading Simulator
          </Link>
        </div>
      </div>

      {/* Developer Tier Toggle Bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          borderRadius: 10,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 14,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: isEnterprise ? 'rgba(99, 102, 241, 0.2)' : 'rgba(56, 189, 248, 0.2)',
              border: isEnterprise ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(56, 189, 248, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            {isEnterprise ? '🏛️' : '⚡'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Developer Tier Switcher</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: isEnterprise
                    ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                    : 'linear-gradient(135deg, #0284c7, #06b6d4)',
                  color: '#ffffff',
                  letterSpacing: 0.5,
                }}
              >
                ACTIVE TIER: {isEnterprise ? 'ENTERPRISE (B2B)' : 'RETAIL (B2C)'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              Instant toggle between Retail B2C (Top 25 Crypto / 6 Forex APIs) and Enterprise B2B (Tier-1 Prime Broker FIX 4.4 DMA).
            </div>
          </div>
        </div>

        {/* Interactive Segmented Switcher */}
        <div
          style={{
            display: 'flex',
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: 8,
            padding: 3,
            gap: 4,
          }}
        >
          <button
            onClick={() => handleTierSwitch('RETAIL')}
            style={{
              padding: '7px 16px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              background: !isEnterprise ? 'linear-gradient(135deg, #0284c7, #0369a1)' : 'transparent',
              color: !isEnterprise ? '#ffffff' : '#94a3b8',
              boxShadow: !isEnterprise ? '0 2px 8px rgba(2, 132, 199, 0.35)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <span>⚡</span> Retail Trader (CCXT)
          </button>
          <button
            onClick={() => handleTierSwitch('ENTERPRISE')}
            style={{
              padding: '7px 16px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              background: isEnterprise ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'transparent',
              color: isEnterprise ? '#ffffff' : '#94a3b8',
              boxShadow: isEnterprise ? '0 2px 8px rgba(99, 102, 241, 0.35)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <span>🏛️</span> Institutional Enterprise (FIX DMA)
          </button>
        </div>
      </div>

      {/* Primary Tab Navigation */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
          paddingBottom: 2,
        }}
      >
        <button
          onClick={() => setActiveTab('retail')}
          style={{
            background: activeTab === 'retail' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'retail' ? '2px solid #818cf8' : '2px solid transparent',
            color: activeTab === 'retail' ? '#ffffff' : '#94a3b8',
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: '8px 8px 0 0',
            transition: 'all 0.15s ease',
          }}
        >
          <span>⚡</span>
          <span>Retail Broker Hub (Crypto & Forex)</span>
          <span
            style={{
              fontSize: 10,
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              padding: '1px 6px',
              borderRadius: 4,
              fontWeight: 800,
            }}
          >
            31 BROKERS
          </span>
        </button>

        <button
          onClick={() => setActiveTab('enterprise')}
          style={{
            background: activeTab === 'enterprise' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'enterprise' ? '2px solid #818cf8' : '2px solid transparent',
            color: activeTab === 'enterprise' ? '#ffffff' : '#94a3b8',
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: '8px 8px 0 0',
            transition: 'all 0.15s ease',
          }}
        >
          <span>🏛️</span>
          <span>Prime Brokerage FIX Setup (Enterprise)</span>
          <span
            style={{
              fontSize: 10,
              background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
              color: '#ffffff',
              padding: '1px 6px',
              borderRadius: 4,
              fontWeight: 800,
            }}
          >
            FIX 4.4 DMA
          </span>
        </button>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'retail' ? (
          <RetailBrokerHub />
        ) : (
          <EnterpriseFixSetup />
        )}
      </div>
    </div>
  );
}
