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
        }}
      >
        Profile
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 36,
          width: 220,
          background: '#111827',
          border: '1px solid #374151',
          borderRadius: 10,
          padding: 12,
          boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
          zIndex: 1000,
        }}>
          <div style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Name</div>
          <div style={{ color: '#ffffff', fontWeight: 800, marginTop: 4, marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
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
