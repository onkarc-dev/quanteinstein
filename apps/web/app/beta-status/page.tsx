const items = [
  {
    title: 'Lightweight Charts',
    status: 'Active',
    tone: 'green',
    detail: 'The shared TradingChart component uses the official lightweight-charts package.',
  },
  {
    title: 'CSV Upload Backtest',
    status: 'Available',
    tone: 'green',
    detail: 'Backtests can be run from uploaded OHLCV CSV files and stored with result exports.',
  },
  {
    title: 'Strategy Health Score',
    status: 'Available',
    tone: 'green',
    detail: 'Quant Coach exposes the 0-100 strategy health score with sub-scores and warnings.',
  },
  {
    title: 'AI Explainer Fallback',
    status: 'Available',
    tone: 'green',
    detail: 'Backtest explanations work deterministically when no external AI key is configured.',
  },
  {
    title: 'Local Engine Bridge',
    status: 'Available',
    tone: 'green',
    detail: 'Engine token, heartbeat, and status routes are available for local paper/backtest telemetry.',
  },
  {
    title: 'Binance Public Adapter',
    status: 'Foundation',
    tone: 'blue',
    detail: 'The adapter exposes the public trade WebSocket URL and parser foundation; a full socket loop is not claimed here.',
  },
  {
    title: 'Real-money Trading',
    status: 'Disabled',
    tone: 'white',
    detail: 'Quanteinstein remains paper trading and backtesting only. Broker execution is intentionally unavailable.',
  },
];

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const cls = tone === 'green' ? 'pill pill-green' : tone === 'blue' ? 'pill pill-blue' : 'pill pill-white';
  return <span className={cls}>{children}</span>;
}

export default function BetaStatusPage() {
  return (
    <>
      <div className="hero">
        <h1>Beta Status</h1>
        <p className="muted">Current local beta readiness signals for the Quanteinstein paper/backtest platform.</p>
      </div>
      <section className="card">
        <div className="row">
          {items.map(item => (
            <article key={item.title} className="kpi-card">
              <div style={{display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center'}}>
                <h2 style={{fontSize: 18, lineHeight: 1.2}}>{item.title}</h2>
                <Pill tone={item.tone}>{item.status}</Pill>
              </div>
              <p className="muted" style={{fontSize: 13, marginTop: 12}}>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="card">
        <h2 style={{fontSize: 20, marginBottom: 8}}>Local Verification</h2>
        <div className="grid">
          <div>
            <div className="kpi-label">Frontend</div>
            <div className="metric">Buildable</div>
          </div>
          <div>
            <div className="kpi-label">Backend Tests</div>
            <div className="metric">85 Passed</div>
          </div>
          <div>
            <div className="kpi-label">C++ Tests</div>
            <div className="metric">6 / 6</div>
          </div>
          <div>
            <div className="kpi-label">Smoke Flow</div>
            <div className="metric">Passed</div>
          </div>
        </div>
      </section>
    </>
  );
}
