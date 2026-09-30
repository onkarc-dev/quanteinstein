'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Job { id: string; status: string; mode: string; created_at: string; display_strategy_id?: string; user_strategy_id?: string; strategy_code?: string; strategy_id?: string; symbols_json?: string; timeframe?: string; }

function displayStrategy(j: Job) {
  return j.display_strategy_id || j.user_strategy_id || j.strategy_code || j.strategy_id || 'STRATEGY';
}
function coachJobLabel(j: Job) {
  const date = j.created_at ? new Date(j.created_at).toLocaleString(undefined, { hour12: false }) : 'date unknown';
  return `${displayStrategy(j)} - ${(j.mode || 'job').toUpperCase()} - ${j.status} - ${date}`;
}
function fmt(n: any, suffix = '', d = 2) {
  if (n === null || n === undefined || n === '') return 'Not enough data';
  const x = Number(n);
  return Number.isFinite(x) ? `${x.toFixed(d).replace(/\.00$/, '')}${suffix}` : 'Not enough data';
}
function pct(n: any) {
  if (n === null || n === undefined || n === '') return 'Not enough data';
  const x = Number(n);
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'Not enough data';
}
function grade(score: any) {
  const x = Number(score);
  if (!Number.isFinite(x)) return 'Not enough data';
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
  if (risk === 'HIGH') return 'Avoid live deployment';
  if (risk === 'MEDIUM' && gross > 0) return 'Promising but overfit risk exists';
  if (!pr?.robustness?.out_of_sample?.available || !pr?.robustness?.walk_forward?.available) return 'Needs more out-of-sample validation';
  if (health >= 80) return 'Excellent candidate for paper trading';
  return 'Needs more out-of-sample validation';
}

function Metric({ label, value }: { label: string; value: any }) {
  return <div className="card" style={{ margin: 0 }}><div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div><div className="metric" style={{ marginTop: 6 }}>{value ?? 'Not enough data'}</div></div>;
}
function Section({ title, children }: { title: string; children: any }) {
  return <div className="card"><h2>{title}</h2><div className="grid" style={{ marginTop: 12 }}>{children}</div></div>;
}

