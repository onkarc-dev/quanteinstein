'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getUser, type AuthUser } from '../lib/api';

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/strategy-builder', label: 'Strategies', icon: '⚙️' },
  { href: '/backtests', label: 'Backtests', icon: '📈' },
  { href: '/quant-coach', label: 'Coach', icon: '🧠' },
  { href: '/paper-trading', label: 'Paper Trade', icon: '⚡' },
  { href: '/broker-integrations', label: 'Brokers', icon: '🔗', badge: 'LIVE', title: 'Broker Connections' },
  { href: '/charting', label: 'Charting', icon: '📉' },
  { href: '/beta-status', label: 'Feed', icon: '📡' },
  { href: '/trade-journal', label: 'Journal', icon: '📓' },
  { href: '/api-management', label: 'API Keys', icon: '🔑', badge: 'INST' },
  { href: '/organization-settings', label: 'Organization', icon: '🏛️', badge: 'INST' },
  { href: '/admin', label: 'Admin', icon: '🛡️', badge: 'ADMIN' },
];

export default function NavLinks() {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getUser());
    const onStorage = () => setUser(getUser());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise' || user?.tier === 'ENTERPRISE';
  const items = NAV_ITEMS.filter((item) => {
    if (isEnterprise && (item.href === '/beta-status' || item.href === '/community')) {
      return false;
    }
    return true;
  });

  return (
    <div
      style={{
        display: 'flex',
        gap: 3,
        flex: 1,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '2px 0',
        minWidth: 0,
      }}
    >
      {items.map(({ href, label, icon, badge }) => {
        const isActive =
          pathname === href ||
          (href !== '/' && pathname.startsWith(href)) ||
          (href === '/trade-journal' && pathname.startsWith('/analytics'));

        return (
          <Link
            key={href}
            href={href}
            style={{
              textDecoration: 'none',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease-in-out',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              color: isActive ? '#ffffff' : (badge === 'ADMIN' ? '#fcd34d' : (badge ? '#c7d2fe' : '#94a3b8')),
              background: isActive
                ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.32) 0%, rgba(129, 140, 248, 0.18) 100%)'
                : (badge === 'ADMIN' ? 'rgba(245, 158, 11, 0.08)' : (badge ? 'rgba(99, 102, 241, 0.08)' : 'transparent')),
              border: isActive
                ? '1px solid rgba(129, 140, 248, 0.45)'
                : (badge === 'ADMIN' ? '1px solid rgba(245, 158, 11, 0.25)' : (badge ? '1px solid rgba(99, 102, 241, 0.22)' : '1px solid transparent')),
              boxShadow: isActive
                ? '0 0 10px rgba(99, 102, 241, 0.22)'
                : 'none',
            }}
          >
            {isActive && (
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: '#818cf8',
                  boxShadow: '0 0 6px #818cf8',
                  display: 'inline-block',
                }}
              />
            )}
            <span style={{ fontSize: 13 }}>{icon}</span>
            <span>{label}</span>
            {badge && (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: badge === 'ADMIN'
                    ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                    : badge === 'LIVE'
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                  color: '#ffffff',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
