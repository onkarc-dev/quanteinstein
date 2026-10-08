import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import AuthProvider from '../components/AuthProvider';
import ProfileMenu from '../components/ProfileMenu';

export const metadata: Metadata = {
  title: 'Quanteinstein — Trade Daily, Trade Smartly',
  description: 'Quanteinstein paper trading platform. Trade Daily, Trade Smartly. Not financial advice.',
};

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/strategy-builder', label: 'Strategy Builder' },
  { href: '/backtests', label: 'Backtests' },
  { href: '/quant-coach', label: 'Quant Coach' },
  { href: '/paper-trading', label: 'Paper Trading' },
  { href: '/charting', label: 'Charting' },
  { href: '/beta-status', label: 'Beta Status' },
  { href: '/trade-journal', label: 'Journal' },
  { href: '/analytics', label: 'Analytics' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav style={{
          background: '#0d0d1a',
          borderBottom: '1px solid #2a2a4a',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          height: 56,
          gap: 0,
          position: 'sticky' as const,
          top: 0,
          zIndex: 100,
        }}>
          <Link href="/" style={{
            fontWeight: 800,
            fontSize: 18,
            color: '#6366f1',
            textDecoration: 'none',
            marginRight: 32,
            letterSpacing: -0.5,
          }}>
            Quanteinstein
          </Link>
          <div style={{ display: 'flex', gap: 4, flex: 1, overflowX: 'auto' as const }}>
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} style={{
                color: '#94a3b8',
                textDecoration: 'none',
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: 'nowrap' as const,
              }}>
                {label}
              </Link>
            ))}
          </div>
          <div style={{
            fontSize: 11,
            color: '#555',
            background: '#1a1a2e',
            border: '1px solid #2a2a4a',
            borderRadius: 6,
            padding: '4px 10px',
            whiteSpace: 'nowrap' as const,
          }}>
            📄 Paper only · No real money
          </div>
          <ProfileMenu />
        </nav>
        <main><AuthProvider>{children}</AuthProvider></main>
      </body>
    </html>
  );
}
