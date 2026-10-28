'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getUser, type AuthUser } from '../../lib/api';
import RetailBrokerHub from '../../components/RetailBrokerHub';
import EnterpriseFixSetup from '../../components/EnterpriseFixSetup';

export default function BrokerIntegrationsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<'retail' | 'enterprise'>('retail');

  useEffect(() => {
    const u = getUser();
    setUser(u);
    // If user is enterprise, default to enterprise tab if preferred, or allow switching
    if (u?.tier === 'ENTERPRISE') {
      // User can view either retail or enterprise
    }
  }, []);

  const isEnterprise = user?.tier === 'ENTERPRISE' || user?.role === 'ORGANIZATION_ADMIN';

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Breadcrumb & Execution Mode Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            href="/dashboard"
            style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <span>←</span> Dashboard
          </Link>
          <span style={{ color: '#475569' }}>/</span>
          <span style={{ color: '#f8fafc', fontSize: 13, fontWeight: 600 }}>Broker & Exchange Integrations</span>
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
              padding: '4px 10px',
              borderRadius: 6,
              fontWeight: 600,
            }}
          >
            ⚡ Open Paper Trading Simulator
          </Link>

          {/* User Tier Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isEnterprise ? 'rgba(99, 102, 241, 0.15)' : 'rgba(56, 189, 248, 0.15)',
              border: isEnterprise ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(56, 189, 248, 0.4)',
              padding: '3px 10px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              color: isEnterprise ? '#c7d2fe' : '#7dd3fc',
            }}
          >
            <span>{isEnterprise ? 'INSTITUTIONAL TIER' : 'RETAIL TRADER'}</span>
          </div>
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
