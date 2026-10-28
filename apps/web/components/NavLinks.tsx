'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getUser, type AuthUser } from '../lib/api';

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/strategy-builder', label: 'Strategy Builder', icon: '⚙️' },
  { href: '/backtests', label: 'Backtests', icon: '📈' },
  { href: '/quant-coach', label: 'Quant Coach', icon: '🧠' },
  { href: '/paper-trading', label: 'Paper Trading', icon: '⚡' },
  { href: '/charting', label: 'Charting', icon: '📉' },
  { href: '/beta-status', label: 'Alpha Feed', icon: '📡' },
  { href: '/trade-journal', label: 'Journal & Analytics', icon: '📓' },
  { href: '/api-management', label: 'API Keys', icon: '🔑', badge: 'INSTITUTIONAL' },
  { href: '/organization-settings', label: 'Organization', icon: '🏛️', badge: 'INSTITUTIONAL' },
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

  const items = [...NAV_ITEMS];

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        flex: 1,
        overflowX: 'auto',
        alignItems: 'center',
        padding: '2px 0',
        scrollbarWidth: 'none',
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
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.18s ease-in-out',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              color: isActive ? '#ffffff' : (badge ? '#c7d2fe' : '#94a3b8'),
              background: isActive
                ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.28) 0%, rgba(129, 140, 248, 0.16) 100%)'
                : (badge ? 'rgba(99, 102, 241, 0.08)' : 'transparent'),
              border: isActive
                ? '1px solid rgba(129, 140, 248, 0.45)'
                : (badge ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid transparent'),
              boxShadow: isActive
                ? '0 0 14px rgba(99, 102, 241, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                : 'none',
            }}
          >
            {isActive && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#818cf8',
                  boxShadow: '0 0 8px #818cf8',
                  display: 'inline-block',
                }}
              />
            )}
            <span>{icon}</span>
            <span>{label}</span>
            {badge && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
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
