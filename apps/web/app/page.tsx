'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getToken } from '../lib/api';

const FEATURES = [
  { icon: '🔬', title: 'Strategy Builder', desc: 'Configure BTCUSDT breakout-retest strategies with risk rules, targets, and filters.', href: '/strategy-builder' },
  { icon: '⚡', title: 'C++ Backtest Engine', desc: 'Sub-microsecond C++ engine replays historical data with full audit trail and event log.', href: '/backtests' },
  { icon: '🧠', title: 'Quant Coach', desc: 'Expectancy, Monte Carlo risk, walk-forward stability, stress testing, and objective pass/fail.', href: '/quant-coach' },
  { icon: '📊', title: 'Paper Trading', desc: 'Deterministic CSV replay simulates live paper trading. Zero real money, full analytics.', href: '/paper-trading' },
  { icon: '📓', title: 'Trade Journal', desc: 'Log every override, emotional state, and rule break. Behavioral intelligence analytics.', href: '/trade-journal' },
  { icon: '📈', title: 'Analytics', desc: 'R-multiple distribution, equity curve, drawdown, and benchmark comparison.', href: '/analytics' },
];

const DEMO_STEPS = [
  { n: '01', title: 'Create Strategy', desc: 'Go to Strategy Builder → configure your BTCUSDT breakout strategy' },
  { n: '02', title: 'Run Backtest', desc: 'Submit a backtest job → C++ engine runs on sample BTC data' },
  { n: '03', title: 'Quant Coach Report', desc: 'Open Quant Coach → see expectancy, Monte Carlo, and verdict' },
  { n: '04', title: 'Behavioral Insight', desc: 'Journal your trades → track rule violations and emotional overrides' },
];

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    if (getToken()) {
      setLoggedIn(true);
      window.location.replace('/dashboard');
    }
  }, []);

  const s = {
    page: { background: '#0d0d1a', minHeight: '100vh', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' },
    hero: { textAlign: 'center' as const, padding: '80px 24px 60px', maxWidth: 800, margin: '0 auto' },
    badge: { display: 'inline-block', background: '#6366f133', color: '#818cf8', border: '1px solid #6366f155', borderRadius: 20, padding: '4px 16px', fontSize: 13, fontWeight: 600, marginBottom: 24 },
    h1: { fontSize: 48, fontWeight: 800, lineHeight: 1.1, marginBottom: 20, background: 'linear-gradient(135deg,#6366f1,#8b5cf6,#a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
    sub: { fontSize: 18, color: '#94a3b8', lineHeight: 1.6, marginBottom: 40 },
    btnRow: { display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' as const },
    btn: { background: '#6366f1', color: '#fff', borderRadius: 10, padding: '14px 28px', fontWeight: 700, fontSize: 16, textDecoration: 'none', display: 'inline-block' },
    btnSec: { background: 'transparent', color: '#6366f1', border: '1px solid #6366f1', borderRadius: 10, padding: '14px 28px', fontWeight: 700, fontSize: 16, textDecoration: 'none', display: 'inline-block' },
    section: { padding: '60px 24px', maxWidth: 1100, margin: '0 auto' },
    sectionTitle: { fontSize: 28, fontWeight: 700, marginBottom: 8 },
    sectionSub: { fontSize: 15, color: '#666', marginBottom: 40 },
    featGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 },
    featCard: { background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: '24px', transition: 'border-color 0.2s' },
    featIcon: { fontSize: 32, marginBottom: 12 },
    featTitle: { fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#e2e8f0' },
    featDesc: { fontSize: 14, color: '#666', lineHeight: 1.6 },
    stepsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 },
    stepCard: { background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 12, padding: 24 },
    stepNum: { fontSize: 36, fontWeight: 800, color: '#2a2a4a', marginBottom: 8 },
    stepTitle: { fontSize: 15, fontWeight: 700, color: '#818cf8', marginBottom: 8 },
    footer: { textAlign: 'center' as const, padding: 40, color: '#555', fontSize: 13, borderTop: '1px solid #2a2a4a' },
  };

  return (
    <div style={s.page}>
      <div style={s.hero}>
        <div style={s.badge}>BTC-only · Paper trading · Research analytics</div>
        <h1 style={s.h1}>Quanteinstein</h1>
        <p style={s.sub}>
          <b style={{ color: '#6366f1' }}>Trade Daily, Trade Safely</b><br />
          Quanteinstein helps traders behave like disciplined quants using backtesting,
          paper trading, risk analytics, journaling, and Quant Coach insights.<br />
          <b style={{ color: '#6366f1' }}>No real money. No broker. Pure systematic discipline.</b>
        </p>
        <div style={s.btnRow}>
          {loggedIn ? (
            <Link href="/dashboard" style={s.btn}>Go to Dashboard →</Link>
          ) : (
            <>
              <Link href="/login" style={s.btn}>Get Started Free →</Link>
              <Link href="/login" style={s.btnSec}>Log In</Link>
            </>
          )}
        </div>
      </div>

      <div style={s.section}>
        <h2 style={s.sectionTitle}>Everything a quant needs for paper BTC trading</h2>
        <p style={s.sectionSub}>From strategy configuration to behavioral psychology — all in one system.</p>
        <div style={s.featGrid}>
          {FEATURES.map(f => (
            <Link key={f.href} href={f.href} style={{ textDecoration: 'none' }}>
              <div style={s.featCard}>
                <div style={s.featIcon}>{f.icon}</div>
                <div style={s.featTitle}>{f.title}</div>
                <div style={s.featDesc}>{f.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div style={{ ...s.section, background: '#1a1a2e', borderRadius: 16, margin: '0 24px 60px' }}>
        <h2 style={s.sectionTitle}>Demo flow</h2>
        <p style={s.sectionSub}>Strategy Builder → Backtest → Quant Coach Report → Behavior Insight</p>
        <div style={s.stepsGrid}>
          {DEMO_STEPS.map(step => (
            <div key={step.n} style={s.stepCard}>
              <div style={s.stepNum}>{step.n}</div>
              <div style={s.stepTitle}>{step.title}</div>
              <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5 }}>{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={s.footer}>
        Quanteinstein is research/analytics software only. Paper trading and backtests are hypothetical and do not represent real trading results.
        Not financial advice. No real-money execution. No broker integration.<br />
        © Quanteinstein — Trade Daily, Trade Safely
      </div>
    </div>
  );
}
