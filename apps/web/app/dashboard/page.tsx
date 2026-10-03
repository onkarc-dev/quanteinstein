'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, AuthUser, fetchMe, formatApiError } from '../../lib/api';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Job {
  id: string;
  status: string;
  mode: string;
  created_at: string;
  display_strategy_id?: string;
  strategy_id?: string;
}

interface Strategy {
  id: string;
  name: string;
  timeframe?: string;
  symbols_json?: string;
}

interface CoachReport {
  final_verdict?: string;
  metrics?: {
    avg_R?: number;
    max_drawdown_R?: number;
    trades?: number;
    win_rate?: number;
    equity_curve_R?: number[];
  };
  monte_carlo?: {
    final_R?: { p50?: number };
    drawdown_R?: { p95?: number };
    risk_of_ruin_minus_10R?: number;
  };
  lifestyle_fit?: {
    score?: number;
    label?: string;
  };
  rule_discipline?: {
    manual_rule_violations_detected?: number;
  };
  strengths?: string[];
  weaknesses?: string[];
}

interface LiveEvent {
  event_type?: string;
  raw?: string;
  symbol?: string;
  status?: string;
  reason?: string;
  rejection_reason?: string;
  filled_quantity?: number | string;
  requested_quantity?: number | string;
  qty?: number | string;
  price?: number | string;
  fill?: number | string;
  r?: number | string;
  R_multiple?: number | string;
  result?: string;
}

