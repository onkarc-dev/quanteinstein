import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import AuthProvider from '../components/AuthProvider';
import ProfileMenu from '../components/ProfileMenu';
import NavLinks from '../components/NavLinks';

export const metadata: Metadata = {
  title: 'Quanteinstein Enterprise OS · Institutional Execution & Risk Management System',
  description: 'Quanteinstein Enterprise OS — Institutional quantitative research, zero-copy POSIX shared-memory DMA execution, and real-time risk management system.',
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
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          minHeight: 52,
          height: 'auto',
          gap: 10,
          position: 'sticky' as const,
          top: 0,
          zIndex: 100,
          flexWrap: 'wrap',
        }}>
          <Link href="/" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
            marginRight: 10,
            flexShrink: 0,
          }}>
            <img
              src="/logo.png"
              alt="Quanteinstein"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                objectFit: 'cover',
                aspectRatio: '1 / 1',
                imageRendering: '-webkit-optimize-contrast',
                border: '1.5px solid rgba(212, 175, 55, 0.6)',
                boxShadow: '0 0 10px rgba(212, 175, 55, 0.3)',
              }}
            />
            <span style={{
              fontWeight: 800,
              fontSize: 16,
              color: '#f8fafc',
              letterSpacing: -0.5,
            }}>
              Quanteinstein
            </span>
          </Link>
          <NavLinks />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            marginLeft: 'auto',
          }}>
            <div style={{
              fontSize: 10,
              color: '#64748b',
              background: '#131826',
              border: '1px solid #243044',
              borderRadius: 6,
              padding: '3px 8px',
              whiteSpace: 'nowrap' as const,
            }}>
              📄 Paper mode
            </div>
            <ProfileMenu />
          </div>
        </nav>
        <main><AuthProvider>{children}</AuthProvider></main>
      </body>
    </html>
  );
}
