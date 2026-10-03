"use client";
import { useEffect, useMemo, useState } from "react";
import { api, getUser } from "../../lib/api";

type Cfg = {
  strategyCode: string;
  symbols: string[];
  timeframe: string;
  lookback: number;
  retest: number;
  score: number;
  stop: string;
  atr: number;
  t1: number;
  t2: number;
  risk: number;
  ttl: number;
  reentry: string;
  maxRetest: number;
  cooldown: number;
  maxReentries: number;
  reentryCooldown: number;
  maxDailyLoss: number;
  maxOpen: number;
  trendFilter: string;
  trendTimeframe: string;
  trendFastEma: number;
  trendSlowEma: number;
};

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function startIso() {
  const d = new Date();
  d.setDate(d.getDate() - 15);
  return d.toISOString().slice(0, 10);
}
function rangeStart(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const RANGE_PRESETS = [
  ["Last day", 1],
  ["Last week", 7],
  ["Last 15 days", 15],
  ["Last 30 days", 30],
  ["Last 45 days", 45],
  ["Last 60 days", 60],
  ["Last 90 days", 90],
  ["Last 180 days", 180],
  ["Last 1 year", 365],
] as const;
const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "TRXUSDT",
];
const TIMEFRAMES = ["1s", "5s", "10s", "15s", "30s", "1m", "5m", "15m", "1h"];
function timeframeToSeconds(tf: string) {
  const m = tf.match(/^(\d+)([smh])$/);
  if (!m) return 60;
  const n = Number(m[1]);
  return m[2] === "s" ? n : m[2] === "m" ? n * 60 : n * 3600;
}
function fmt(n: any, d = 2) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x.toFixed(d).replace(/\.00$/, "") : "0";
}
function metric(n: any, suffix = "", d = 2) {
  if (n === null || n === undefined || n === "") return "Not enough data";
  const x = Number(n);
  return Number.isFinite(x) ? `${x.toFixed(d).replace(/\.00$/, "")}${suffix}` : "Not enough data";
}
function pct(n: any) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "0%";
}
function signedClass(n: any) {
  const x = Number(n ?? 0);
  return x > 0 ? "#86efac" : x < 0 ? "#fca5a5" : "#e5e7eb";
}