interface LiveStatus {
  status?: string;
  feed_status?: string;
  symbol?: string;
  real_time?: boolean;
  last_price?: number;
  processed?: number;
  ticks_processed?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  metrics?: Record<string, any>;
  session_metrics?: Record<string, any>;
  symbol_states?: Record<string, Record<string, any>>;
  events?: LiveEvent[];
  markets?: Record<string, any>[];
  open_positions?: Record<string, any>[];
  open_positions_detail?: Record<string, any>[];
  wallet?: {
    starting_balance?: number;
    current_balance?: number;
    account_equity?: number;
    cash_balance?: number;
    realized_pnl?: number;
    unrealized_pnl?: number;
  };
  error?: string;
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────
const n = (v: any, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const fmt = (v: any, digits = 2, suffix = '') =>
  Number.isFinite(Number(v)) ? `${Number(v).toFixed(digits)}${suffix}` : '—';

const fmtCurrency = (v: any) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return '$100,000.00';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtPnL = (v: any) => {
  const num = Number(v);
  if (!Number.isFinite(num) || Math.abs(num) < 0.0001) return '$0.00';
  const prefix = num > 0 ? '+$' : '-$';
  return prefix + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const pct = (v: any) =>
  Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—';

function buildExecutionQuality(live: LiveStatus | null) {
  const metrics = { ...(live?.metrics || {}), ...(live?.session_metrics || {}) };
  const p95 = metrics.p95_engine_us || metrics.p95_latency_us || 0;
  const p99 = metrics.p99_engine_us || metrics.p99_latency_us || 0;
  return {
    orderStatus: live?.status === 'running' ? 'ACTIVE' : (live?.status?.toUpperCase() || 'IDLE'),
    p95EngineUs: p95,
    p99EngineUs: p99,
    processed: live?.processed || live?.ticks_processed || metrics.processed || 0,
    feedStatus: live?.feed_status || (live?.status === 'running' ? 'connected' : 'ready'),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MetricKpiCard({
  title,
  value,
  subtitle,
  badgeText,
  badgeColor,
  icon,
}: {
  title: string;
  value: string | React.ReactNode;
  subtitle?: string;
  badgeText?: string;
  badgeColor?: string;
  icon?: string;
}) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, rgba(22, 32, 51, 0.8) 0%, rgba(16, 24, 39, 0.95) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 16,
        padding: '20px 22px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
          <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {title}
          </span>
        </div>
        {badgeText && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 6,
              background: badgeColor ? `${badgeColor}18` : 'rgba(99, 102, 241, 0.15)',
              color: badgeColor || '#a5b4fc',
              border: `1px solid ${badgeColor ? `${badgeColor}40` : 'rgba(99, 102, 241, 0.3)'}`,
            }}
          >
            {badgeText}
          </span>
        )}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
          {value}
        </div>
        {subtitle && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict?: string }) {
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    PROMISING_PAPER_SYSTEM: { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80', label: 'PROMISING SYSTEM' },
    NEEDS_MORE_DATA: { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', label: 'NEEDS MORE SAMPLES' },
    DO_NOT_SCALE_YET: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', label: 'DO NOT SCALE' },
  };
  const match = colors[verdict || ''] || { bg: 'rgba(99, 102, 241, 0.15)', text: '#818cf8', label: verdict || 'ANALYZING' };

  return (
    <span
      style={{
        background: match.bg,
        color: match.text,
        border: `1px solid ${match.text}44`,
        borderRadius: 8,
        padding: '5px 12px',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.04em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: match.text }} />
      {match.label}
    </span>
  );
}

function EquityCurveChart({ data }: { data: number[] }) {
  if (!data?.length) return <div style={{ color: '#64748b', padding: '30px 20px', textAlign: 'center', fontSize: 13 }}>No trade data generated yet</div>;
  const points = data.map((v, i) => ({ trade: i + 1, equity: Number(v.toFixed(3)) }));

  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={points} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.06)" vertical={false} />
        <XAxis dataKey="trade" stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} />
        <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}R`} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(v: any) => [`${Number(v).toFixed(2)} R`, 'Cumulative P&L']}
          contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
        />
        <ReferenceLine y={0} stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="3 3" />
        <Area type="monotone" dataKey="equity" stroke="#6366f1" strokeWidth={2.5} fill="url(#equityGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function DrawdownChart({ data }: { data: number[] }) {
  if (!data?.length) return <div style={{ color: '#64748b', padding: '30px 20px', textAlign: 'center', fontSize: 13 }}>No drawdown data yet</div>;
  let peak = data[0];
  const dd = data.map((v, i) => {
    peak = Math.max(peak, v);
    return { trade: i + 1, drawdown: Number((v - peak).toFixed(3)) };
  });

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={dd} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="drawdownGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.45} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.06)" vertical={false} />
        <XAxis dataKey="trade" stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} />
        <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}R`} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(v: any) => [`${Number(v).toFixed(2)} R`, 'Drawdown from Peak']}
          contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
        />
        <ReferenceLine y={0} stroke="rgba(255, 255, 255, 0.2)" />
        <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={2} fill="url(#drawdownGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Main Dashboard Component ─────────────────────────────────────────────────
