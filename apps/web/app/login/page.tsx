'use client';
import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function Login() {
  return (
    <Suspense
      fallback={
        <div style={{
          minHeight: 'calc(100vh - 56px)',
          background: 'radial-gradient(ellipse at 50% 0%, #151a2e 0%, #0a0d18 70%, #060810 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: 14,
        }}>
          Connecting to Quanteinstein Terminal…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
