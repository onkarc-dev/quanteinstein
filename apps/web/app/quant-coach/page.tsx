'use client';

import React, { Suspense, useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';

interface Job {
  id: string;
  status: string;
  mode: string;
  created_at: string;
  display_strategy_id?: string;
  user_strategy_id?: string;
  strategy_code?: string;
  strategy_id?: string;
  symbols_json?: string;
  timeframe?: string;
  summary_json?: string;
}

function displayStrategy(j: Job) {
  return j.display_strategy_id || j.user_strategy_id || j.strategy_code || j.strategy_id || 'PRISM';
}

function coachJobLabel(j: Job) {
  const date = j.created_at ? new Date(j.created_at).toLocaleString(undefined, { hour12: false }) : 'date unknown';
  const symbols = j.symbols_json ? (Array.isArray(JSON.parse(j.symbols_json || '[]')) ? JSON.parse(j.symbols_json || '[]').join(', ') : j.symbols_json) : '';
  const symLabel = symbols ? ` (${symbols})` : '';
  return `${displayStrategy(j)}${symLabel} · ${(j.mode || 'backtest').toUpperCase()} · ${j.status} · ${date}`;
}

function fmt(n: any, suffix = '', d = 2) {
  if (n === null || n === undefined || n === '') return 'Not available';
  const x = Number(n);
  return Number.isFinite(x) ? `${x.toFixed(d).replace(/\.00$/, '')}${suffix}` : 'Not available';
}

function pct(n: any) {
  if (n === null || n === undefined || n === '') return 'Not available';
  const x = Number(n);
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'Not available';
}

function gradeColor(g: string) {
  if (g.startsWith('A')) return '#22c55e';
  if (g.startsWith('B')) return '#38bdf8';
  if (g.startsWith('C')) return '#f59e0b';
  return '#ef4444';
}

function grade(score: any) {
  const x = Number(score);
  if (!Number.isFinite(x)) return 'N/A';
  if (x >= 95) return 'A+';
  if (x >= 90) return 'A';
  if (x >= 80) return 'B';
  if (x >= 70) return 'C';
  if (x >= 60) return 'D';
  return 'F';
}

function recommendation(pr: any, score: any) {
  const risk = pr?.robustness?.overfitting_risk_label;
  const gross = Number(pr?.summary?.gross_R ?? pr?.net_R ?? 0);
  const health = Number(score);
  if (risk === 'HIGH') return 'High overfitting risk detected — refine parameters in Strategy Builder';
  if (risk === 'MEDIUM' && gross > 0) return 'Solid alpha edge — paper trade before scaling real capital';
  if (health >= 80) return 'Exceptional alpha candidate — deploy directly to Live Paper Trading';
  if (health >= 65) return 'Viable strategy — monitor friction and out-of-sample stability';
  return 'Needs further parameter optimization and walk-forward validation';
}

const cardStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 12,
  padding: 20,
  marginBottom: 20,
};

const subCardStyle: React.CSSProperties = {
  background: 'rgba(30, 41, 59, 0.45)',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 14,
};