export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [report, setReport] = useState<CoachReport | null>(null);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const me = await fetchMe();
        setUser(me);
        const [jobsRes, strategiesRes, liveRes] = await Promise.all([
          api('/jobs/').catch(() => []),
          api('/strategies').catch(() => []),
          api('/live-paper/status').catch(() => null),
        ]);
        const jobList = Array.isArray(jobsRes) ? jobsRes : (jobsRes as { jobs?: Job[] }).jobs || [];
        const strategyList = Array.isArray(strategiesRes) ? strategiesRes : [];
        setJobs(jobList);
        setStrategies(strategyList);
        setLive(liveRes as LiveStatus | null);
      } catch (e) {
        setMsg(formatApiError(e));
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
    const t = window.setInterval(() => {
      api('/live-paper/status').then((res) => setLive(res as LiveStatus)).catch(() => {});
    }, 4000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (jobs.length > 0) {
      const lastCompleted = jobs.find((j) => j.status === 'completed');
      if (lastCompleted) {
        api(`/coach/${lastCompleted.id}/coach-report`).then(setReport).catch(() => {});
      }
    }
  }, [jobs]);

  const m = report?.metrics || {};
  const fit = report?.lifestyle_fit || {};
  const discipline = report?.rule_discipline || {};
  const quality = buildExecutionQuality(live);
  const wallet = live?.wallet || {};
  const equity = wallet.account_equity ?? wallet.current_balance ?? 100000;
  const realizedPnL = wallet.realized_pnl ?? live?.realized_pnl ?? 0;
  const unrealizedPnL = wallet.unrealized_pnl ?? live?.unrealized_pnl ?? 0;
  const openPositions = live?.open_positions_detail || live?.open_positions || [];

  // Tickers list
  const marketRows = live?.markets?.length
    ? live.markets
    : [
        { symbol: 'BTCUSDT', latest_price: live?.last_price || 84750 },
        { symbol: 'ETHUSDT', latest_price: 2685 },
        { symbol: 'SOLUSDT', latest_price: 119.5 },
        { symbol: 'BNBUSDT', latest_price: 785 },
        { symbol: 'XRPUSDT', latest_price: 1.49 },
        { symbol: 'DOGEUSDT', latest_price: 0.093 },
      ];

  if (loading) {
    return (
      <div style={{ background: '#0b0f19', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, border: '3px solid rgba(99, 102, 241, 0.2)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Initializing Quant Command Center...</div>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#0b0f19', minHeight: '100vh', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, sans-serif', paddingBottom: 64 }}>
      {/* ─── Executive Command Header ─── */}
      <div
        style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.85) 0%, rgba(11, 15, 25, 0.95) 100%)',
          backdropFilter: 'blur(16px)',
          padding: '28px 32px',
        }}
      >
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span
                style={{
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#818cf8',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  padding: '3px 9px',
                  borderRadius: 6,
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  textTransform: 'uppercase',
                }}
              >
                Quant Terminal
              </span>
              <span style={{ fontSize: 13, color: '#64748b' }}>•</span>
              <span style={{ fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                Trader: <strong style={{ color: '#f1f5f9' }}>{user?.name || 'Onkar'}</strong>
                {user?.email && <span style={{ color: '#64748b' }}>({user.email})</span>}
              </span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: '#ffffff', letterSpacing: '-0.02em' }}>
              Quantitative Research & Paper Trading Command
            </h1>
            <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: 13 }}>
              High-throughput Binance market data · Low-latency C++ paper execution · Strict R-multiple risk models
            </p>
          </div>

          {/* Quick Actions & Live Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                background: live?.status === 'running' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(30, 41, 59, 0.7)',
                border: `1px solid ${live?.status === 'running' ? 'rgba(34, 197, 94, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 600,
                color: live?.status === 'running' ? '#4ade80' : '#94a3b8',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: live?.status === 'running' ? '#22c55e' : '#64748b',
                  boxShadow: live?.status === 'running' ? '0 0 10px #22c55e' : 'none',
                }}
              />
              {live?.status === 'running' ? 'Live Paper Engine Active' : 'Paper Broker: Standby'}
            </div>

            <Link
              href="/strategy-builder"
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#ffffff',
                textDecoration: 'none',
                padding: '10px 18px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>+</span> New Strategy
            </Link>

            <Link
              href="/paper-trading"
              style={{
                background: 'rgba(30, 41, 59, 0.8)',
                color: '#e2e8f0',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                textDecoration: 'none',
                padding: '10px 16px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              ⚡ Paper Terminal
            </Link>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 32px 0' }}>
        {msg && (
          <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 10, padding: '12px 18px', color: '#f87171', fontSize: 13, marginBottom: 24 }}>
            {msg}
          </div>
        )}

        {/* ─── Top Level Key Performance Metrics (Executive Row) ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, marginBottom: 24 }}>
          <MetricKpiCard
            icon="💼"
            title="Paper Account Equity"
            value={fmtCurrency(equity)}
            subtitle={`Realized: ${fmtPnL(realizedPnL)} · Unrealized: ${fmtPnL(unrealizedPnL)}`}
            badgeText="100k Virtual"
            badgeColor="#22c55e"
          />

          <MetricKpiCard
            icon="⚡"
            title="Live Engine Speed"
            value={quality.p95EngineUs ? `${Number(quality.p95EngineUs).toFixed(1)} µs` : '< 15.0 µs'}
            subtitle={`Feed: ${quality.feedStatus.toUpperCase()} · ${quality.processed.toLocaleString()} ticks`}
            badgeText="Binance Feed"
            badgeColor="#3b82f6"
          />

          <MetricKpiCard
            icon="🎯"
            title="Quant Strategies"
            value={`${strategies.length} Defined`}
            subtitle="PRISM Breakout & Retest Engines"
            badgeText="10 Crypto Pairs"
            badgeColor="#8b5cf6"
          />

          <MetricKpiCard
            icon="📊"
            title="Completed Backtests"
            value={`${jobs.length} Runs`}
            subtitle={report ? `Verdict: ${report.final_verdict?.replace(/_/g, ' ') || 'Completed'}` : 'Run backtest in Strategy Builder'}
            badgeText={jobs.length > 0 ? 'Verified' : 'Ready'}
            badgeColor="#f59e0b"
          />
        </div>

        {/* ─── Live Market Ticker Strip ─── */}
        <div
          style={{
            background: 'rgba(17, 24, 39, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 14,
            padding: '12px 20px',
            marginBottom: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
            Binance Markets
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flex: 1, overflowX: 'auto' }}>
            {marketRows.slice(0, 8).map((mItem, idx) => (
              <div key={mItem.symbol || idx} style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{mItem.symbol}</span>
                <span style={{ color: '#38bdf8', fontFamily: 'monospace', fontWeight: 600 }}>
                  ${Number(mItem.latest_price || 0) > 10 ? Number(mItem.latest_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Number(mItem.latest_price).toFixed(4)}
                </span>
              </div>
            ))}
          </div>
          <Link href="/paper-trading" style={{ color: '#818cf8', fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Full Terminal →
          </Link>
        </div>

        {/* ─── Main 2-Column Content Layout ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
          {/* ──── LEFT COLUMN: Quant Coach & Active Positions ──── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Quant Coach Performance Panel */}
            <div
              style={{
                background: 'linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 18,
                padding: 24,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>🧠</span>
                    <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                      Quant Coach System Analytics
                    </h2>
                  </div>
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
                    Expectancy, drawdown risk & rule adherence derived from backtest trade logs
                  </p>
                </div>
                {report?.final_verdict ? (
                  <VerdictBadge verdict={report.final_verdict} />
                ) : (
                  <Link
                    href="/strategy-builder"
                    style={{
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#a5b4fc',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      padding: '5px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    Run Backtest →
                  </Link>
                )}
              </div>

              {report ? (
                <>
                  {/* Coach KPI Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
                    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Avg Expectancy</div>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: (m.avg_R ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
                        {m.avg_R != null ? `${m.avg_R.toFixed(3)} R` : '—'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Win Rate</div>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: '#38bdf8' }}>
                        {m.win_rate != null ? `${(m.win_rate * 100).toFixed(1)}%` : '—'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Max Drawdown</div>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: '#fbbf24' }}>
                        {m.max_drawdown_R != null ? `${m.max_drawdown_R.toFixed(2)} R` : '—'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Lifestyle Fit</div>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: '#c084fc' }}>
                        {fit.score ?? '—'}/100
                      </div>
                    </div>
                    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Rule Violations</div>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: discipline.manual_rule_violations_detected ? '#f87171' : '#4ade80' }}>
                        {discipline.manual_rule_violations_detected ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* Equity Curve Chart */}
                  <div style={{ background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 12, padding: '16px 14px 10px', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Cumulative Equity Curve (R-Multiples)</span>
                      <span style={{ color: '#6366f1', textTransform: 'none', fontWeight: 600 }}>{m.trades ?? 0} total trades</span>
                    </div>
                    <EquityCurveChart data={m.equity_curve_R || []} />
                  </div>

                  {/* Strengths & Weaknesses */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                    <div style={{ background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', marginBottom: 6 }}>
                        ✓ Quant Edge Strengths
                      </div>
                      {report.strengths?.length ? (
                        report.strengths.slice(0, 3).map((s, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#cbd5e1', padding: '3px 0' }}>• {s}</div>
                        ))
                      ) : (
                        <div style={{ fontSize: 12, color: '#64748b' }}>Sufficient trades needed to confirm edge.</div>
                      )}
                    </div>

                    <div style={{ background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 6 }}>
                        ⚠ Risk Factors & Warnings
                      </div>
                      {report.weaknesses?.length ? (
                        report.weaknesses.slice(0, 3).map((w, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#cbd5e1', padding: '3px 0' }}>• {w}</div>
                        ))
                      ) : (
                        <div style={{ fontSize: 12, color: '#64748b' }}>No adverse tail risks detected in sample.</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                /* Sleek Empty State for Coach */
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.4)',
                    border: '1px dashed rgba(255, 255, 255, 0.1)',
                    borderRadius: 14,
                    padding: '36px 24px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔬</div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px', color: '#f1f5f9' }}>
                    No Backtest Strategy Run Selected
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: 13, maxWidth: 500, margin: '0 auto 20px', lineHeight: 1.5 }}>
                    Execute a backtest in the Strategy Builder using cached Binance candles to evaluate trade expectancy, maximum drawdown, and Monte Carlo robustness.
                  </p>
                  <Link
                    href="/strategy-builder"
                    style={{
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      color: '#ffffff',
                      textDecoration: 'none',
                      padding: '9px 20px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      display: 'inline-block',
                    }}
                  >
                    + Open Strategy Builder
                  </Link>
                </div>
              )}
            </div>

            {/* Live Paper Trading Open Positions & State */}
            <div
              style={{
                background: 'linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 18,
                padding: 24,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📈</span> Active Paper Positions & Live Trades
                  </h2>
                  <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 12 }}>
                    Real-time paper broker order executions on live Binance WebSocket data
                  </p>
                </div>
                <Link href="/paper-trading" style={{ color: '#818cf8', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                  Manage Live Session →
                </Link>
              </div>

              {openPositions.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase' }}>Symbol</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase' }}>Side</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase' }}>Entry</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase' }}>Current</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase' }}>R-Multiple</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase' }}>Unrealized P&L</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase' }}>Stop Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openPositions.map((pos, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                          <td style={{ padding: '12px 10px', fontWeight: 700, color: '#f8fafc' }}>{pos.symbol}</td>
                          <td style={{ padding: '12px 10px' }}>
                            <span style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                              {pos.side || 'BUY'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 10px', fontFamily: 'monospace' }}>${fmt(pos.entry_price, 2)}</td>
                          <td style={{ padding: '12px 10px', fontFamily: 'monospace', color: '#38bdf8' }}>${fmt(pos.current_price, 2)}</td>
                          <td style={{ padding: '12px 10px', fontFamily: 'monospace', fontWeight: 700, color: (pos.current_R ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
                            {pos.current_R != null ? `${Number(pos.current_R).toFixed(2)} R` : '—'}
                          </td>
                          <td style={{ padding: '12px 10px', fontFamily: 'monospace', color: (pos.unrealized_pnl ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
                            {fmtPnL(pos.unrealized_pnl)}
                          </td>
                          <td style={{ padding: '12px 10px', fontFamily: 'monospace', color: '#f87171' }}>${fmt(pos.stop, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: 12,
                    padding: '28px 20px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
                    {live?.status === 'running'
                      ? 'Live paper engine active — listening for PRISM setup triggers on Binance live feed.'
                      : 'Paper broker is idle. Select your strategy in Paper Trading to initiate live simulation.'}
                  </div>
                  <Link
                    href="/paper-trading"
                    style={{
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#a5b4fc',
                      border: '1px solid rgba(99, 102, 241, 0.35)',
                      textDecoration: 'none',
                      padding: '8px 18px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'inline-block',
                    }}
                  >
                    Launch Live Paper Trading →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* ──── RIGHT COLUMN: Recent Runs, Telemetry & Quick Links ──── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Recent Strategy Runs */}
            <div
              style={{
                background: 'linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 18,
                padding: 22,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>⏱</span> Recent Strategy Executions
                </h3>
                <Link href="/backtests" style={{ color: '#818cf8', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                  All ({jobs.length}) →
                </Link>
              </div>

              {jobs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {jobs.slice(0, 5).map((job) => (
                    <div
                      key={job.id}
                      style={{
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: 10,
                        padding: '10px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 13 }}>
                          {job.display_strategy_id || job.strategy_id || `Job #${job.id.slice(0, 8)}`}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {job.mode?.toUpperCase() || 'BACKTEST'} • {new Date(job.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 6,
                          background:
                            job.status === 'completed'
                              ? 'rgba(34, 197, 94, 0.15)'
                              : job.status === 'running'
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                          color:
                            job.status === 'completed'
                              ? '#4ade80'
                              : job.status === 'running'
                              ? '#60a5fa'
                              : '#f87171',
                        }}
                      >
                        {job.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '24px 10px' }}>
                  No strategy backtest jobs run yet.
                </div>
              )}
            </div>

            {/* Engine Telemetry & Infrastructure Health */}
            <div
              style={{
                background: 'linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 18,
                padding: 22,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🛡</span> Engine Telemetry & Safety
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <span style={{ color: '#94a3b8' }}>Engine Core</span>
                  <span style={{ color: '#f1f5f9', fontWeight: 600 }}>C++ Matching & Paper Broker</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <span style={{ color: '#94a3b8' }}>Data Source</span>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>Binance Real WebSocket</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <span style={{ color: '#94a3b8' }}>Execution Latency</span>
                  <span style={{ color: '#4ade80', fontWeight: 600, fontFamily: 'monospace' }}>
                    {quality.p95EngineUs ? `${fmt(quality.p95EngineUs, 1)} µs` : '< 15 µs'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <span style={{ color: '#94a3b8' }}>Capital Risk</span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>$0.00 (Pure Paper)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span style={{ color: '#94a3b8' }}>Fill Model</span>
                  <span style={{ color: '#cbd5e1' }}>Real-time Tick Fills</span>
                </div>
              </div>
            </div>

            {/* Quick Navigation Cards */}
            <div
              style={{
                background: 'linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 18,
                padding: 22,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', color: '#f8fafc' }}>
                Quant Workflows
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Link
                  href="/strategy-builder"
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    padding: '12px 10px',
                    textDecoration: 'none',
                    textAlign: 'center',
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>🛠</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Builder</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>PRISM Rules</div>
                </Link>

                <Link
                  href="/quant-coach"
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    padding: '12px 10px',
                    textDecoration: 'none',
                    textAlign: 'center',
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>🧠</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Coach</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Expectancy</div>
                </Link>

                <Link
                  href="/charting"
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    padding: '12px 10px',
                    textDecoration: 'none',
                    textAlign: 'center',
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>📊</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Charting</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Live Candlesticks</div>
                </Link>

                <Link
                  href="/trade-journal"
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    padding: '12px 10px',
                    textDecoration: 'none',
                    textAlign: 'center',
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 4 }}>📓</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Journal</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Discipline Log</div>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Footer Regulatory & Safety Notice ─── */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', padding: '24px 0', marginTop: 40, textAlign: 'center', color: '#64748b', fontSize: 12, lineHeight: 1.6 }}>
          Quanteinstein is a quantitative research and paper trading platform. Backtest models and simulated executions are hypothetical and do not represent real-money trades.
          Zero broker connectivity · Zero capital risk · Not financial advice.
        </div>
      </div>
    </div>
  );
}
