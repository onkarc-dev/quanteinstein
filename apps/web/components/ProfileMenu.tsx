'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getUser, logout, type AuthUser } from '../lib/api';

export default function ProfileMenu() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setUser(getUser());
    const onStorage = () => setUser(getUser());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!user) {
    return null;
  }

  const displayName = user.name?.trim() || user.email;
  const emailLower = (user.email || '').toLowerCase();
  const isOwnerAdmin =
    emailLower === 'onkarchouguletrader@gmail.com' ||
    emailLower.includes('admin') ||
    (typeof window !== 'undefined' && Boolean(sessionStorage.getItem('quanteinstein_admin_auth')));
  const isEnterprise = user.tier === 'ENTERPRISE' || user.tier === 'PRO' || isOwnerAdmin;

  const handleToggleTier = () => {
    const nextTier = (user.tier === 'ENTERPRISE' ? 'RETAIL' : 'ENTERPRISE') as 'RETAIL' | 'ENTERPRISE';
    const updatedUser = { ...user, tier: nextTier };
    const serialized = JSON.stringify(updatedUser);
    localStorage.setItem('prismflow_user', serialized);
    localStorage.setItem('quanteinstein_user', serialized);
    localStorage.setItem('user', serialized);
    setUser(updatedUser);
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <div style={{ position: 'relative', marginLeft: 10 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: '#111827',
          border: '1px solid #374151',
          color: '#e5e7eb',
          borderRadius: 8,
          padding: '6px 12px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>Profile</span>
        {user.tier === 'ENTERPRISE' && (
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            padding: '1px 5px',
            borderRadius: 4,
            background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
            color: '#fff',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            INSTITUTIONAL
          </span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 36,
          width: 230,
          background: '#111827',
          border: '1px solid #374151',
          borderRadius: 10,
          padding: 12,
          boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
          zIndex: 1000,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Account</div>
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              color: user.tier === 'ENTERPRISE' ? '#38bdf8' : '#94a3b8',
              background: user.tier === 'ENTERPRISE' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              padding: '2px 6px',
              borderRadius: 4,
            }}>
              {user.tier || 'RETAIL'}
            </span>
          </div>
          <div style={{ color: '#ffffff', fontWeight: 800, marginTop: 4, marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
          
          {/* 1-Click Interactive Dual-Tier Switcher */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            padding: '6px 8px',
            background: '#0a0e1a',
            borderRadius: 8,
            border: '1px solid #1e293b'
          }}>
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Active Tier:</span>
            <button
              type="button"
              onClick={handleToggleTier}
              style={{
                background: user.tier === 'ENTERPRISE' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                border: user.tier === 'ENTERPRISE' ? '1px solid #38bdf8' : '1px solid #475569',
                color: user.tier === 'ENTERPRISE' ? '#38bdf8' : '#cbd5e1',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
              title="Click to toggle between Retail and Enterprise Institutional Tier"
            >
              {user.tier === 'ENTERPRISE' ? '⚡ ENTERPRISE (Switch)' : '🎒 RETAIL (Switch)'}
            </button>
          </div>

          <Link
            href="/organization-settings"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textDecoration: 'none',
              color: '#38bdf8',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            <span>🏛️</span> Organization Settings
          </Link>
          <Link
            href="/api-management"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textDecoration: 'none',
              color: '#a5b4fc',
              background: 'rgba(99, 102, 241, 0.12)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            <span>🔑</span> API Management
          </Link>
          {isOwnerAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textDecoration: 'none',
                color: '#f8fafc',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              <span>🛡️</span> Admin Dashboard
            </Link>
          )}
          <button
            onClick={logout}
            style={{
              width: '100%',
              background: '#7f1d1d',
              border: '1px solid #991b1b',
              color: '#fff',
              borderRadius: 8,
              padding: '8px 10px',
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