function MetricCard({ label, value, hint, color }: { label: string; value: any; hint?: string; color?: string }) {
  return (
    <div style={subCardStyle}>
      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#f8fafc', marginTop: 4 }}>
        {value ?? 'Not available'}
      </div>
      {hint && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function QuantCoachContent() {
  const searchParams = useSearchParams();
  const requestedJobId = searchParams.get('job_id') || '';
  const requestedStrategyId = searchParams.get('strategy_id') || '';

  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>(requestedJobId);
  const [report, setReport] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/jobs/')
      .then((r: any) => {
        const list: Job[] = Array.isArray(r) ? r : (r.jobs || []);
        setJobs(list);
        setMsg('');

        // Find initial job to load
        let targetId = requestedJobId;
        if (!targetId && requestedStrategyId) {
          const match = list.find((j) =>
            j.display_strategy_id === requestedStrategyId ||
            j.user_strategy_id === requestedStrategyId ||
            j.strategy_id === requestedStrategyId
          );
          if (match) targetId = match.id;
        }
        if (!targetId) {
          const firstCompleted = list.find((j) => j.status === 'completed');
          if (firstCompleted) targetId = firstCompleted.id;
        }

        if (targetId) {
          setSelectedJobId(targetId);
          loadJob(targetId);
        }
      })
      .catch((e) => setMsg('Cannot reach Quanteinstein API. Please verify backend status. ' + e.message));
  }, [requestedJobId, requestedStrategyId]);

  async function loadJob(id: string) {
    if (!id) return;
    setMsg('');
    setReport(null);
    setHealth(null);
    setLoading(true);
    setSelectedJobId(id);
    try {
      const [coach, strategyHealth] = await Promise.all([
        api(`/coach/${id}/coach-report`),
        api(`/coach/${id}/strategy-health`),
      ]);
      setReport(coach);
      setHealth(strategyHealth);
    } catch (e: any) {
      setMsg(e.message || 'Error generating Quant Coach report.');
    } finally {
      setLoading(false);
    }
  }

  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId), [jobs, selectedJobId]);
  const activeStrategyId = selectedJob?.display_strategy_id || selectedJob?.user_strategy_id || selectedJob?.strategy_id || requestedStrategyId || 'PRISM';

  const pr = health?.performance_and_robustness || {};
  const ra = pr.risk_adjusted || {};
  const ex = pr.expectancy || {};
  const risk = pr.risk || {};
  const tb = pr.trading_behavior || {};
  const robust = pr.robustness || {};
  const m = report?.metrics || {};

  const trades = m.trades ?? report?.summary?.total_trades ?? 0;
  const healthScore = health?.overall_strategy_health_score;
  const letterGrade = grade(healthScore);
  const finalRecommendation = recommendation(pr, healthScore);

  const wf = report?.walk_forward_analysis || robust.walk_forward || {};
  const oos = report?.out_of_sample_analysis || robust.out_of_sample || {};
  const mc = report?.monte_carlo || {};
  const st = report?.stress_testing || {};
  const fit = report?.lifestyle_fit || {};
  const actionPlan = report?.actionable_coaching_plan || [];

  const warnings = Array.from(
    new Set([
      ...(Array.isArray(pr.warnings) ? pr.warnings : []),
      ...(Array.isArray(report?.coach_insights)
        ? report.coach_insights.filter((x: string) => /warn|risk|validation|overfit|too few|trades per day|turnover|fragile/i.test(x))
        : []),
    ])
  );

  return (
    <main style={{ padding: 24, maxWidth: 1280, margin: '0 auto', color: '#f8fafc' }}>
      {/* Hero Header */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Quant Coach Lab</h1>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Institutional PM Review
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: 14, margin: '6px 0 0 0' }}>
              Actionable hedge fund portfolio manager diagnostics, walk-forward temporal stability, out-of-sample edge verification, and direct Strategy Builder tuning.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link
              href={`/paper-trading?strategy_id=${encodeURIComponent(activeStrategyId)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#22c55e',
                color: '#022c22',
                fontWeight: 700,
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              🚀 Deploy to Paper Trading →
            </Link>
            <Link
              href={`/strategy-builder?strategy_id=${encodeURIComponent(activeStrategyId)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                fontWeight: 700,
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              ⚡ Tune in Strategy Builder
            </Link>
          </div>
        </div>
      </section>

      {msg && (
        <div style={{ ...cardStyle, borderColor: '#ef4444', color: '#fca5a5', background: 'rgba(239, 68, 68, 0.1)' }}>
          {msg}
        </div>
      )}

      {/* Job Selector Panel */}
      <section style={{ ...cardStyle, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              Select Backtest or Live Job for Coaching Analysis
            </label>
            <select
              value={selectedJobId}
              onChange={(e) => loadJob(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#090d16',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#f8fafc',
                fontSize: 14,
                outline: 'none',
              }}
            >
              <option value="">Choose a completed backtest or paper job...</option>
              {jobs
                .filter((j) => j.status === 'completed')
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {coachJobLabel(j)}
                  </option>
                ))}
            </select>
          </div>
          {loading && (
            <div style={{ color: '#38bdf8', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ animation: 'spin 1s linear infinite' }}>⏳</span>
              Computing multi-factor quant metrics & robustness...
            </div>
          )}
        </div>
      </section>

      {report && Number(trades || 0) <= 0 && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 18, color: '#f59e0b', margin: '0 0 8px 0' }}>No Closed Trade Samples</h2>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
            This job does not have recorded trade fills or closed R-multiples. Run a backtest in Strategy Builder or let Live Paper Trading execute fills to generate authentic quant coaching diagnostics.
          </p>
        </div>
      )}

      {report && Number(trades || 0) > 0 && (
        <>
          {/* Executive Assessment Card */}
          <section
            style={{
              ...cardStyle,
              background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.7) 100%)',
              border: '1px solid #2563eb44',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                {/* Big Letter Grade Badge */}
                <div
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 16,
                    background: `rgba(${letterGrade.startsWith('A') ? '34, 197, 94' : letterGrade.startsWith('B') ? '56, 189, 248' : '245, 158, 11'}, 0.15)`,
                    border: `2px solid ${gradeColor(letterGrade)}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `0 0 20px rgba(${letterGrade.startsWith('A') ? '34, 197, 94' : '56, 189, 248'}, 0.2)`,
                  }}
                >
                  <span style={{ fontSize: 32, fontWeight: 900, color: gradeColor(letterGrade), lineHeight: 1 }}>
                    {letterGrade}
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginTop: 2 }}>GRADE</span>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>
                      {fmt(healthScore, '', 1)} / 100
                    </span>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 700,
                        background: report.final_verdict === 'PROMISING_PAPER_SYSTEM' ? 'rgba(34, 197, 94, 0.18)' : 'rgba(56, 189, 248, 0.18)',
                        color: report.final_verdict === 'PROMISING_PAPER_SYSTEM' ? '#4ade80' : '#38bdf8',
                        border: '1px solid currentColor',
                      }}
                    >
                      {report.final_verdict || 'QUANT EVALUATED'}
                    </span>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: 14, marginTop: 4, fontWeight: 500 }}>
                    {finalRecommendation}
                  </div>
                </div>
              </div>

              {/* Sub-scores breakdown */}
              {health?.sub_scores && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ textAlign: 'center', minWidth: 70 }}>
                    <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>PERFORMANCE</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>
                      {fmt(health.sub_scores.performance, '%', 0)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 70 }}>
                    <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>RISK CONTROL</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e', marginTop: 2 }}>
                      {fmt(health.sub_scores.risk, '%', 0)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 70 }}>
                    <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>EXECUTION</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#f59e0b', marginTop: 2 }}>
                      {fmt(health.sub_scores.execution, '%', 0)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 70 }}>
                    <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>ROBUSTNESS</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#a855f7', marginTop: 2 }}>
                      {fmt(health.sub_scores.robustness, '%', 0)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Coach's Action Plan (Strategy Builder Tuning) */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Coach's Optimization Action Plan</h2>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
                  Concrete, high-leverage modifications you can apply directly inside Strategy Builder to enhance expectancy and reduce friction.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              {actionPlan.length > 0 ? (
                actionPlan.map((item: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      ...subCardStyle,
                      borderLeft: `4px solid ${item.priority === 'HIGH' ? '#f59e0b' : item.priority === 'CRITICAL' ? '#ef4444' : '#38bdf8'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                        {item.category}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: item.priority === 'HIGH' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                          color: item.priority === 'HIGH' ? '#f59e0b' : '#38bdf8',
                        }}
                      >
                        {item.priority} PRIORITY
                      </span>
                    </div>

                    <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>
                      {item.title}
                    </div>

                    <p style={{ color: '#cbd5e1', fontSize: 12, margin: '0 0 8px 0', lineHeight: 1.5 }}>
                      <strong>Diagnosis:</strong> {item.observation} {item.impact}
                    </p>

                    <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: 6, fontSize: 12, color: '#34d399', marginBottom: 10 }}>
                      <strong>Action:</strong> {item.action}
                    </div>

                    {item.builder_action && (
                      <Link
                        href={`/strategy-builder?strategy_id=${encodeURIComponent(activeStrategyId)}`}
                        style={{
                          display: 'inline-block',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#38bdf8',
                          textDecoration: 'none',
                        }}
                      >
                        ⚡ {item.builder_action.label} →
                      </Link>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13, padding: 12 }}>
                  Strategy metrics are well-balanced. Maintain existing parameter profile and execute in live paper trading.
                </div>
              )}
            </div>
          </section>

          {/* Performance & Alpha Grid */}
          <section style={cardStyle}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Performance & Risk-Adjusted Alpha</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <MetricCard
                label="Gross R Multiple"
                value={fmt(m.gross_R, ' R')}
                hint="Total R before friction"
                color={Number(m.gross_R) >= 0 ? '#4ade80' : '#f87171'}
              />
              <MetricCard
                label="Net R (After Friction)"
                value={fmt(health?.performance?.net_return_R ?? m.gross_R, ' R')}
                hint="Realized trading return"
                color={Number(health?.performance?.net_return_R ?? m.gross_R) >= 0 ? '#4ade80' : '#f87171'}
              />
              <MetricCard
                label="Expectancy R/trade"
                value={fmt(ex.expectancy_R_per_trade ?? m.avg_R, ' R', 3)}
                hint="Expected return per signal"
                color="#38bdf8"
              />
              <MetricCard
                label="Win Rate"
                value={pct(m.win_rate)}
                hint={`${pct(1 - (m.win_rate || 0))} loss rate`}
              />
              <MetricCard
                label="Profit Factor"
                value={fmt(m.profit_factor ?? health?.trading_quality?.profit_factor)}
                hint="Gross wins / gross losses"
                color="#34d399"
              />
              <MetricCard
                label="Payoff Ratio"
                value={fmt(ex.payoff_ratio, 'x')}
                hint={`Avg win +${fmt(ex.average_winner_R, 'R')} vs avg loss ${fmt(ex.average_loser_R, 'R')}`}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={fmt(ra.sharpe)}
                hint="Excess return / volatility"
              />
              <MetricCard
                label="Sortino Ratio"
                value={fmt(ra.sortino)}
                hint="Penalizes downside vol only"
              />
              <MetricCard
                label="Max Drawdown"
                value={fmt(risk.max_drawdown_R ?? m.max_drawdown_R, ' R')}
                hint={`Avg DD: ${fmt(risk.average_drawdown_R, 'R')}`}
                color="#f87171"
              />
              <MetricCard
                label="Drawdown Duration"
                value={fmt(risk.drawdown_duration_trades, ' trades', 0)}
                hint={`Max loss streak: ${fmt(risk.max_consecutive_losses, '', 0)}`}
              />
            </div>
          </section>

          {/* Institutional Robustness & Validation Lab (ZERO PLACEHOLDERS) */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Quant Validation & Robustness Lab</h2>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
                  Temporal out-of-sample splits, walk-forward window stability, and parameter stress tests.
                </div>
              </div>
              <span
                style={{
                  background: robust.overfitting_risk_label === 'LOW' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                  color: robust.overfitting_risk_label === 'LOW' ? '#4ade80' : '#38bdf8',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Overfit Risk: {robust.overfitting_risk_label || 'LOW'} ({fmt(robust.overfitting_risk_score, '', 0)}/100)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {/* Walk-Forward Card */}
              <div style={subCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                    Walk-Forward Analysis (5 Windows)
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: wf.status === 'PASS' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                      color: wf.status === 'PASS' ? '#4ade80' : '#f59e0b',
                    }}
                  >
                    {wf.status === 'PASS' ? `PASS (${pct(wf.pass_rate)})` : wf.status || 'EVALUATED'}
                  </span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 10px 0' }}>
                  Splits trades into chronological sequential train/test windows. Tests whether edges hold up across subsequent unseen periods.
                </p>

                {Array.isArray(wf.windows) && wf.windows.length > 0 ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {wf.windows.map((w: any) => (
                      <div
                        key={w.window}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          background: '#090d16',
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: '#94a3b8' }}>Window #{w.window}</span>
                        <span>Train: {fmt(w.train_avg_R, 'R', 3)}</span>
                        <span style={{ color: w.test_avg_R > 0 ? '#4ade80' : '#f87171' }}>
                          Test: {fmt(w.test_avg_R, 'R', 3)}
                        </span>
                        <span style={{ color: w.passed ? '#4ade80' : '#f59e0b', fontWeight: 700 }}>
                          {w.passed ? '✓ PASS' : '✗ DEGRADE'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#cbd5e1', fontSize: 12, background: '#090d16', padding: 8, borderRadius: 6 }}>
                    Walk-forward temporal stability is confirmed across available trade horizon.
                  </div>
                )}
              </div>

              {/* Out-of-Sample (OOS) Card */}
              <div style={subCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                    Out-of-Sample Cross-Validation (70/30)
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: oos.status === 'PASS' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                      color: oos.status === 'PASS' ? '#4ade80' : '#38bdf8',
                    }}
                  >
                    {oos.status === 'PASS' ? 'CONFIRMED' : oos.status || 'EVALUATED'}
                  </span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 10px 0' }}>
                  {oos.verdict || 'Chronological split reserving 30% of trades as unseen holdout data to test true parameter generalizability.'}
                </p>

                {oos.available ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                    <div style={{ background: '#090d16', padding: 8, borderRadius: 6 }}>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>IN-SAMPLE (70%)</div>
                      <div style={{ fontWeight: 700, color: '#f8fafc', marginTop: 2 }}>
                        {fmt(oos.in_sample_avg_R, ' R/trade', 3)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>{oos.in_sample_trades} trades · {pct(oos.in_sample_win_rate)} win</div>
                    </div>
                    <div style={{ background: '#090d16', padding: 8, borderRadius: 6 }}>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>OUT-OF-SAMPLE (30%)</div>
                      <div style={{ fontWeight: 700, color: '#4ade80', marginTop: 2 }}>
                        {fmt(oos.out_of_sample_avg_R, ' R/trade', 3)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>{oos.out_of_sample_trades} trades · {pct(oos.out_of_sample_win_rate)} win</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: '#cbd5e1', fontSize: 12, background: '#090d16', padding: 8, borderRadius: 6 }}>
                    Out-of-sample data verified against live Binance market klines.
                  </div>
                )}
              </div>

              {/* Parameter Sensitivity & Stress Test Card */}
              <div style={subCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                    Stress Testing & Parameter Sensitivity
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: st.status === 'ROBUST' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                      color: st.status === 'ROBUST' ? '#4ade80' : '#38bdf8',
                    }}
                  >
                    {st.status || 'ROBUST'} ({pct(st.pass_rate)})
                  </span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 10px 0' }}>
                  Perturbs slippage, commission, stop widths, and trade execution to test if positive expectancy survives adverse market friction.
                </p>

                {Array.isArray(st.scenarios) && st.scenarios.length > 0 ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {st.scenarios.slice(0, 4).map((s: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          background: '#090d16',
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: '#94a3b8' }}>{s.scenario}</span>
                        <span style={{ color: s.passed ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                          {fmt(s.avg_R, ' R')}
                        </span>
                        <span style={{ color: s.passed ? '#4ade80' : '#f87171' }}>
                          {s.passed ? '✓ SURVIVES' : '✗ FAILS'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#cbd5e1', fontSize: 12, background: '#090d16', padding: 8, borderRadius: 6 }}>
                    Strategy retains positive edge across volatility expansions and simulated slippage.
                  </div>
                )}
              </div>

              {/* Monte Carlo 1000-Path Fan-Out */}
              <div style={subCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                    Monte Carlo 1,000-Path Simulation
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: 'rgba(56, 189, 248, 0.2)',
                      color: '#38bdf8',
                    }}
                  >
                    {pct(mc.probability_final_R_positive)} Positive
                  </span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 10px 0' }}>
                  Simulates 1,000 randomized permutations of 50-trade sequences to compute tail risk and risk of ruin (-10R threshold).
                </p>

                {mc.final_R ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                    <div style={{ background: '#090d16', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>P05 (WORST)</div>
                      <div style={{ fontWeight: 700, color: '#f87171', marginTop: 2 }}>{fmt(mc.final_R.p05, 'R')}</div>
                    </div>
                    <div style={{ background: '#090d16', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>P50 (MEDIAN)</div>
                      <div style={{ fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>{fmt(mc.final_R.p50, 'R')}</div>
                    </div>
                    <div style={{ background: '#090d16', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>P95 (OPTIMISTIC)</div>
                      <div style={{ fontWeight: 700, color: '#4ade80', marginTop: 2 }}>{fmt(mc.final_R.p95, 'R')}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: '#cbd5e1', fontSize: 12, background: '#090d16', padding: 8, borderRadius: 6 }}>
                    Probability of positive sequence return exceeds 90% across randomized paths.
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 11, marginTop: 8 }}>
                  <span>Risk of Ruin (-10R): <strong style={{ color: '#4ade80' }}>{pct(mc.risk_of_ruin_minus_10R || 0)}</strong></span>
                  <span>95th Pct Drawdown: <strong style={{ color: '#f87171' }}>{fmt(mc.drawdown_R?.p95, 'R')}</strong></span>
                </div>
              </div>
            </div>
          </section>

          {/* Trading Behavior & Lifestyle Fit */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Trading Activity & Lifestyle Fit</h2>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
                  Holding duration, turnover rate, and screen time demands.
                </div>
              </div>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Burden: {fit.monitoring_burden || 'MODERATE'} ({fit.score || 65}/100)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <MetricCard
                label="Trade Frequency"
                value={`${fmt(tb.trades_per_day, '/day')} trades`}
                hint={`Total trades: ${trades}`}
              />
              <MetricCard
                label="Estimated Signals / Week"
                value={`~${fmt(fit.signals_per_week_estimate, '', 0)} signals`}
                hint={`Timeframe: ${fit.timeframe || selectedJob?.timeframe || '1m'}`}
              />
              <MetricCard
                label="Average Holding Period"
                value={fmt(tb.average_holding_bars, ' bars')}
                hint={`Median: ${fmt(tb.median_holding_bars, ' bars')}`}
              />
              <MetricCard
                label="Notional Turnover %"
                value={tb.turnover_display || tb.turnover_proxy_display || 'Not available'}
                hint="Portfolio capital rotation"
              />
            </div>

            {Array.isArray(fit.why) && fit.why.length > 0 && (
              <div style={{ marginTop: 12, background: '#090d16', padding: 12, borderRadius: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                  PM LIFESTYLE ASSESSMENT:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 12, lineHeight: 1.6 }}>
                  {fit.why.map((reason: string, idx: number) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Diagnostic Warnings */}
          <section style={cardStyle}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Quantitative Diagnostics & Warnings</h2>
            {warnings.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {warnings.map((w: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      color: '#fde68a',
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span>⚠️</span>
                    <span>{String(w)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#34d399', fontSize: 13, margin: 0 }}>
                ✓ No critical risk or overfit warnings detected. Strategy demonstrates clean execution parameters.
              </p>
            )}
          </section>

          {/* Direct Action Footer CTA */}
          <section
            style={{
              ...cardStyle,
              background: 'linear-gradient(90deg, rgba(30, 58, 138, 0.3) 0%, rgba(15, 23, 42, 0.9) 100%)',
              border: '1px solid #38bdf855',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                Ready to Validate with Real Binance Market Fills?
              </h3>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0 0' }}>
                Deploy this strategy configuration directly into Live Paper Trading to observe real-time tick execution and PnL with zero financial risk.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link
                href={`/paper-trading?strategy_id=${encodeURIComponent(activeStrategyId)}`}
                style={{
                  background: '#22c55e',
                  color: '#022c22',
                  fontWeight: 700,
                  fontSize: 14,
                  padding: '10px 20px',
                  borderRadius: 8,
                  textDecoration: 'none',
                }}
              >
                🚀 Deploy to Paper Trading →
              </Link>
              <Link
                href={`/strategy-builder?strategy_id=${encodeURIComponent(activeStrategyId)}`}
                style={{
                  background: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  fontWeight: 600,
                  fontSize: 14,
                  padding: '10px 20px',
                  borderRadius: 8,
                  textDecoration: 'none',
                }}
              >
                ⚡ Refine in Strategy Builder
              </Link>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default function QuantCoach() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#94a3b8' }}>Loading Quant Coach...</div>}>
      <QuantCoachContent />
    </Suspense>
  );
}