export default function StrategyBuilder() {
  const [cfg, setCfg] = useState<Cfg>({
    strategyCode: "PRISM_BREAKOUT_RETEST",
    symbols: ["BTCUSDT"],
    timeframe: "1m",
    lookback: 20,
    retest: 0.001,
    score: 6.5,
    stop: "atr_or_structure",
    atr: 0.75,
    t1: 1.5,
    t2: 2.5,
    risk: 1,
    ttl: 40,
    reentry: "enabled",
    maxRetest: 30,
    cooldown: 5,
    maxReentries: 1,
    reentryCooldown: 15,
    maxDailyLoss: 3,
    maxOpen: 5,
    trendFilter: "enabled",
    trendTimeframe: "5m",
    trendFastEma: 20,
    trendSlowEma: 50,
  });
  const [strategyId, setStrategyId] = useState("");
  const [job, setJob] = useState<any>(null);
  const [pollJob, setPollJob] = useState<any>(null);
  const [msg, setMsg] = useState(
    "Login first, then save a strategy and run a backtest.",
  );
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState("");
  const [startDate, setStartDate] = useState(startIso());
  const [endDate, setEndDate] = useState(yesterdayIso());
  const heavyLowTimeframe = cfg.symbols.length > 3 && timeframeToSeconds(cfg.timeframe) <= 5;

  useEffect(() => {
    api('/health').catch(() => {});
  }, []);

  function upd(k: keyof Cfg, v: any) {
    setCfg({ ...cfg, [k]: v });
  }
  function toggleSymbol(sym: string) {
    const set = new Set(cfg.symbols);
    set.has(sym) ? set.delete(sym) : set.add(sym);
    const next = [...set];
    upd("symbols", next.length ? next : ["BTCUSDT"]);
  }
  function selectAllSymbols() {
    upd("symbols", [...SYMBOLS]);
  }
  function clearSymbols() {
    upd("symbols", ["BTCUSDT"]);
  }

  const payload = useMemo(
    () => ({
      user_strategy_id: cfg.strategyCode.trim() || "PRISM_BREAKOUT_RETEST",
      name: "Quanteinstein Breakout Retest",
      symbols: cfg.symbols.map((s) => s.toUpperCase()),
      timeframe: cfg.timeframe,
      bar_seconds: timeframeToSeconds(cfg.timeframe),
      strategy: {
        name: "Quanteinstein Breakout Retest",
        breakout_lookback: cfg.lookback,
        retest_tolerance_pct: Number(cfg.retest),
        min_setup_score: cfg.score,
        max_retest_bars: cfg.maxRetest,
        signal_cooldown_bars: cfg.cooldown,
        ttl_bars: cfg.ttl,
        min_close_position: 0.5,
        stop_loss: {
          type: cfg.stop,
          atr_multiplier: cfg.atr,
          structure_buffer_pct: 0.25,
        },
        targets: { target1_R: cfg.t1, target2_R: cfg.t2 },
        risk: {
          risk_per_trade_pct: cfg.risk,
          max_daily_loss_pct: cfg.maxDailyLoss,
          max_open_positions: cfg.maxOpen,
          max_symbol_notional: 10000,
        },
        reentry: {
          enabled: cfg.reentry === "enabled",
          max_reentries: cfg.maxReentries,
          cooldown_bars: cfg.reentryCooldown,
        },
        trend_filter: {
          use_trend_filter: cfg.trendFilter === "enabled",
          higher_timeframe: cfg.trendTimeframe,
          higher_timeframe_seconds: timeframeToSeconds(cfg.trendTimeframe),
          fast_ema: cfg.trendFastEma,
          slow_ema: cfg.trendSlowEma,
        },
      },
    }),
    [cfg],
  );

  async function save() {
    try {
      setMsg("Saving strategy...");
      const r: any = await api("/strategies", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setStrategyId(r.strategy_id || r.id);
      setMsg(
        "Strategy saved: " + (r.user_strategy_id || r.strategy_id || r.id),
      );
    } catch (e: any) {
      const message = e?.message || "Save failed";
      if (message.toLowerCase().includes("already used")) alert(message);
      setMsg("Save failed: " + message);
    }
  }
  async function poll(jobId: string) {
    for (let i = 0; i < 20; i++) {
      const j: any = await api(`/jobs/${jobId}`);
      setPollJob(j);
      const total = payload.symbols.length;
      if (total > 1) {
        setRunProgress(
          `Running selected basket (${total} symbols). Backend progress is job-level, so per-symbol completions will appear when the report finishes. Poll ${i + 1} / 20.`,
        );
      }
      if (j.status === "completed" || j.status === "failed") return j;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }
  async function run() {
    if (running) return;
    const selectedSymbols = payload.symbols;
    try {
      setRunning(true);
      setRunProgress(
        selectedSymbols.length > 1
          ? `Running multi-symbol backtest. This may take longer. Completed 0 / ${selectedSymbols.length} selected symbols.`
          : `Running ${selectedSymbols[0] || "selected symbol"}...`,
      );
      setMsg("Submitting backtest...");
      setJob(null);
      setPollJob(null);
      let sid = strategyId;
      if (!sid) {
        const s: any = await api("/strategies", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        sid = s.strategy_id || s.id;
        setStrategyId(sid);
      }
      const r: any = await api("/jobs/submit-backtest", {
        method: "POST",
        body: JSON.stringify({
          strategy_id: sid,
          symbols: payload.symbols,
          timeframe: payload.timeframe,
          start_date: startDate,
          end_date: endDate || yesterdayIso(),
          config: payload.strategy,
        }),
      });
      setJob(r);
      localStorage.setItem(
        "prismflow_last_job",
        JSON.stringify({ job_id: r.job_id, user_id: getUser()?.id }),
      );
      setMsg(
        `${r.status === "completed" ? "Backtest completed" : "Backtest submitted"}. Job: ${r.job_id}`,
      );
      if (selectedSymbols.length > 1 && r.status === "completed") {
        setRunProgress(`Completed ${selectedSymbols.length} / ${selectedSymbols.length} selected symbols.`);
      }
      if (r.job_id && r.status !== "completed" && r.status !== "failed") {
        setMsg("Backtest queued. Polling job status...");
        const finalJob = await poll(r.job_id);
        if (finalJob) {
          setMsg(`Backtest ${finalJob.status}. Job: ${r.job_id}`);
          if (selectedSymbols.length > 1 && finalJob.status === "completed") {
            setRunProgress(`Completed ${selectedSymbols.length} / ${selectedSymbols.length} selected symbols.`);
          }
        } else {
          setRunProgress("Still waiting on the backend. Refresh Backtests for final status if this request times out.");
        }
      } else if (r.status === "failed")
        setMsg(
          "Backtest failed: " + (r.error || r.error_message || "Unknown error"),
        );
    } catch (e: any) {
      setMsg("Backtest failed: " + e.message);
      setRunProgress("Backtest request failed before completion.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="hero">
        <h1>Strategy Builder</h1>
        <p className="muted">
          Create user-defined PRISM strategies, choose one or many Binance paper
          markets, then run cached real-data backtests.
        </p>
      </div>
      <div className="card">
        <div className="row">
          <label>
            Strategy ID
            <input
              value={cfg.strategyCode}
              onChange={(e) => upd("strategyCode", e.target.value)}
              placeholder="PRISM_BREAKOUT_RETEST"
            />
          </label>
          <label>
            Timeframe
            <select
              value={cfg.timeframe}
              onChange={(e) => upd("timeframe", e.target.value)}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf}>{tf}</option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              Live bars use {timeframeToSeconds(cfg.timeframe)} second candles.
            </span>
          </label>
          <label>
            Breakout Lookback
            <input
              type="number"
              value={cfg.lookback}
              onChange={(e) => upd("lookback", +e.target.value)}
            />
          </label>
          <label>
            Min Setup Score
            <input
              type="number"
              step="0.1"
              value={cfg.score}
              onChange={(e) => upd("score", +e.target.value)}
            />
          </label>
          <label>
            5m EMA Trend Filter
            <select
              value={cfg.trendFilter}
              onChange={(e) => upd("trendFilter", e.target.value)}
            >
              <option>enabled</option>
              <option>disabled</option>
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              Long entries require higher-timeframe EMA fast above EMA slow.
            </span>
          </label>
        </div>
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <b>Symbols for backtest/live paper</b>
            <div>
              <button type="button" onClick={selectAllSymbols}>
                Select all 10
              </button>{" "}
              <button
                type="button"
                className="secondary"
                onClick={clearSymbols}
              >
                BTC only
              </button>
            </div>
          </div>
          <div className="symbol-picker">
            {SYMBOLS.map((sym) => (
              <label key={sym} className="symbol-chip">
                <input
                  type="checkbox"
                  checked={cfg.symbols.includes(sym)}
                  onChange={() => toggleSymbol(sym)}
                />
                <span>{sym}</span>
              </label>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Selected: {cfg.symbols.join(", ")}. Backtest runs the selected
            market set; live paper can activate one, many, or all selected
            symbols.
          </p>
          {heavyLowTimeframe && (
            <p style={{ color: "#fbbf24", fontSize: 12, marginTop: 8 }}>
              Multi-symbol low-timeframe backtests are heavy. Prefer local backend or fewer symbols.
            </p>
          )}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <label>
            Retest Tolerance
            <input
              type="number"
              step="0.0001"
              value={cfg.retest}
              onChange={(e) => upd("retest", +e.target.value)}
            />
          </label>
          <label>
            Stop-Loss Type
            <select
              value={cfg.stop}
              onChange={(e) => upd("stop", e.target.value)}
            >
              <option>atr_or_structure</option>
              <option>atr</option>
              <option>structure</option>
            </select>
          </label>
          <label>
            ATR Multiplier
            <input
              type="number"
              step="0.05"
              value={cfg.atr}
              onChange={(e) => upd("atr", +e.target.value)}
            />
          </label>
          <label>
            Target 1 R
            <input
              type="number"
              step="0.1"
              value={cfg.t1}
              onChange={(e) => upd("t1", +e.target.value)}
            />
          </label>
          <label>
            Target 2 R
            <input
              type="number"
              step="0.1"
              value={cfg.t2}
              onChange={(e) => upd("t2", +e.target.value)}
            />
          </label>
          <label>
            Risk Per Trade %
            <input
              type="number"
              step="0.1"
              value={cfg.risk}
              onChange={(e) => upd("risk", +e.target.value)}
            />
          </label>
          <label>
            TTL Bars
            <input
              type="number"
              value={cfg.ttl}
              onChange={(e) => upd("ttl", +e.target.value)}
            />
          </label>
          <label>
            Re-entry
            <select
              value={cfg.reentry}
              onChange={(e) => upd("reentry", e.target.value)}
            >
              <option>enabled</option>
              <option>disabled</option>
            </select>
          </label>
          <label>
            Max Re-entries
            <input
              type="number"
              min="0"
              step="1"
              value={cfg.maxReentries}
              disabled={cfg.reentry !== "enabled"}
              onChange={(e) => upd("maxReentries", Math.max(0, +e.target.value))}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Limits repeated entries after a failed or expired setup.
            </span>
          </label>
          <label>
            Re-entry Cooldown Bars
            <input
              type="number"
              min="0"
              step="1"
              value={cfg.reentryCooldown}
              disabled={cfg.reentry !== "enabled"}
              onChange={(e) => upd("reentryCooldown", Math.max(0, +e.target.value))}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Waits {cfg.reentryCooldown} bars after a setup/trade before re-entry.
            </span>
          </label>
          <label>
            Trend Timeframe
            <select
              value={cfg.trendTimeframe}
              disabled={cfg.trendFilter !== "enabled"}
              onChange={(e) => upd("trendTimeframe", e.target.value)}
            >
              {TIMEFRAMES.filter((tf) => timeframeToSeconds(tf) >= timeframeToSeconds(cfg.timeframe)).map((tf) => (
                <option key={tf}>{tf}</option>
              ))}
            </select>
          </label>
          <label>
            Fast EMA
            <input
              type="number"
              min="1"
              step="1"
              value={cfg.trendFastEma}
              disabled={cfg.trendFilter !== "enabled"}
              onChange={(e) => upd("trendFastEma", Math.max(1, +e.target.value))}
            />
          </label>
          <label>
            Slow EMA
            <input
              type="number"
              min="2"
              step="1"
              value={cfg.trendSlowEma}
              disabled={cfg.trendFilter !== "enabled"}
              onChange={(e) => upd("trendSlowEma", Math.max(cfg.trendFastEma + 1, +e.target.value))}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Default: 5m EMA20 &gt; EMA50 for long trades.
            </span>
          </label>
          <label>
            Backtest range preset
            <select
              value=""
              onChange={(e) => {
                const d = Number(e.target.value);
                if (d) {
                  setStartDate(rangeStart(d));
                  setEndDate(yesterdayIso());
                }
              }}
            >
              <option value="">Choose preset...</option>
              {RANGE_PRESETS.map(([label, days]) => (
                <option key={label} value={days}>
                  {label}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              Uses cached real Binance candles when available.
            </span>
          </label>
          <label>
            Backtest start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label>
            Backtest end date
            <input
              type="date"
              value={endDate}
              max={yesterdayIso()}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
        <div className="grid" style={{ marginTop: 16 }}>
          <div className="kpi-card">
            <div className="kpi-label">Stop logic</div>
            <div style={{ fontWeight: 800, marginTop: 8 }}>
              {cfg.stop === "atr"
                ? `ATR × ${cfg.atr}`
                : cfg.stop === "structure"
                  ? "Recent structure level"
                  : `ATR × ${cfg.atr} or structure`}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Stops are user-defined by mode. In live paper trading, stop is the trigger; actual fill can differ because exits use live tick market fills.
            </p>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Target logic</div>
            <div style={{ fontWeight: 800, marginTop: 8 }}>
              T1 {cfg.t1}R · T2 {cfg.t2}R
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Larger Target 2 is user-defined. For trend following, keep losses near -1R and let bigger winners reach T2.
            </p>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Re-entry discipline</div>
            <div style={{ fontWeight: 800, marginTop: 8 }}>
              {payload.strategy.reentry.enabled
                ? `${payload.strategy.reentry.max_reentries} max · ${payload.strategy.reentry.cooldown_bars} bar cooldown`
                : "Disabled"}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Cooldown prevents rapid repeat entries after losses or failed setups. This reduces overtrading on noisy lower timeframes.
            </p>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Higher-timeframe filter</div>
            <div style={{ fontWeight: 800, marginTop: 8 }}>
              {payload.strategy.trend_filter.use_trend_filter
                ? `${payload.strategy.trend_filter.higher_timeframe} EMA${payload.strategy.trend_filter.fast_ema} > EMA${payload.strategy.trend_filter.slow_ema}`
                : "Disabled"}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Filters noisy lower-timeframe long breakouts against the larger trend.
            </p>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Execution assumption</div>
            <div style={{ fontWeight: 800, marginTop: 8 }}>
              Backtest: research fills · Live: tick market fills
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Backtests are for research. Live paper trading shows slippage between intended stop/target and actual WebSocket tick fill.
            </p>
          </div>
        </div>

        <div
          className="card"
          style={{ background: "#0f172a", margin: "16px 0 0" }}
        >
          <b>Real historical data mode</b>
          <p className="muted">
            Backtest uses cached real Binance klines for{" "}
            {cfg.symbols.join(", ")} from {startDate} to{" "}
            {endDate || yesterdayIso()}. Missing ranges are downloaded in
            retryable chunks; no synthetic fallback is used.
          </p>
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={save}>Save Strategy</button>{" "}
          <button className="secondary" onClick={run} disabled={running}>
            {running ? "Running Backtest..." : "Run Backtest"}
          </button>
        </div>
        {runProgress && (
          <div className="card" style={{ background: "#0f172a", margin: "12px 0 0" }}>
            <b>Backtest progress</b>
            <p className="muted" style={{ marginBottom: 0 }}>{runProgress}</p>
          </div>
        )}
        <p className="muted" style={{ marginTop: 10 }}>
          {msg}
        </p>
      </div>
      {job && <BacktestResult job={job} pollJob={pollJob} />}
      <StrategyPreview payload={payload} strategyId={strategyId} />
    </>
  );
}

function Kpi({
  label,
  value,
  color,
}: {
  label: string;
  value: any;
  color?: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
const td = { borderBottom: "1px solid #1e293b", padding: "10px 8px" };
const tdStrong = { ...td, color: "#94a3b8", fontWeight: 800, width: 260 };
function BacktestResult({ job, pollJob }: { job: any; pollJob: any }) {
  const s = job.summary || {};
  const pr = s.performance_and_robustness || job.performance_and_robustness || {};
  const ra = pr.risk_adjusted || {};
  const ex = pr.expectancy || {};
  const risk = pr.risk || {};
  const tb = pr.trading_behavior || {};
  const robust = pr.robustness || {};
  const warnings = Array.isArray(pr.warnings) ? pr.warnings : [];
  const allSymbols = Array.isArray(job.symbols)
    ? job.symbols
    : Array.isArray(job.market_data?.symbols)
      ? job.market_data.symbols
      : job.market_data?.symbol
        ? [job.market_data.symbol]
        : [];
  const symbolLabel = allSymbols.length ? allSymbols.join(", ") : (job.market_data?.symbol || "BTCUSDT");
  const rowsPerSymbol = job.market_data?.rows_per_symbol || {};
  const rowCounts = Object.values(rowsPerSymbol).filter((v:any) => v != null);
  const rowLabel = allSymbols.length > 1 && rowCounts.length
    ? `${rowCounts.join(" / ")} rows per selected symbol · ${job.market_data?.total_rows_all_symbols ?? rowCounts.reduce((a:any,b:any)=>Number(a)+Number(b),0)} total rows across ${allSymbols.length} symbols`
    : (job.market_data?.rows ?? "cached");
  const positive = Number(s.wins || 0);
  const negative = Number(s.losses || 0);
  const be = Math.max(0, Number(s.total_trades || 0) - positive - negative);
  const rows = [
    [
      "Positive / Negative / Breakeven R trades",
      `${positive} / ${negative} / ${be}`,
      "Classified by final R, not only target hits.",
    ],
    ["Bars processed", s.bars_processed, "Backtest engine metric."],
    ["Breakouts detected", s.breakouts, "Breakout opportunities detected."],
    ["Retests found", s.retests, "Retest confirmations after breakout."],
    ["Entries taken", s.entries, "Entries executed."],
    ["Re-entries", s.re_entries, "Re-entry count."],
    ["Rejections", s.rejections, "Setups rejected by filters/score/risk."],
    ["Invalidations", s.invalidations, "Setups invalidated before entry."],
    ["Entry expired", s.entry_expired, "Expired before entry."],
    ["Target 1 hits", s.target1_hits, "Clean target one hit count."],
    ["Target 2 hits", s.target2_hits, "Clean target two hit count."],
    ["Stop hits", s.stop_hits, "Hard stop-loss hit count."],
    ["Time exits", s.time_exits, "Closed by TTL/time rules."],
    [
      "HTF EMA filter rejections",
      s.trend_filter_rejections ?? 0,
      "Setups blocked because the higher-timeframe EMA trend was not bullish.",
    ],
    [
      "Max drawdown (R)",
      fmt(s.max_drawdown_in_R),
      "Worst peak-to-trough R drawdown.",
    ],
    [
      "Avg holding bars",
      fmt(s.average_holding_bars),
      "Average trade duration.",
    ],
  ];
  return (
    <div className="card">
      <h2>Backtest Result</h2>
      <div className="grid" style={{ marginTop: 14 }}>
        <Kpi label="Status" value={pollJob?.status || job.status} />
        <Kpi
          label="Total Trades"
          value={s.total_trades ?? job.trades?.length ?? 0}
        />
        <Kpi
          label="Gross R"
          value={`${fmt(s.gross_R)}R`}
          color={signedClass(s.gross_R)}
        />
        <Kpi
          label="Avg R"
          value={`${fmt(s.average_R)}R`}
          color={signedClass(s.average_R)}
        />
        <Kpi label="Win Rate" value={pct(s.win_rate)} />
        <Kpi label="Profit Factor" value={fmt(s.profit_factor)} />
      </div>
      {job.market_data && (
        <div
          className="card"
          style={{ background: "#0f172a", margin: "16px 0 0" }}
        >
          <h3>Historical Market Data</h3>
          <table className="pro-table" style={{ width: "100%" }}>
            <tbody>
              <tr>
                <td style={tdStrong}>Source</td>
                <td style={td}>Real Binance klines</td>
              </tr>
              <tr>
                <td style={tdStrong}>Symbol / Timeframe</td>
                <td style={td}>
                  {job.market_data.symbol ||
                    (job.market_data.symbols || []).join(", ")}{" "}
                  · {job.market_data.timeframe}
                </td>
              </tr>
              <tr>
                <td style={tdStrong}>Date range</td>
                <td style={td}>
                  {job.market_data.start_date} → {job.market_data.end_date}
                </td>
              </tr>
              <tr>
                <td style={tdStrong}>Rows used</td>
                <td style={td}>{rowLabel}</td>
              </tr>
              <tr>
                <td style={tdStrong}>Synthetic data</td>
                <td style={td}>NOT USED</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <h3>Performance & Robustness</h3>
        <div className="grid" style={{ marginTop: 12 }}>
          <Kpi label="Sharpe" value={metric(ra.sharpe)} />
          <Kpi label="Sortino" value={metric(ra.sortino)} />
          <Kpi label="Calmar" value={metric(ra.calmar)} />
          <Kpi label="Omega" value={metric(ra.omega)} />
          <Kpi label="Recovery Factor" value={metric(ra.recovery_factor)} />
          <Kpi label="Expectancy" value={metric(ex.expectancy_R_per_trade, "R")} color={signedClass(ex.expectancy_R_per_trade)} />
          <Kpi label="Avg Winner / Loser" value={`${metric(ex.average_winner_R, "R")} / ${metric(ex.average_loser_R, "R")}`} />
          <Kpi label="Largest Winner / Loser" value={`${metric(ex.largest_winner_R, "R")} / ${metric(ex.largest_loser_R, "R")}`} />
          <Kpi label="Real Notional Turnover %" value={tb.turnover_display || "Not enough data"} />
          <Kpi label="Estimated Turnover Proxy %" value={tb.turnover_proxy_display || "Not enough data"} />
          <Kpi label="Trades / Day" value={metric(tb.trades_per_day)} />
          <Kpi label="Exposure %" value={tb.exposure_display || "Not enough data"} />
          <Kpi label="Max Win / Loss Streak" value={`${risk.max_consecutive_wins ?? 0} / ${risk.max_consecutive_losses ?? 0}`} />
          <Kpi label="Ulcer Index" value={metric(risk.ulcer_index)} />
          <Kpi label="Overfitting Risk" value={`${robust.overfitting_risk_label || "Not enough data"} ${robust.overfitting_risk_score ?? ""}`} />
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Ratios require enough R-multiple dispersion. Real turnover needs notional and equity data. The proxy is a risk-based activity estimate, not real notional turnover.
        </p>
        {warnings.length > 0 && (
          <ul className="muted" style={{ lineHeight: 1.7 }}>
            {warnings.map((w: string) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </div>
      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table className="pro-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([a, b, c]) => (
              <tr key={String(a)}>
                <td>{a}</td>
                <td>{b ?? 0}</td>
                <td className="muted">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Open Backtests page to view report files and detailed logs.
      </p>
    </div>
  );
}

function StrategyPreview({
  payload,
  strategyId,
}: {
  payload: any;
  strategyId: string;
}) {
  const rows = [
    ["Strategy ID", payload.user_strategy_id],
    ["Symbols", payload.symbols?.join(", ")],
    ["Timeframe", payload.timeframe],
    ["Bar length", `${payload.bar_seconds} seconds`],
    ["Breakout lookback", payload.strategy.breakout_lookback],
    ["Retest tolerance", payload.strategy.retest_tolerance_pct],
    ["Minimum setup score", payload.strategy.min_setup_score],
    [
      "Stop loss",
      `${payload.strategy.stop_loss.type} · ATR ${payload.strategy.stop_loss.atr_multiplier}`,
    ],
    [
      "Targets",
      `${payload.strategy.targets.target1_R}R / ${payload.strategy.targets.target2_R}R`,
    ],
    ["Risk per trade", `${payload.strategy.risk.risk_per_trade_pct}%`],
    ["TTL bars", payload.strategy.ttl_bars],
    ["Re-entry", payload.strategy.reentry.enabled ? "Enabled" : "Disabled"],
    ["Max re-entries", payload.strategy.reentry.max_reentries],
    ["Re-entry cooldown", `${payload.strategy.reentry.cooldown_bars} bars`],
    ["Signal cooldown", `${payload.strategy.signal_cooldown_bars} bars`],
    [
      "HTF EMA filter",
      payload.strategy.trend_filter.use_trend_filter
        ? `${payload.strategy.trend_filter.higher_timeframe} EMA${payload.strategy.trend_filter.fast_ema} > EMA${payload.strategy.trend_filter.slow_ema}`
        : "Disabled",
    ],
  ];
  return (
    <div className="card">
      <h2>Strategy Configuration Summary</h2>
      <p className="muted">
        This is the exact strategy summary saved for backtests and live paper
        trading.
      </p>
      <table className="pro-table" style={{ width: "100%" }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={String(k)}>
              <td style={tdStrong}>{k}</td>
              <td style={td}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
