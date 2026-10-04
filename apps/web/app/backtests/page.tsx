'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, API_BASE, getToken } from '../../lib/api';
import TradingChart from '../../components/TradingChart';
import BacktestAnalytics from '../../components/BacktestAnalytics';
import { classifyTradeResultFromR } from '../../lib/tradeClassification';

function fmt(n: any, d = 2) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x.toFixed(d).replace(/\.00$/, '') : '0';
}

function metric(n: any, suffix = '', d = 2) {
  if (n === null || n === undefined || n === '') return 'Not enough data';
  const x = Number(n);
  return Number.isFinite(x) ? `${x.toFixed(d).replace(/\.00$/, '')}${suffix}` : 'Not enough data';
}

function parseSymbols(j: any): string[] {
  try {
    const list = JSON.parse(j.symbols_json || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function displayStrategy(j: any) {
  return j?.display_strategy_id || j?.user_strategy_id || j?.strategy_code || j?.strategy_id || 'PRISM_STRATEGY';
}

function formatDateTime(isoString: string) {
  if (!isoString) return '-';
  try {
    const normalized = isoString.endsWith('Z') ? isoString : `${isoString}Z`;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return isoString.replace('T', ' ').replace('Z', ' UTC');
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

function PerformanceRobustness({ data }: { data: any }) {
  const pr = data?.performance_and_robustness || {};
  const ra = pr.risk_adjusted || {};
  const ex = pr.expectancy || {};
  const risk = pr.risk || {};
  const tb = pr.trading_behavior || {};
  const robust = pr.robustness || {};
  const warnings = Array.isArray(pr.warnings) ? pr.warnings : [];

  if (!data?.performance_and_robustness) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#38bdf8' }}>📐</span> Institutional Performance &amp; Factor Attribution
        </h3>
        <span style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(56, 189, 248, 0.08)', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.2)' }}>
          Risk-Adjusted Alpha Engine
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {/* Quadrant 1: Risk Adjusted */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Risk-Adjusted Ratios
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Sharpe Ratio</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>{metric(ra.sharpe)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Sortino Ratio</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>{metric(ra.sortino)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Calmar Ratio</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{metric(ra.calmar)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Omega Ratio</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{metric(ra.omega)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Recovery Factor</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{metric(ra.recovery_factor)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Ulcer Index</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{metric(risk.ulcer_index)}</div>
            </div>
          </div>
        </div>

        {/* Quadrant 2: Expectancy & Payoff */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Expectancy &amp; Payoff Profile
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Expectancy R / Trade</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#34d399' }}>{metric(ex.expectancy_R_per_trade, ' R')}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Trades / Day</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>{metric(tb.trades_per_day)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Avg Winner / Loser</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                <span style={{ color: '#4ade80' }}>{metric(ex.average_winner_R, 'R')}</span> / <span style={{ color: '#f87171' }}>{metric(ex.average_loser_R, 'R')}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Largest Win / Loss</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                <span style={{ color: '#4ade80' }}>{metric(ex.largest_winner_R, 'R')}</span> / <span style={{ color: '#f87171' }}>{metric(ex.largest_loser_R, 'R')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quadrant 3: Execution & Turnover */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Execution &amp; Exposure
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Real Notional Turnover</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{tb.turnover_display || 'Not enough data'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Turnover Proxy</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{tb.turnover_proxy_display || 'Not enough data'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Market Exposure %</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{tb.exposure_display || 'Not enough data'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Max Consecutive W / L</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                <span style={{ color: '#4ade80' }}>{risk.max_consecutive_wins ?? 0}</span> / <span style={{ color: '#f87171' }}>{risk.max_consecutive_losses ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quadrant 4: Overfitting & Integrity */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Robustness &amp; Curve-Fitting
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Overfitting Risk Rating</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: robust.overfitting_risk_label?.includes('Low') ? '#34d399' : '#f59e0b', marginTop: 2 }}>
              {robust.overfitting_risk_label || 'Low Risk'} {robust.overfitting_risk_score !== undefined ? `(${robust.overfitting_risk_score}/10)` : ''}
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
            Ratios require sufficient R-dispersion. Notional turnover requires equity curves; proxy indicates activity density.
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>Institutional Notices:</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
            {warnings.map((w: string) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Backtests() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'jobs' | 'upload'>('jobs');
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [msg, setMsg] = useState('');
  const [uploadResult, setUploadResult] = useState<any>(null);

  async function uploadCsv(ev: any) {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      setMsg('Uploading offline CSV and running backtest engine...');
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/backtests/upload-csv`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data));
      setUploadResult(data);
      setMsg('CSV backtest simulation complete.');
    } catch (e: any) {
      setMsg('CSV upload failed: ' + e.message);
    }
  }

  async function refresh(silent = false) {
    if (!silent) setLoadingJobs(true);
    try {
      const r: any = await api('/jobs/');
      const list = Array.isArray(r) ? r : r.jobs || [];
      setJobs(list);
      // Auto-update selected job state if status changed
      if (selected) {
        const found = list.find((j: any) => j.id === selected.id);
        if (found && found.status !== selected.status) {
          setSelected(found);
          if (found.status === 'completed') {
            load(found, true);
          }
        }
      }
      if (!silent) setMsg('');
    } catch (e: any) {
      if (!silent) setMsg('Jobs load failed: ' + e.message);
    } finally {
      if (!silent) setLoadingJobs(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Check if any job is currently pending (running or queued)
  const hasPending = useMemo(() => {
    return jobs.some((j: any) => j.status === 'running' || j.status === 'queued');
  }, [jobs]);

  // Reactive polling while jobs are running/queued
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => {
      refresh(true);
    }, 2500);
    return () => clearInterval(interval);
  }, [hasPending, selected?.id, selected?.status]);

  async function load(j: any, silent = false) {
    try {
      setSelected(j);
      setSummary(null);
      setTrades([]);
      if (!silent) setLoadingReport(true);
      const [s, t] = await Promise.all([api(`/reports/${j.id}/summary`), api(`/reports/${j.id}/trade-log`)]);
      setSummary(s);
      setTrades(Array.isArray(t) ? t : []);
      if (!silent) setMsg('');
    } catch (e: any) {
      if (!silent) setMsg('Report load failed: ' + e.message);
    } finally {
      if (!silent) setLoadingReport(false);
    }
  }

  const selectedSymbols = useMemo(() => {
    return selected ? parseSymbols(selected) : [];
  }, [selected]);

  const deployStrategyId = useMemo(() => {
    return selected?.display_strategy_id || selected?.user_strategy_id || selected?.strategy_id || 'PRISM';
  }, [selected]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '16px 20px 48px' }}>
      {/* Top Breadcrumb & Hero */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b', marginBottom: 6 }}>
          <span>Strategy Studio</span>
          <span>/</span>
          <span style={{ color: '#38bdf8', fontWeight: 600 }}>Backtest Lab &amp; Analytics</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
              Quantitative Backtest Lab
            </h1>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
              Verify user-defined strategy setups against authentic Binance historical klines, audit multi-asset attribution, and deploy directly to Live Paper Trading.
            </p>
          </div>

          {/* Quick Action Navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link
              href="/strategy-builder"
              style={{
                textDecoration: 'none',
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: '#f8fafc',
                background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>⚡</span> Strategy Builder
            </Link>

            <Link
              href="/paper-trading"
              style={{
                textDecoration: 'none',
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: '#f8fafc',
                background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
                border: '1px solid rgba(52, 211, 153, 0.4)',
                boxShadow: '0 2px 8px rgba(5, 150, 105, 0.25)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>🚀</span> Paper Trading
            </Link>

            <button
              onClick={() => refresh()}
              disabled={loadingJobs}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: '#cbd5e1',
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid #334155',
                cursor: loadingJobs ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ display: 'inline-block', transform: loadingJobs ? 'rotate(180deg)' : 'none', transition: 'transform 0.4s' }}>🔄</span>
              {loadingJobs ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Status Indicators & Live Poller Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <span style={{ fontSize: 12, color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399' }} />
            Authentic Binance Klines
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>•</span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Zero Real-Capital Risk
          </span>
          {hasPending && (
            <>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>•</span>
              <span style={{ fontSize: 12, color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }} />
                Auto-refresh active (monitoring running backtests)
              </span>
            </>
          )}
        </div>
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            background: msg.includes('failed') ? 'rgba(239, 68, 68, 0.12)' : 'rgba(56, 189, 248, 0.12)',
            border: `1px solid ${msg.includes('failed') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
            color: msg.includes('failed') ? '#fca5a5' : '#7dd3fc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{msg}</span>
          <button
            onClick={() => setMsg('')}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* View Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', marginBottom: 20 }}>
        <button
          onClick={() => setActiveTab('jobs')}
          style={{
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 700,
            color: activeTab === 'jobs' ? '#38bdf8' : '#94a3b8',
            background: activeTab === 'jobs' ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'jobs' ? '2px solid #38bdf8' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          Strategy Backtest Runs ({jobs.length})
        </button>
        <button
          onClick={() => setActiveTab('upload')}
          style={{
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 700,
            color: activeTab === 'upload' ? '#38bdf8' : '#94a3b8',
            background: activeTab === 'upload' ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'upload' ? '2px solid #38bdf8' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          Custom Kline CSV Upload
        </button>
      </div>

      {/* Tab 1: Strategy Backtest Runs */}
      {activeTab === 'jobs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Jobs Table Card */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid #1e293b',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', margin: '0 0 2px' }}>
                  Execution History
                </h2>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Select any completed run to view full trade log, factor attribution, and equity curve.
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '10px 12px' }}>Strategy</th>
                    <th style={{ padding: '10px 12px' }}>Asset Basket</th>
                    <th style={{ padding: '10px 12px' }}>Status</th>
                    <th style={{ padding: '10px 12px' }}>TF &amp; Mode</th>
                    <th style={{ padding: '10px 12px' }}>Executed At</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '36px 12px', textAlign: 'center', color: '#64748b' }}>
                        No backtest runs found. Create and backtest a strategy in{' '}
                        <Link href="/strategy-builder" style={{ color: '#38bdf8', textDecoration: 'none' }}>
                          Strategy Builder
                        </Link>
                        .
                      </td>
                    </tr>
                  ) : (
                    jobs.map((j) => {
                      const isSelected = selected?.id === j.id;
                      const symList = parseSymbols(j);
                      const isCompleted = j.status === 'completed';
                      const isRunning = j.status === 'running' || j.status === 'queued';
                      const isFailed = j.status === 'failed';

                      return (
                        <tr
                          key={j.id}
                          style={{
                            borderBottom: '1px solid #1e293b',
                            background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          {/* Strategy Name */}
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 700, color: isSelected ? '#38bdf8' : '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>{displayStrategy(j)}</span>
                              {isSelected && (
                                <span style={{ fontSize: 10, background: '#38bdf8', color: '#0f172a', padding: '1px 5px', borderRadius: 4, fontWeight: 800 }}>
                                  ACTIVE
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
                              ID: {j.id.slice(0, 8)}
                            </div>
                          </td>

                          {/* Asset Basket */}
                          <td style={{ padding: '12px' }}>
                            {symList.length <= 1 ? (
                              <span style={{ background: 'rgba(30, 41, 59, 0.8)', border: '1px solid #334155', color: '#cbd5e1', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                                {symList[0] || 'BTCUSDT'}
                              </span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', color: '#38bdf8', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                                  {symList.length} Symbols
                                </span>
                                <span style={{ fontSize: 11, color: '#94a3b8', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {symList.slice(0, 3).join(', ')}...
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Status Badge */}
                          <td style={{ padding: '12px' }}>
                            {isCompleted && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                                <span>✓</span> Completed
                              </span>
                            )}
                            {isRunning && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#38bdf8' }} />
                                {j.status === 'queued' ? 'Queued' : 'Processing...'}
                              </span>
                            )}
                            {isFailed && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                                <span>✕</span> Failed
                              </span>
                            )}
                          </td>

                          {/* TF & Mode */}
                          <td style={{ padding: '12px' }}>
                            <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{j.timeframe}</div>
                            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>{j.mode}</div>
                          </td>

                          {/* Executed At */}
                          <td style={{ padding: '12px', color: '#94a3b8', fontSize: 12 }}>
                            {formatDateTime(j.created_at)}
                          </td>

                          {/* Actions */}
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              {isCompleted && (
                                <>
                                  <button
                                    onClick={() => load(j)}
                                    disabled={loadingReport && isSelected}
                                    style={{
                                      padding: '6px 12px',
                                      borderRadius: 6,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: isSelected ? '#38bdf8' : '#f8fafc',
                                      background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.8)',
                                      border: isSelected ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid #334155',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {isSelected ? '✓ Viewing' : '📊 Open Report'}
                                  </button>

                                  <Link
                                    href={`/paper-trading?strategy_id=${encodeURIComponent(displayStrategy(j))}`}
                                    style={{
                                      textDecoration: 'none',
                                      padding: '6px 10px',
                                      borderRadius: 6,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: '#34d399',
                                      background: 'rgba(52, 211, 153, 0.1)',
                                      border: '1px solid rgba(52, 211, 153, 0.3)',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <span>🚀</span> Paper Trade
                                  </Link>
                                </>
                              )}

                              {isRunning && (
                                <button
                                  onClick={() => refresh()}
                                  style={{
                                    padding: '6px 12px',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: '#38bdf8',
                                    background: 'rgba(56, 189, 248, 0.1)',
                                    border: '1px solid rgba(56, 189, 248, 0.3)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  ⏳ Polling...
                                </button>
                              )}

                              {isFailed && (
                                <button
                                  onClick={() => {
                                    setSelected(j);
                                    setSummary(null);
                                    setTrades([]);
                                    setMsg(j.error_message || 'Job execution encountered an error.');
                                  }}
                                  style={{
                                    padding: '6px 12px',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: '#f87171',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  ⚠️ View Error
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Job Header Banner */}
          {selected && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: 12,
                padding: '16px 20px',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>
                    {displayStrategy(selected)}
                  </span>
                  <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                    {selected.timeframe} TF
                  </span>
                  <span style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                    {selectedSymbols.length > 1 ? `${selectedSymbols.length} Market Basket` : selectedSymbols[0] || 'BTCUSDT'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  Job ID: {selected.id} • Mode: {selected.mode} • Executed: {formatDateTime(selected.created_at)}
                </div>
                {selected.error_message && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 6, color: '#fca5a5', fontSize: 12 }}>
                    Error details: {selected.error_message}
                  </div>
                )}
              </div>

              {/* Direct Deploy CTA */}
              <div>
                <Link
                  href={`/paper-trading?strategy_id=${encodeURIComponent(deployStrategyId)}`}
                  style={{
                    textDecoration: 'none',
                    padding: '10px 20px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#ffffff',
                    background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
                    border: '1px solid rgba(52, 211, 153, 0.5)',
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.35)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>🚀</span> Deploy to Live Paper Trading →
                </Link>
              </div>
            </div>
          )}

          {/* Selected Job KPI Cards */}
          {summary && (
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid #1e293b',
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
                Key Performance Indicators (Friction &amp; Slippage Deducted)
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                {/* Net Return */}
                <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Net Return (After Fees)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: Number(summary.net_R ?? summary.gross_R ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
                    {fmt(summary.net_R ?? summary.gross_R)} R
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Gross: {fmt(summary.gross_R)} R
                  </div>
                </div>

                {/* Win Rate */}
                <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Win Rate</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc' }}>
                    {Number((summary.win_rate ?? 0) * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    {summary.total_trades ?? 0} Total Trades
                  </div>
                </div>

                {/* Profit Factor */}
                <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Profit Factor</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc' }}>
                    {fmt(summary.profit_factor)}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Gross Win / Gross Loss
                  </div>
                </div>

                {/* Max Drawdown */}
                <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Max Drawdown</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f87171' }}>
                    -{fmt(summary.max_drawdown_in_R)} R
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Peak-to-Trough Decline
                  </div>
                </div>

                {/* Average Trade */}
                <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Average R / Trade</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: Number(summary.average_R ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
                    {fmt(summary.average_R)} R
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Expectancy per setup
                  </div>
                </div>

                {/* Bars Processed */}
                <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Data Volume</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc' }}>
                    {(summary.bars_processed ?? 0).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Candles Simulated
                  </div>
                </div>
              </div>

              {/* Performance & Robustness */}
              <PerformanceRobustness data={summary} />
            </div>
          )}

          {/* Interactive BacktestAnalytics Component (Charts, Symbol Breakdown & Trade Log) */}
          {trades.length > 0 && (
            <BacktestAnalytics
              trades={trades}
              summary={summary}
              strategyName={displayStrategy(selected)}
            />
          )}
        </div>
      )}

      {/* Tab 2: Custom Kline CSV Upload */}
      {activeTab === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid #1e293b',
              borderRadius: 12,
              padding: 20,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc', margin: '0 0 4px' }}>
              Custom Kline CSV Simulation
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
              Upload custom offline candlestick data to verify strategy rules against unique or proprietary historical periods.
              Required CSV headers: <code style={{ color: '#38bdf8' }}>timestamp, open, high, low, close, volume</code>.
            </p>

            <div
              style={{
                border: '2px dashed #334155',
                borderRadius: 10,
                padding: '24px 20px',
                textAlign: 'center',
                background: 'rgba(15, 23, 42, 0.4)',
              }}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={uploadCsv}
                style={{
                  fontSize: 13,
                  color: '#cbd5e1',
                  background: 'rgba(30, 41, 59, 0.6)',
                  padding: '8px 14px',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
                Accepts standard Binance, TradingView, or generic OHLCV CSV formats.
              </div>
            </div>

            {uploadResult && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#34d399', marginBottom: 12 }}>
                  ✓ CSV Simulation Completed Successfully
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Candles Processed</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{uploadResult.rows}</div>
                  </div>
                  <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Win Rate</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>
                      {Number((uploadResult.win_rate || 0) * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Profit Factor</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{fmt(uploadResult.profit_factor)}</div>
                  </div>
                  <div style={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Export Path</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', overflowWrap: 'anywhere' }}>{uploadResult.result_export_path}</div>
                  </div>
                </div>

                <PerformanceRobustness data={uploadResult} />

                <div style={{ marginTop: 20 }}>
                  <TradingChart
                    candles={[
                      {
                        time: uploadResult.first_timestamp,
                        open: uploadResult.start_close,
                        high: Math.max(uploadResult.start_close, uploadResult.end_close),
                        low: Math.min(uploadResult.start_close, uploadResult.end_close),
                        close: uploadResult.end_close,
                      },
                    ]}
                    markers={[{ time: uploadResult.first_timestamp, position: 'belowBar', text: 'CSV' }]}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
