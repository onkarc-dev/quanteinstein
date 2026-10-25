'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, formatApiError } from '../../lib/api';
import { classifyTradeRow, cleanupExitReason } from '../../lib/tradeClassification';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Job = {
  id: string;
  status: string;
  mode?: string;
  created_at?: string;
  timeframe?: string;
  symbol?: string;
  symbols?: string[];
  symbols_json?: string;
  display_strategy_id?: string;
  user_strategy_id?: string;
  strategy_code?: string;
  strategy_id?: string;
};

type TradeRow = Record<string, any>;

interface JournalReflection {
  emotional_state: string;
  rule_followed: boolean;
  notes: string;
  created_at: string;
}

function money(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function rFmt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}R`;
}

function cleanTime(v: any) {
  if (!v) return '-';
  const raw = String(v).replace('+00:00Z', 'Z');
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.replace('T', ' ').replace('Z', ' UTC');
  return d.toLocaleString(undefined, { hour12: false });
}

function cleanReason(v: any) {
  return String(v || '-')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function resultFromRow(r: TradeRow) {
  return classifyTradeRow(r);
}

function resultStyle(result: any) {
  const r = String(result).toUpperCase();
  if (r === 'WIN') return { color: '#86efac', fontWeight: 800, background: 'rgba(34,197,94,0.12)', padding: '2px 8px', borderRadius: 6, display: 'inline-block' };
  if (r === 'LOSS') return { color: '#fca5a5', fontWeight: 800, background: 'rgba(239,68,68,0.12)', padding: '2px 8px', borderRadius: 6, display: 'inline-block' };
  if (r === 'BREAKEVEN') return { color: '#e2e8f0', fontWeight: 800, background: 'rgba(148,163,184,0.12)', padding: '2px 8px', borderRadius: 6, display: 'inline-block' };
  if (r === 'OPEN') return { color: '#93c5fd', fontWeight: 800, background: 'rgba(59,130,246,0.12)', padding: '2px 8px', borderRadius: 6, display: 'inline-block' };
  return { color: '#e5e7eb', fontWeight: 800 };
}

function signedStyle(v: any) {
  const n = Number(String(v ?? '').replace(/[R,$,% ]/g, ''));
  if (!Number.isFinite(n)) return {};
  if (n > 0) return { color: '#86efac', fontWeight: 800 };
  if (n < 0) return { color: '#fca5a5', fontWeight: 800 };
  return { color: '#e5e7eb', fontWeight: 800 };
}

function displayStrategy(j: Job) {
  return j.display_strategy_id || j.user_strategy_id || j.strategy_code || j.strategy_id || 'STRATEGY';
}

function jobLabel(j: Job) {
  const date = j.created_at ? new Date(j.created_at).toLocaleString(undefined, { hour12: false }) : 'date unknown';
  let sym = Array.isArray(j.symbols) && j.symbols.length ? j.symbols.join(',') : j.symbol || 'market';
  if ((!sym || sym === 'market') && j.symbols_json) {
    try {
      sym = JSON.parse(j.symbols_json).join(',');
    } catch {}
  }
  return `${displayStrategy(j)} · ${(j.mode || 'job').toUpperCase()} · ${sym} · ${j.status} · ${date}`;
}

function bucketRMultiples(values: number[]) {
  if (!values.length) return [];
  const min = Math.floor(Math.min(...values) * 2) / 2;
  const max = Math.ceil(Math.max(...values) * 2) / 2;
  const out: Record<string, number> = {};
  for (let b = min; b <= max; b += 0.5) out[b.toFixed(1)] = 0;
  values.forEach(v => {
    const key = (Math.floor(v / 0.5) * 0.5).toFixed(1);
    out[key] = (out[key] || 0) + 1;
  });
  return Object.entries(out).map(([r, count]) => ({
    r: `${Number(r) > 0 ? '+' : ''}${r}R`,
    count,
    fill: Number(r) >= 0 ? '#22c55e' : '#ef4444',
  }));
}

const chartBox: CSSProperties = { width: '100%', height: 260 };
const tooltipStyle: CSSProperties = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#e2e8f0',
  fontSize: 12,
  padding: '6px 10px',
  boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
};

export default function JournalAndAnalytics() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState('');
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [curveData, setCurveData] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // View & Filter states
  const [activeTab, setActiveTab] = useState<'ALL' | 'CHARTS' | 'LEDGER' | 'BEHAVIOR'>('ALL');
  const [resultFilter, setResultFilter] = useState<'ALL' | 'WIN' | 'LOSS' | 'BREAKEVEN'>('ALL');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Behavioral Reflection State
  const [emotionalState, setEmotionalState] = useState<string>('Calm & Disciplined');
  const [ruleFollowed, setRuleFollowed] = useState<boolean>(true);
  const [journalNotes, setJournalNotes] = useState<string>('');
  const [reflections, setReflections] = useState<JournalReflection[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    api('/jobs/')
      .then((r: any) => {
        const list = Array.isArray(r) ? r : r.jobs || [];
        setJobs(list);
        setMsg('');
        // Automatically select the first completed job if available
        const completed = list.find((j: Job) => j.status === 'completed') || list[0];
        if (completed) {
          loadSession(completed.id);
        }
      })
      .catch(e => setMsg(`Backend connection notice: ${formatApiError(e)}`));

    // Load saved reflections
    const saved = localStorage.getItem('quanteinstein_journal_reflections');
    if (saved) {
      try {
        setReflections(JSON.parse(saved));
      } catch {}
    }
  }, []);

  const showToast = (txt: string) => {
    setToastMessage(txt);
    setTimeout(() => setToastMessage(null), 3000);
  };

  async function loadSession(id: string) {
    setSelectedJob(id);
    if (!id) {
      setRows([]);
      setAnalyticsData(null);
      setCurveData([]);
      return;
    }
    setLoading(true);
    setMsg('');

    try {
      const [tradeLogRes, rMultiplesRes, curveRes] = await Promise.allSettled([
        api(`/reports/${id}/trade-log`),
        api(`/analytics/${id}/r-multiples`),
        api(`/analytics/${id}/equity-curve`),
      ]);

      if (tradeLogRes.status === 'fulfilled') {
        const data: any = tradeLogRes.value;
        setRows(Array.isArray(data) ? data : data.rows || []);
      } else {
        setRows([]);
      }

      if (rMultiplesRes.status === 'fulfilled') {
        setAnalyticsData(rMultiplesRes.value);
      } else {
        setAnalyticsData(null);
      }

      if (curveRes.status === 'fulfilled') {
        const c: any = curveRes.value;
        setCurveData(Array.isArray(c) ? c : []);
      } else {
        setCurveData([]);
      }
    } catch (e: any) {
      setMsg(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }

  // Summary Metrics Calculation
  const summary = useMemo(() => {
    const total = rows.length;
    const wins = rows.filter(r => resultFromRow(r) === 'WIN').length;
    const losses = rows.filter(r => resultFromRow(r) === 'LOSS').length;
    const be = rows.filter(r => resultFromRow(r) === 'BREAKEVEN').length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    const rValues = rows
      .map(r => Number(r.r_multiple ?? r.R_multiple ?? r.r))
      .filter(v => Number.isFinite(v));

    const gross = rValues.reduce((a, b) => a + b, 0);
    const avgR = rValues.length > 0 ? gross / rValues.length : 0;

    const grossWins = rValues.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const grossLosses = Math.abs(rValues.filter(r => r < 0).reduce((a, b) => a + b, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99.0 : 0;

    return { total, wins, losses, be, winRate, gross, avgR, profitFactor, rValues };
  }, [rows]);

  // Derived High-Resolution Equity & Drawdown Curve
  const equityCurve = useMemo(() => {
    if (curveData && curveData.length > 0) {
      let peak = 0;
      return curveData.map((r, i) => {
        const eq = Number(r.equity_R || 0);
        peak = Math.max(peak, eq);
        return {
          trade: i + 1,
          trade_id: r.trade_id || `T-${i + 1}`,
          equity_R: eq,
          drawdown_R: eq - peak,
        };
      });
    }

    // Fallback: reconstruct from rows directly
    let running = 0;
    let peak = 0;
    return rows.map((r, i) => {
      const rv = Number(r.r_multiple ?? r.R_multiple ?? r.r) || 0;
      running += rv;
      peak = Math.max(peak, running);
      return {
        trade: i + 1,
        trade_id: r.trade_id ?? `T-${i + 1}`,
        equity_R: Number(running.toFixed(3)),
        drawdown_R: Number((running - peak).toFixed(3)),
      };
    });
  }, [curveData, rows]);

  // Max Drawdown in R
  const maxDrawdownR = useMemo(() => {
    if (!equityCurve.length) return 0;
    return Math.min(...equityCurve.map(p => p.drawdown_R));
  }, [equityCurve]);

  // R-Multiple Distribution Histogram Data
  const histogramData = useMemo(() => {
    const vals = summary.rValues.length > 0 ? summary.rValues : analyticsData?.values || [];
    return bucketRMultiples(vals);
  }, [summary.rValues, analyticsData]);

  // Win/Loss Donut Chart Data
  const winLossPie = useMemo(() => {
    return [
      { name: 'Wins', value: summary.wins, fill: '#22c55e' },
      { name: 'Losses', value: summary.losses, fill: '#ef4444' },
      { name: 'Breakeven', value: summary.be, fill: '#94a3b8' },
    ].filter(x => x.value > 0);
  }, [summary]);

  // Unique symbols for filtering
  const availableSymbols = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      const s = r.symbol || r.market;
      if (s) set.add(String(s));
    });
    return Array.from(set);
  }, [rows]);

  // Filtered Table Rows
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      const res = resultFromRow(r);
      if (resultFilter !== 'ALL' && res !== resultFilter) return false;

      const sym = String(r.symbol || r.market || '');
      if (symbolFilter !== 'ALL' && sym !== symbolFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const reason = String(r.exit_reason || '').toLowerCase();
        const id = String(r.trade_id || '').toLowerCase();
        if (!sym.toLowerCase().includes(q) && !reason.includes(q) && !id.includes(q)) return false;
      }

      return true;
    });
  }, [rows, resultFilter, symbolFilter, searchQuery]);

  // Save Reflection
  const handleSaveReflection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!journalNotes.trim()) return;

    const newRef: JournalReflection = {
      emotional_state: emotionalState,
      rule_followed: ruleFollowed,
      notes: journalNotes,
      created_at: new Date().toLocaleString(),
    };

    const updated = [newRef, ...reflections];
    setReflections(updated);
    localStorage.setItem('quanteinstein_journal_reflections', JSON.stringify(updated));

    // Post to API
    api('/journal/entry', {
      method: 'POST',
      body: JSON.stringify({
        job_id: selectedJob || null,
        emotional_state: emotionalState.toLowerCase(),
        manual_override: !ruleFollowed,
        entry_type: 'trade_review',
        note: journalNotes,
      }),
    }).catch(() => {});

    setJournalNotes('');
    showToast('Reflection logged in journal!');
  };

  // CSV Export
  const handleExportCSV = () => {
    if (!rows.length) return;
    const headers = ['Trade_ID', 'Symbol', 'Entry_Time', 'Entry_Price', 'Stop_Loss', 'Target_1', 'Target_2', 'Exit_Time', 'Exit_Price', 'Exit_Reason', 'Result', 'R_Multiple', 'Setup_Score'];
    const csvContent = [
      headers.join(','),
      ...rows.map(r => [
        r.trade_id ?? '',
        r.symbol ?? r.market ?? '',
        `"${r.entry_time ?? ''}"`,
        r.entry_price ?? '',
        r.stop_loss ?? r.stop ?? '',
        r.target1 ?? '',
        r.target2 ?? '',
        `"${r.exit_time ?? ''}"`,
        r.exit_price ?? '',
        `"${r.exit_reason ?? ''}"`,
        resultFromRow(r),
        r.r_multiple ?? r.R_multiple ?? r.r ?? '',
        r.setup_score_at_entry ?? r.setup_score ?? '',
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `quanteinstein_journal_${selectedJob || 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV Export downloaded successfully!');
  };

  const selectedJobObj = jobs.find(j => j.id === selectedJob);

  return (
    <main style={{ padding: '24px 24px 60px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 10,
            fontWeight: 700,
            boxShadow: '0 10px 25px rgba(16, 185, 129, 0.4)',
            zIndex: 9999,
          }}
        >
          <span>✓</span> {toastMessage}
        </div>
      )}

      {/* Header & Title */}
      <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span
              style={{
                background: 'rgba(99, 102, 241, 0.16)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                color: '#a5b4fc',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              📓 QUANT WORKSTATION
            </span>
            <span style={{ color: '#64748b', fontSize: 12 }}>• Unified Trade Journal & Analytics Suite</span>
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: '#f8fafc', letterSpacing: -0.5 }}>Trade Journal & Analytics</h1>
          <p className="muted" style={{ maxWidth: 840, fontSize: 14 }}>
            Unified execution ledger, timeseries equity curves, underwater drawdown analysis, R-multiple distributions, and trade-by-trade behavioral review.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={handleExportCSV}
            disabled={!rows.length}
            style={{
              background: rows.length ? '#1e293b' : '#0f172a',
              border: '1px solid #334155',
              color: rows.length ? '#f8fafc' : '#475569',
              padding: '9px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: rows.length ? 'pointer' : 'not-allowed',
            }}
          >
            <span>📥</span> Export CSV Ledger
          </button>
        </div>
      </section>

      {msg && <div style={dangerStyle}>{msg}</div>}

      {/* 🔍 Job / Report Selector Panel */}
      <section style={{ ...panelStyle, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={{ display: 'grid', gap: 6, color: '#94a3b8', fontSize: 13 }}>
              Select Backtest or Paper Session Report
              <select value={selectedJob} onChange={e => loadSession(e.target.value)} style={{ padding: '10px 14px', fontSize: 14, background: '#090e17' }}>
                <option value="">Choose a report session…</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {jobLabel(j)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#93c5fd', fontSize: 13, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1s infinite' }} />
              Loading session ledger & analytics curves…
            </div>
          )}
        </div>
      </section>

      {/* 📊 Executive KPI Summary Ribbon */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Kpi
          label="Total Trades"
          value={String(summary.total)}
          sublabel={selectedJobObj ? `${selectedJobObj.mode?.toUpperCase()} SESSION` : 'No session'}
        />

        <Kpi
          label="Win Rate"
          value={<span style={{ color: summary.winRate >= 50 ? '#86efac' : '#fca5a5' }}>{summary.winRate.toFixed(1)}%</span>}
          sublabel={
            <span>
              <strong style={{ color: '#86efac' }}>{summary.wins}W</strong> / <strong style={{ color: '#fca5a5' }}>{summary.losses}L</strong> / <strong>{summary.be}BE</strong>
            </span>
          }
        />

        <Kpi
          label="Gross R Return"
          value={<span style={signedStyle(summary.gross)}>{summary.gross > 0 ? `+${summary.gross.toFixed(2)}R` : `${summary.gross.toFixed(2)}R`}</span>}
          sublabel="Cumulative normalized R"
        />

        <Kpi
          label="Average Expectancy"
          value={<span style={signedStyle(summary.avgR)}>{summary.avgR > 0 ? `+${summary.avgR.toFixed(2)}R` : `${summary.avgR.toFixed(2)}R`}</span>}
          sublabel="Expectancy per trade"
        />

        <Kpi
          label="Profit Factor"
          value={<span style={{ color: summary.profitFactor >= 1.5 ? '#86efac' : summary.profitFactor >= 1.0 ? '#facc15' : '#fca5a5' }}>{summary.profitFactor.toFixed(2)}</span>}
          sublabel="Gross Wins / Gross Losses"
        />

        <Kpi
          label="Max Drawdown"
          value={<span style={{ color: '#fca5a5' }}>{maxDrawdownR.toFixed(2)}R</span>}
          sublabel="Peak-to-trough in R"
        />
      </section>

      {/* View Mode Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          background: '#090e17',
          padding: 6,
          borderRadius: 10,
          border: '1px solid #1e293b',
          marginBottom: 20,
          width: 'fit-content',
        }}
      >
        {[
          { id: 'ALL', label: '🌟 Unified Overview' },
          { id: 'CHARTS', label: '📈 Visual Analytics & Curves' },
          { id: 'LEDGER', label: '📋 Trade Ledger & Fills' },
          { id: 'BEHAVIOR', label: '🧠 Behavioral Journal' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              background: activeTab === tab.id ? '#6366f1' : 'transparent',
              color: activeTab === tab.id ? '#ffffff' : '#94a3b8',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 📈 Section 1: Visual Analytics & Performance Curves */}
      {(activeTab === 'ALL' || activeTab === 'CHARTS') && (
        <section style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📈</span> Performance & Analytics Curves
            </h2>
            <span style={{ color: '#64748b', fontSize: 12 }}>Cumulative R, Drawdown, Distribution & Win Ratio</span>
          </div>

          {!rows.length ? (
            <div className="card" style={{ textAlign: 'center', padding: '36px 20px', color: '#94a3b8' }}>
              Select a completed report to render performance analytics curves.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 16 }}>
              {/* Equity Curve in R */}
              <div style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 16, color: '#e2e8f0' }}>Cumulative Equity in R</h3>
                  <span style={{ fontSize: 12, fontWeight: 700, color: summary.gross >= 0 ? '#86efac' : '#fca5a5' }}>
                    Final: {summary.gross > 0 ? `+${summary.gross.toFixed(2)}R` : `${summary.gross.toFixed(2)}R`}
                  </span>
                </div>
                <div style={chartBox}>
                  <ResponsiveContainer>
                    <AreaChart data={equityCurve}>
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#0284c7" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                      <XAxis dataKey="trade" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(val: any) => [`${Number(val).toFixed(2)}R`, 'Equity']} labelFormatter={l => `Trade #${l}`} />
                      <Area type="monotone" dataKey="equity_R" stroke="#38bdf8" strokeWidth={2} fill="url(#eqGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Drawdown Curve in R */}
              <div style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 16, color: '#e2e8f0' }}>Underwater Drawdown in R</h3>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fca5a5' }}>
                    Max DD: {maxDrawdownR.toFixed(2)}R
                  </span>
                </div>
                <div style={chartBox}>
                  <ResponsiveContainer>
                    <AreaChart data={equityCurve}>
                      <defs>
                        <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#ea580c" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                      <XAxis dataKey="trade" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(val: any) => [`${Number(val).toFixed(2)}R`, 'Drawdown']} labelFormatter={l => `Trade #${l}`} />
                      <Area type="monotone" dataKey="drawdown_R" stroke="#f97316" strokeWidth={2} fill="url(#ddGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* R-Multiple Distribution Histogram */}
              <div style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 16, color: '#e2e8f0' }}>R-Multiple Distribution</h3>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>Expectancy Bucket Counts</span>
                </div>
                <div style={chartBox}>
                  <ResponsiveContainer>
                    <BarChart data={histogramData}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                      <XAxis dataKey="r" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {histogramData.map((h, i) => (
                          <Cell key={i} fill={h.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Wins vs Losses Donut */}
              <div style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 16, color: '#e2e8f0' }}>Win / Loss Composition</h3>
                  <span style={{ fontSize: 12, color: '#86efac', fontWeight: 700 }}>
                    {summary.winRate.toFixed(1)}% Win Rate
                  </span>
                </div>
                <div style={chartBox}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Pie data={winLossPie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={4} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {winLossPie.map((x, i) => (
                          <Cell key={i} fill={x.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 📋 Section 2: Detailed Trade Ledger & Execution Fills */}
      {(activeTab === 'ALL' || activeTab === 'LEDGER') && (
        <section style={{ ...panelStyle, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 20, color: '#f8fafc', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📋</span> Trade Execution Ledger
              </h2>
              <p style={{ color: '#94a3b8', fontSize: 13 }}>
                Complete verified trade fills: entry, targets, stops, exit price, reason, and R-multiple contribution.
              </p>
            </div>

            {/* Quick Filters */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={resultFilter}
                onChange={e => setResultFilter(e.target.value as any)}
                style={{ width: 'auto', padding: '6px 12px', fontSize: 12, height: 34, background: '#090e17' }}
              >
                <option value="ALL">All Results</option>
                <option value="WIN">🟢 Wins Only</option>
                <option value="LOSS">🔴 Losses Only</option>
                <option value="BREAKEVEN">⚪ Breakeven Only</option>
              </select>

              {availableSymbols.length > 1 && (
                <select
                  value={symbolFilter}
                  onChange={e => setSymbolFilter(e.target.value)}
                  style={{ width: 'auto', padding: '6px 12px', fontSize: 12, height: 34, background: '#090e17' }}
                >
                  <option value="ALL">All Symbols</option>
                  {availableSymbols.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}

              <input
                type="text"
                placeholder="Search trades, reasons..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ width: 180, padding: '6px 10px', fontSize: 12, height: 34, background: '#090e17' }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="pro-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['#', 'Symbol', 'Entry Time', 'Entry', 'Stop Loss', 'Target 1', 'Target 2', 'Exit Time', 'Exit', 'Exit Reason', 'Result', 'R-Multiple', 'Setup Score'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length ? (
                  filteredRows.map((r, i) => {
                    const result = resultFromRow(r);
                    const rv = r.r_multiple ?? r.R_multiple ?? r.r;
                    const reason = cleanupExitReason(r.exit_reason, rv);
                    return (
                      <tr key={i}>
                        <td style={{ color: '#64748b', fontSize: 12 }}>{r.trade_id ?? i + 1}</td>
                        <td style={{ color: '#93c5fd', fontWeight: 800 }}>{r.symbol || r.market || '-'}</td>
                        <td style={{ fontSize: 12 }}>{cleanTime(r.entry_time)}</td>
                        <td>{money(r.entry_price)}</td>
                        <td style={{ color: '#fca5a5' }}>{money(r.stop_loss ?? r.stop)}</td>
                        <td style={{ color: '#86efac' }}>{money(r.target1)}</td>
                        <td style={{ color: '#86efac' }}>{money(r.target2)}</td>
                        <td style={{ fontSize: 12 }}>{cleanTime(r.exit_time)}</td>
                        <td>{money(r.exit_price)}</td>
                        <td style={{ fontSize: 12 }}>{cleanReason(reason || r.exit_reason)}</td>
                        <td>
                          <span style={resultStyle(result)}>{result}</span>
                        </td>
                        <td>
                          <span style={signedStyle(rv)}>{rFmt(rv)}</span>
                        </td>
                        <td>
                          <span style={{ color: '#facc15', fontWeight: 700 }}>{r.setup_score_at_entry ?? r.setup_score ?? '-'}</span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={13} style={{ color: '#94a3b8', padding: 24, textAlign: 'center' }}>
                      {selectedJob ? 'No trades match the active filter criteria.' : 'Select a completed job above to view the trade ledger.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 🧠 Section 3: Behavioral Journal & Trader Reflections */}
      {(activeTab === 'ALL' || activeTab === 'BEHAVIOR') && (
        <section style={{ ...panelStyle }}>
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, color: '#f8fafc', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🧠</span> Behavioral Journal & Trader Reflections
            </h2>
            <p style={{ color: '#94a3b8', fontSize: 13 }}>
              Audit your emotional discipline, record manual overrides, and capture quantitative reflections to avoid cognitive biases.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
            {/* Form to log reflection */}
            <form onSubmit={handleSaveReflection} style={{ background: '#090e17', padding: 18, borderRadius: 12, border: '1px solid #1e293b' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 12 }}>Log Session Reflection</h3>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Emotional State</label>
                <select value={emotionalState} onChange={e => setEmotionalState(e.target.value)} style={{ fontSize: 13, background: '#111827' }}>
                  <option value="Calm & Disciplined">🟢 Calm & Disciplined</option>
                  <option value="Confident & Decisive">🔵 Confident & Decisive</option>
                  <option value="Anxious / Hesitant">🟡 Anxious / Hesitant</option>
                  <option value="Frustrated / Revenge Seeking">🔴 Frustrated / Revenge Seeking</option>
                  <option value="Impulsive / Overtrading">🟣 Impulsive / Overtrading</option>
                </select>
              </div>

              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="ruleFollowedCheck"
                  checked={ruleFollowed}
                  onChange={e => setRuleFollowed(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <label htmlFor="ruleFollowedCheck" style={{ fontSize: 13, color: '#e2e8f0', cursor: 'pointer' }}>
                  Strictly followed quantitative rules (zero discretionary overrides)
                </label>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Post-Trade Notes & Behavioral Audit
                </label>
                <textarea
                  rows={3}
                  placeholder="Did you let the targets run? Did you respect your stop loss? What did market structure teach you on this session?"
                  value={journalNotes}
                  onChange={e => setJournalNotes(e.target.value)}
                  required
                  style={{ fontSize: 13, background: '#111827' }}
                />
              </div>

              <button
                type="submit"
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  fontWeight: 700,
                  fontSize: 13,
                  padding: '9px 18px',
                }}
              >
                Save Behavioral Reflection
              </button>
            </form>

            {/* List of past reflections */}
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 12 }}>Recent Behavioral Reflections</h3>
              {reflections.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
                  {reflections.map((rf, idx) => (
                    <div key={idx} style={{ background: '#090e17', padding: 12, borderRadius: 8, border: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc' }}>{rf.emotional_state}</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{rf.created_at}</span>
                      </div>
                      <div style={{ fontSize: 11, color: rf.rule_followed ? '#86efac' : '#fca5a5', fontWeight: 600, marginBottom: 4 }}>
                        {rf.rule_followed ? '✓ Plan strictly followed' : '⚠ Rule override logged'}
                      </div>
                      <p style={{ color: '#cbd5e1', fontSize: 13, margin: 0 }}>{rf.notes}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#64748b', fontSize: 13, padding: 20, textAlign: 'center', background: '#090e17', borderRadius: 8 }}>
                  No behavioral reflections logged yet. Capture your session review above!
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function Kpi({ label, value, sublabel }: { label: string; value: any; sublabel?: any }) {
  return (
    <div style={panelStyle}>
      <div style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4, letterSpacing: '-0.02em' }}>{value}</div>
      {sublabel && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{sublabel}</div>}
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: '#111827',
  border: '1px solid #243044',
  borderRadius: 14,
  padding: 18,
};

const dangerStyle: CSSProperties = {
  ...panelStyle,
  borderColor: '#7f1d1d',
  background: '#2a1214',
  color: '#fecaca',
  marginBottom: 16,
};
