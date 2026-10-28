'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { restoreSession, DEFAULT_DEMO_USER, saveAuth } from '../lib/api';

export default function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        await restoreSession();
        if (cancelled) return;
        setReady(true);
      } catch {
        if (cancelled) return;
        saveAuth({ token: 'demo_enterprise_dev_token', user: DEFAULT_DEMO_USER });
        setReady(true);
      }
    }

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
        Initializing Quanteinstein Terminal…
      </div>
    );
  }

  return <>{children}</>;
}
