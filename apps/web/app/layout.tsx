import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import AuthProvider from '../components/AuthProvider';
import ProfileMenu from '../components/ProfileMenu';
import NavLinks from '../components/NavLinks';

export const metadata: Metadata = {
  title: 'Quanteinstein — Trade Daily, Trade Smartly',
  description: 'Quanteinstein paper trading platform. Trade Daily, Trade Smartly. Not financial advice.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

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
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
            marginRight: 24,
            flexShrink: 0,
          }}>
            <img
              src="/logo.png"
              alt="Quanteinstein"
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                objectFit: 'cover',
                aspectRatio: '1 / 1',
                imageRendering: '-webkit-optimize-contrast',
                border: '1.5px solid rgba(212, 175, 55, 0.6)',
                boxShadow: '0 0 12px rgba(212, 175, 55, 0.3)',
              }}
            />
            <span style={{
              fontWeight: 800,
              fontSize: 18,
              color: '#f8fafc',
              letterSpacing: -0.5,
            }}>
              Quanteinstein
            </span>
          </Link>
          <NavLinks />
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