export default function QuantCoach() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [report, setReport] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/jobs/').then((r:any) => { setJobs(Array.isArray(r) ? r : (r.jobs || [])); setMsg(''); }).catch(e => setMsg('Cannot reach Quanteinstein API. Start the backend and refresh. Details: ' + e.message));
  }, []);

  async function load(id: string) {
    if (!id) return;
    setMsg(''); setReport(null); setHealth(null); setLoading(true);
    try {
      const [coach, strategyHealth] = await Promise.all([
        api(`/coach/${id}/coach-report`),
        api(`/coach/${id}/strategy-health`),
      ]);
      setReport(coach);
      setHealth(strategyHealth);
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  const pr = health?.performance_and_robustness || {};
  const ra = pr.risk_adjusted || {};
  const ex = pr.expectancy || {};
  const risk = pr.risk || {};
  const tb = pr.trading_behavior || {};
  const robust = pr.robustness || {};
  const m = report?.metrics || {};
  const warnings = Array.from(new Set([...(Array.isArray(pr.warnings) ? pr.warnings : []), ...(Array.isArray(report?.coach_insights) ? report.coach_insights.filter((x:string)=>/warn|risk|validation|overfit|too few|trades per day|turnover/i.test(x)) : [])]));
  const trades = m.trades ?? report?.summary?.total_trades ?? 0;
  const healthScore = health?.overall_strategy_health_score;
  const finalRecommendation = recommendation(pr, healthScore);

  return <div style={{ padding: 24 }}>
    <div className="hero"><h1>Quant Coach Report</h1><p className="muted">Professional performance, risk, trading behavior, and robustness diagnostics for completed Quanteinstein jobs.</p></div>
    {msg && <div className="card" style={{ borderColor: '#7f1d1d', color: '#f87171' }}>{msg}</div>}
    <div className="card">
      <h2>Select Completed Job</h2>
      <select onChange={e => load(e.target.value)} defaultValue="">
        <option value="">Choose a completed backtest or paper job...</option>
        {jobs.filter(j => j.status === 'completed').map(j => <option key={j.id} value={j.id}>{coachJobLabel(j)}</option>)}
      </select>
      {loading && <p className="muted">Generating report...</p>}
    </div>
    {report && Number(trades || 0) <= 0 && <div className="card"><h2>Not enough data</h2><p className="muted">This job has no closed trade R-multiples, so Quant Coach cannot calculate professional metrics honestly.</p></div>}
    {report && Number(trades || 0) > 0 && <>
      <Section title="Strategy Verdict">
        <Metric label="Overall Grade" value={grade(healthScore)} />
        <Metric label="Strategy Health Score" value={fmt(healthScore, '', 1)} />
        <Metric label="Verdict" value={report.final_verdict || 'Not enough data'} />
        <Metric label="Recommendation" value={finalRecommendation} />
      </Section>
      <Section title="Performance">
        <Metric label="Gross R" value={fmt(m.gross_R, 'R')} />
        <Metric label="Net R" value={fmt(health?.performance?.net_return_R ?? m.gross_R, 'R')} />
        <Metric label="Expectancy R/trade" value={fmt(ex.expectancy_R_per_trade ?? m.avg_R, 'R', 3)} />
        <Metric label="Win Rate" value={pct(m.win_rate)} />
        <Metric label="Profit Factor" value={fmt(m.profit_factor ?? health?.trading_quality?.profit_factor)} />
        <Metric label="Avg Winner" value={fmt(ex.average_winner_R, 'R')} />
        <Metric label="Avg Loser" value={fmt(ex.average_loser_R, 'R')} />
        <Metric label="Largest Winner" value={fmt(ex.largest_winner_R, 'R')} />
        <Metric label="Largest Loser" value={fmt(ex.largest_loser_R, 'R')} />
        <Metric label="Payoff Ratio" value={fmt(ex.payoff_ratio)} />
      </Section>
      <Section title="Risk-adjusted Metrics">
        <Metric label="Sharpe" value={fmt(ra.sharpe)} />
        <Metric label="Sortino" value={fmt(ra.sortino)} />
        <Metric label="Calmar" value={fmt(ra.calmar)} />
        <Metric label="Omega" value={fmt(ra.omega)} />
        <Metric label="Recovery Factor" value={fmt(ra.recovery_factor)} />
      </Section>
      <Section title="Drawdown & Risk">
        <Metric label="Max Drawdown" value={fmt(risk.max_drawdown_R ?? m.max_drawdown_R, 'R')} />
        <Metric label="Average Drawdown" value={fmt(risk.average_drawdown_R, 'R')} />
        <Metric label="Drawdown Duration" value={fmt(risk.drawdown_duration_trades, ' trades', 0)} />
        <Metric label="Ulcer Index" value={fmt(risk.ulcer_index)} />
        <Metric label="Max Win Streak" value={fmt(risk.max_consecutive_wins, '', 0)} />
        <Metric label="Max Loss Streak" value={fmt(risk.max_consecutive_losses, '', 0)} />
      </Section>
      <Section title="Trading Behaviour">
        <Metric label="Trades" value={fmt(trades, '', 0)} />
        <Metric label="Trades/day" value={fmt(tb.trades_per_day)} />
        <Metric label="Real Notional Turnover %" value={tb.turnover_display || 'Not enough data'} />
        <Metric label="Estimated Turnover Proxy %" value={tb.turnover_proxy_display || 'Not enough data'} />
        <Metric label="Exposure %" value={tb.exposure_display || 'Not enough data'} />
        <Metric label="Average Holding" value={fmt(tb.average_holding_bars, ' bars')} />
        <Metric label="Median Holding" value={fmt(tb.median_holding_bars, ' bars')} />
      </Section>
      <Section title="Robustness">
        <Metric label="Overfitting Risk" value={robust.overfitting_risk_label || 'Not enough data'} />
        <Metric label="Overfitting Risk Score" value={fmt(robust.overfitting_risk_score, '', 0)} />
        <Metric label="Trade Count Sufficiency" value={robust.trade_count_sufficiency_warning ? 'Too few trades' : 'Sufficient'} />
        <Metric label="Walk-forward Status" value={robust.walk_forward?.available ? 'Available' : 'Placeholder: not implemented'} />
        <Metric label="Out-of-sample Status" value={robust.out_of_sample?.available ? 'Available' : 'Placeholder: not implemented'} />
        <Metric label="Parameter Sensitivity" value={robust.parameter_sensitivity ? 'Available' : 'Placeholder: not implemented'} />
      </Section>
      <div className="card"><h2>Warnings</h2>{warnings.length ? <ul className="muted" style={{ lineHeight: 1.7 }}>{warnings.map((w:any)=><li key={String(w)}>{String(w)}</li>)}</ul> : <p className="muted">No warnings from available data.</p>}</div>
      <div className="card"><h2>Final Recommendation</h2><div className="metric">{finalRecommendation}</div><p className="muted">Quant Coach is research analytics only. Keep this in paper trading and backtesting until validation is stronger.</p></div>
    </>}
  </div>;
}
