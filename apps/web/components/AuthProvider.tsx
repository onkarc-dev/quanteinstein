'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getToken, restoreSession } from '../lib/api';

const PUBLIC_PATHS = new Set(['/', '/login']);

export default function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      const isPublic = PUBLIC_PATHS.has(pathname);

      try {
        const user = await restoreSession();
        if (cancelled) return;

        if (!user) {
          if (!isPublic) {
            router.replace('/login?expired=1');
            return;
          }
          setReady(true);
          return;
        }

        if (pathname === '/login') {
          router.replace('/dashboard');
          return;
        }

        setReady(true);
      } catch {
        if (cancelled) return;
        if (!isPublic) {
          router.replace('/login');
          return;
        }
        setReady(true);
      }
    }

    setReady(false);
    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div style={{
        background: '#0d0d1a',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        fontFamily: 'system-ui, sans-serif',
      }}>
        Loading session…
      </div>
    );
  }

  return <>{children}</>;
}
