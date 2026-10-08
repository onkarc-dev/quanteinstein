'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/strategy-builder', label: 'Strategy Builder', icon: '⚙️' },
  { href: '/backtests', label: 'Backtests', icon: '📈' },
  { href: '/quant-coach', label: 'Quant Coach', icon: '🧠' },
  { href: '/paper-trading', label: 'Paper Trading', icon: '⚡' },
  { href: '/charting', label: 'Charting', icon: '📉' },
  { href: '/beta-status', label: 'Beta Status', icon: '🛡️' },
  { href: '/trade-journal', label: 'Journal', icon: '📓' },
  { href: '/analytics', label: 'Analytics', icon: '🔬' },
];

export default function NavLinks() {
  const pathname = usePathname();

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
      {NAV_ITEMS.map(({ href, label }) => {
        const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));

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
              color: isActive ? '#ffffff' : '#94a3b8',
              background: isActive
                ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.28) 0%, rgba(129, 140, 248, 0.16) 100%)'
                : 'transparent',
              border: isActive
                ? '1px solid rgba(129, 140, 248, 0.45)'
                : '1px solid transparent',
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
            {label}
          </Link>
        );
      })}
    </div>
  );
}
