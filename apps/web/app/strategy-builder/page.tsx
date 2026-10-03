"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getUser, getToken } from "../../lib/api";

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

const POPULAR_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "PEPEUSDT",
  "SUIUSDT",
  "NEARUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "TRXUSDT",
  "SHIBUSDT",
  "DOTUSDT",
  "LTCUSDT",
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
  return x > 0 ? "#4ade80" : x < 0 ? "#f87171" : "#e2e8f0";
}

const inputStyle = {
  background: "#0d1322",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "#f8fafc",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

const labelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "#94a3b8",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

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

  const [allAvailableSymbols, setAllAvailableSymbols] = useState<string[]>(POPULAR_SYMBOLS);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [customSymbolInput, setCustomSymbolInput] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [job, setJob] = useState<any>(null);
  const [pollJob, setPollJob] = useState<any>(null);
  const [msg, setMsg] = useState("Configure strategy parameters, select crypto markets, and run a backtest.");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState("");
  const [startDate, setStartDate] = useState(startIso());
  const [endDate, setEndDate] = useState(yesterdayIso());

  const heavyLowTimeframe = cfg.symbols.length > 3 && timeframeToSeconds(cfg.timeframe) <= 5;

  useEffect(() => {
    let cancelled = false;
    api("/live-paper/symbols")
      .then((res: any) => {
        if (!cancelled && Array.isArray(res?.symbols) && res.symbols.length > 0) {
          setAllAvailableSymbols(res.symbols);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function upd(k: keyof Cfg, v: any) {
    setCfg((prev) => ({ ...prev, [k]: v }));
  }

  function toggleSymbol(sym: string) {
    const s = sym.toUpperCase().trim();
    const set = new Set(cfg.symbols);
    set.has(s) ? set.delete(s) : set.add(s);
    const next = [...set];
    upd("symbols", next.length ? next : ["BTCUSDT"]);
  }

  function selectPopularSymbols() {
    upd("symbols", [...POPULAR_SYMBOLS]);
  }

  function selectAllSymbols() {
    const top50 = allAvailableSymbols.slice(0, 50);
    upd("symbols", top50);
  }

  function clearSymbols() {
    upd("symbols", ["BTCUSDT"]);
  }

  function addCustomSymbol() {
    let s = customSymbolInput.trim().toUpperCase();
    if (!s) return;
    if (!s.endsWith("USDT") && !s.includes("USD")) {
      s = `${s}USDT`;
    }
    if (!cfg.symbols.includes(s)) {
      upd("symbols", [...cfg.symbols, s]);
    }
    if (!allAvailableSymbols.includes(s)) {
      setAllAvailableSymbols((prev) => [s, ...prev]);
    }
    setCustomSymbolInput("");
  }

  // Filtered symbols to display in picker based on search
  const visibleSymbols = useMemo(() => {
    const q = symbolSearchQuery.trim().toUpperCase();
    const combinedSet = new Set([...POPULAR_SYMBOLS, ...cfg.symbols]);
    if (!q) {
      return Array.from(combinedSet);
    }
    // Search across all 200+ available Binance symbols
    const matched = allAvailableSymbols.filter((s) => s.includes(q));
    // Always include selected symbols so they stay visible
    cfg.symbols.forEach((s) => {
      if (!matched.includes(s)) matched.unshift(s);
    });
    return matched.slice(0, 40);
  }, [symbolSearchQuery, allAvailableSymbols, cfg.symbols]);

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
      setMsg("Saving strategy to quantitative database...");
      const r: any = await api("/strategies", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setStrategyId(r.strategy_id || r.id);
      setMsg("Strategy saved successfully: " + (r.user_strategy_id || r.strategy_id || r.id));
    } catch (e: any) {
      const message = e?.message || "Save failed";
      if (message.toLowerCase().includes("already used")) alert(message);
      setMsg("Save failed: " + message);
    }
  }

  async function poll(jobId: string) {
    for (let i = 0; i < 45; i++) {
      const j: any = await api(`/jobs/${jobId}`);
      setPollJob(j);
      setJob(j);
      const total = payload.symbols.length;
      if (total > 1) {
        setRunProgress(
          `Executing basket (${total} symbols) on historical Binance klines. Poll ${i + 1} / 45...`,
        );
      } else {
        setRunProgress(`Processing candles and generating backtest report (poll ${i + 1} / 45)...`);
      }
      if (j.status === "completed" || j.status === "failed") return j;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }

  async function run() {
    if (running) return;
    const token = getToken();
    if (!token) {
      setMsg("Please sign in first to run backtests.");
      setRunProgress("Authentication required.");
      return;
    }
    const selectedSymbols = payload.symbols;
    try {
      setRunning(true);
      setRunProgress(
        selectedSymbols.length > 1
          ? `Submitting multi-symbol backtest for ${selectedSymbols.length} pairs (${selectedSymbols.slice(0, 3).join(", ")}...).`
          : `Running backtest on ${selectedSymbols[0] || "BTCUSDT"}...`,
      );
      setMsg("Submitting backtest job to execution runner...");
      setJob(null);
      setPollJob(null);
      let sid = strategyId;
      if (!sid) {
        try {
          const s: any = await api("/strategies", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          sid = s.strategy_id || s.id;
          setStrategyId(sid);
        } catch (stratErr: any) {
          try {
            const strats: any = await api("/strategies");
            const found = Array.isArray(strats) && strats.find((st: any) =>
              st.user_strategy_id === payload.user_strategy_id || st.name === payload.name
            );
            if (found) {
              sid = found.id || found.strategy_id;
              setStrategyId(sid);
            }
          } catch {}
          if (!sid) throw stratErr;
        }
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
        setMsg("Backtest queued in runner. Polling execution...");
        const finalJob = await poll(r.job_id);
        if (finalJob) {
          setJob(finalJob);
          setPollJob(finalJob);
          setMsg(`Backtest ${finalJob.status}. Job: ${r.job_id}`);
          if (selectedSymbols.length > 1 && finalJob.status === "completed") {
            setRunProgress(`Completed ${selectedSymbols.length} / ${selectedSymbols.length} selected symbols.`);
          } else if (finalJob.status === "completed") {
            setRunProgress("Backtest completed successfully.");
          } else if (finalJob.status === "failed") {
            setMsg("Backtest failed: " + (finalJob.error || finalJob.error_message || "Unknown error"));
          }
        } else {
          setRunProgress("Still processing on the backend. Check Backtests page for final results.");
        }
      } else if (r.status === "failed") {
        setMsg("Backtest failed: " + (r.error || r.error_message || "Unknown error"));
      }
    } catch (e: any) {
      setMsg("Backtest failed: " + e.message);
      setRunProgress("Backtest request failed before completion.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ background: "#0b0f19", minHeight: "100vh", color: "#e2e8f0", paddingBottom: 60, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* ─── Hero Header ─── */}
      <div
        style={{
          borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
          background: "linear-gradient(180deg, rgba(15, 23, 42, 0.85) 0%, rgba(11, 15, 25, 0.95) 100%)",
          backdropFilter: "blur(16px)",
          padding: "28px 32px",
        }}
      >
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  background: "rgba(99, 102, 241, 0.15)",
                  color: "#818cf8",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  padding: "3px 9px",
                  borderRadius: 6,
                  border: "1px solid rgba(99, 102, 241, 0.3)",
                  textTransform: "uppercase",
                }}
              >
                Strategy Studio
              </span>
              <span style={{ fontSize: 13, color: "#64748b" }}>•</span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>
                PRISM Breakout & Retest Engine
              </span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: "-0.02em" }}>
              Quant Strategy Builder & Backtest Lab
            </h1>
            <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 13 }}>
              Formulate user-defined rules, select from 200+ Binance cryptocurrency markets, and execute authentic historical backtests.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                background: "rgba(34, 197, 94, 0.1)",
                color: "#4ade80",
                border: "1px solid rgba(34, 197, 94, 0.25)",
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ✓ Authentic Binance Klines
            </span>
            <span
              style={{
                background: "rgba(59, 130, 246, 0.1)",
                color: "#60a5fa",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Pure Paper Mode
            </span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 32px 0" }}>
        {/* ─── Main Configuration Card ─── */}
        <div
          style={{
            background: "linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 18,
            padding: 28,
            boxShadow: "0 12px 30px rgba(0, 0, 0, 0.25)",
            marginBottom: 28,
          }}
        >
          {/* Section 1: Identification & Timeframe */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 16 }}>⚙️</span>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
              Strategy Identity & Timeframe
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 28 }}>
            <label style={labelStyle}>
              Strategy Identifier
              <input
                style={inputStyle}
                value={cfg.strategyCode}
                onChange={(e) => upd("strategyCode", e.target.value)}
                placeholder="PRISM_BREAKOUT_RETEST"
              />
              <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Unique label for backtest and live tracking</span>
            </label>

            <label style={labelStyle}>
              Execution Timeframe
              <select
                style={inputStyle}
                value={cfg.timeframe}
                onChange={(e) => upd("timeframe", e.target.value)}
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf} ({timeframeToSeconds(tf)}s candles)
                  </option>
                ))}
              </select>
              <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>
                Candle length: {timeframeToSeconds(cfg.timeframe)} seconds
              </span>
            </label>

            <label style={labelStyle}>
              Breakout Lookback
              <input
                style={inputStyle}
                type="number"
                value={cfg.lookback}
                onChange={(e) => upd("lookback", +e.target.value)}
              />
              <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Previous bars for high/low breakout</span>
            </label>

            <label style={labelStyle}>
              Min Setup Score (0 - 10)
              <input
                style={inputStyle}
                type="number"
                step="0.1"
                value={cfg.score}
                onChange={(e) => upd("score", +e.target.value)}
              />
              <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>PRISM composite quality threshold</span>
            </label>
          </div>

          {/* ─── Section 2: 200+ Cryptocurrency Market Basket Selector ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🪙</span>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                    Cryptocurrency Markets for Backtest & Paper Trading
                  </h2>
                </div>
                <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
                  Select one, several, or popular cryptocurrency markets from all 200+ Binance USDT pairs.
                </p>
              </div>

              {/* Fast presets buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={selectPopularSymbols}
                  style={{
                    background: "rgba(99, 102, 241, 0.15)",
                    color: "#a5b4fc",
                    border: "1px solid rgba(99, 102, 241, 0.35)",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Select Popular (16)
                </button>
                <button
                  type="button"
                  onClick={selectAllSymbols}
                  style={{
                    background: "rgba(30, 41, 59, 0.7)",
                    color: "#cbd5e1",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Top 50 Pairs
                </button>
                <button
                  type="button"
                  onClick={clearSymbols}
                  style={{
                    background: "transparent",
                    color: "#94a3b8",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  BTC Only
                </button>
              </div>
            </div>

            {/* Search & Custom Symbol input row */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <input
                  type="text"
                  placeholder="Search any crypto pair (e.g. PEPE, SUI, DOGE, SOL, INJ, TIA)..."
                  value={symbolSearchQuery}
                  onChange={(e) => setSymbolSearchQuery(e.target.value)}
                  style={{ ...inputStyle, width: "100%" }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Add custom pair (e.g. RENDER)..."
                  value={customSymbolInput}
                  onChange={(e) => setCustomSymbolInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomSymbol();
                    }
                  }}
                  style={{ ...inputStyle, width: 220, textTransform: "uppercase" }}
                />
                <button
                  type="button"
                  onClick={addCustomSymbol}
                  disabled={!customSymbolInput.trim()}
                  style={{
                    background: "rgba(99, 102, 241, 0.2)",
                    color: "#a5b4fc",
                    border: "1px solid rgba(99, 102, 241, 0.4)",
                    padding: "9px 14px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: customSymbolInput.trim() ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                  }}
                >
                  + Add Pair
                </button>
              </div>
            </div>

            {/* Interactive Symbol Chips Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                gap: 8,
                maxHeight: 220,
                overflowY: "auto",
                background: "rgba(11, 16, 28, 0.6)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                borderRadius: 12,
                padding: 12,
              }}
            >
              {visibleSymbols.map((sym) => {
                const isSelected = cfg.symbols.includes(sym);
                return (
                  <button
                    type="button"
                    key={sym}
                    onClick={() => toggleSymbol(sym)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: isSelected ? "rgba(99, 102, 241, 0.25)" : "rgba(15, 23, 42, 0.7)",
                      border: `1px solid ${isSelected ? "rgba(99, 102, 241, 0.6)" : "rgba(255, 255, 255, 0.08)"}`,
                      color: isSelected ? "#ffffff" : "#94a3b8",
                      fontSize: 12,
                      fontWeight: isSelected ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.1s ease",
                    }}
                  >
                    <span>{sym}</span>
                    <span style={{ fontSize: 13, color: isSelected ? "#a5b4fc" : "#475569" }}>
                      {isSelected ? "✓" : "+"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                Selected active basket ({cfg.symbols.length}):{" "}
                <strong style={{ color: "#38bdf8" }}>{cfg.symbols.join(", ")}</strong>
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {allAvailableSymbols.length} total Binance cryptocurrency pairs available
              </div>
            </div>

            {heavyLowTimeframe && (
              <div style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: 8, padding: "8px 14px", marginTop: 10, color: "#fbbf24", fontSize: 12 }}>
                ⚠️ Notice: Backtesting {cfg.symbols.length} symbols on sub-5s timeframes requires significant candle throughput. Consider testing BTC first or local engine mode.
              </div>
            )}
          </div>

          {/* ─── Section 3: PRISM Setup & Risk Architecture ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>🛡</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                Risk Management, Exits & Re-Entry Discipline
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, marginBottom: 20 }}>
              <label style={labelStyle}>
                Stop-Loss Mode
                <select
                  style={inputStyle}
                  value={cfg.stop}
                  onChange={(e) => upd("stop", e.target.value)}
                >
                  <option value="atr_or_structure">ATR or Structure (Recommended)</option>
                  <option value="atr">ATR Multiplier Only</option>
                  <option value="structure">Market Structure Only</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Determines initial hard stop level</span>
              </label>

              <label style={labelStyle}>
                ATR Multiplier
                <input
                  style={inputStyle}
                  type="number"
                  step="0.05"
                  value={cfg.atr}
                  onChange={(e) => upd("atr", +e.target.value)}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Stop distance = ATR × {cfg.atr}</span>
              </label>

              <label style={labelStyle}>
                Target 1 R-Multiple
                <input
                  style={inputStyle}
                  type="number"
                  step="0.1"
                  value={cfg.t1}
                  onChange={(e) => upd("t1", +e.target.value)}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>First profit scaling exit target</span>
              </label>

              <label style={labelStyle}>
                Target 2 R-Multiple
                <input
                  style={inputStyle}
                  type="number"
                  step="0.1"
                  value={cfg.t2}
                  onChange={(e) => upd("t2", +e.target.value)}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Runner target for larger trend moves</span>
              </label>

              <label style={labelStyle}>
                Risk Per Trade %
                <input
                  style={inputStyle}
                  type="number"
                  step="0.1"
                  value={cfg.risk}
                  onChange={(e) => upd("risk", +e.target.value)}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>% of paper equity risked per setup</span>
              </label>

              <label style={labelStyle}>
                Retest Tolerance %
                <input
                  style={inputStyle}
                  type="number"
                  step="0.0001"
                  value={cfg.retest}
                  onChange={(e) => upd("retest", +e.target.value)}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Allowable zone penetration (0.001 = 0.1%)</span>
              </label>

              <label style={labelStyle}>
                Setup TTL Bars
                <input
                  style={inputStyle}
                  type="number"
                  value={cfg.ttl}
                  onChange={(e) => upd("ttl", +e.target.value)}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Bars before pending setup expires</span>
              </label>

              <label style={labelStyle}>
                Re-Entry Filter
                <select
                  style={inputStyle}
                  value={cfg.reentry}
                  onChange={(e) => upd("reentry", e.target.value)}
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Enforce re-entry cooldown rules</span>
              </label>

              <label style={labelStyle}>
                Max Re-Entries
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step="1"
                  value={cfg.maxReentries}
                  disabled={cfg.reentry !== "enabled"}
                  onChange={(e) => upd("maxReentries", Math.max(0, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Limits repeated entries after stop</span>
              </label>

              <label style={labelStyle}>
                Re-Entry Cooldown
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step="1"
                  value={cfg.reentryCooldown}
                  disabled={cfg.reentry !== "enabled"}
                  onChange={(e) => upd("reentryCooldown", Math.max(0, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Cooldown bars before allowing re-entry</span>
              </label>
            </div>
          </div>

          {/* ─── Section 4: Higher-Timeframe Trend Filter ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>📈</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                Higher-Timeframe EMA Trend Filter
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
              <label style={labelStyle}>
                Trend Filter Status
                <select
                  style={inputStyle}
                  value={cfg.trendFilter}
                  onChange={(e) => upd("trendFilter", e.target.value)}
                >
                  <option value="enabled">Enabled (Require Trend Alignment)</option>
                  <option value="disabled">Disabled (Trade All Breakouts)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Only enter longs when HTF EMA Fast &gt; Slow</span>
              </label>

              <label style={labelStyle}>
                Trend Timeframe
                <select
                  style={inputStyle}
                  value={cfg.trendTimeframe}
                  disabled={cfg.trendFilter !== "enabled"}
                  onChange={(e) => upd("trendTimeframe", e.target.value)}
                >
                  {TIMEFRAMES.filter((tf) => timeframeToSeconds(tf) >= timeframeToSeconds(cfg.timeframe)).map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Higher macro timeframe</span>
              </label>

              <label style={labelStyle}>
                Fast EMA Period
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  step="1"
                  value={cfg.trendFastEma}
                  disabled={cfg.trendFilter !== "enabled"}
                  onChange={(e) => upd("trendFastEma", Math.max(1, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Typically 20 or 21</span>
              </label>

              <label style={labelStyle}>
                Slow EMA Period
                <input
                  style={inputStyle}
                  type="number"
                  min="2"
                  step="1"
                  value={cfg.trendSlowEma}
                  disabled={cfg.trendFilter !== "enabled"}
                  onChange={(e) => upd("trendSlowEma", Math.max(cfg.trendFastEma + 1, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Typically 50 or 200</span>
              </label>
            </div>
          </div>

          {/* ─── Section 5: Historical Range & Execution ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>📅</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                Historical Backtest Range & Controls
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, marginBottom: 20 }}>
              <label style={labelStyle}>
                Quick Date Preset
                <select
                  style={inputStyle}
                  value=""
                  onChange={(e) => {
                    const d = Number(e.target.value);
                    if (d) {
                      setStartDate(rangeStart(d));
                      setEndDate(yesterdayIso());
                    }
                  }}
                >
                  <option value="">Choose preset range...</option>
                  {RANGE_PRESETS.map(([lbl, days]) => (
                    <option key={lbl} value={days}>
                      {lbl} ({days} days)
                    </option>
                  ))}
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Automatically sets start/end dates</span>
              </label>

              <label style={labelStyle}>
                Start Date
                <input
                  style={inputStyle}
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>

              <label style={labelStyle}>
                End Date
                <input
                  style={inputStyle}
                  type="date"
                  value={endDate}
                  max={yesterdayIso()}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </div>

            {/* Real Data Notice Banner */}
            <div
              style={{
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px solid rgba(255, 255, 255, 0.06)",
                borderRadius: 12,
                padding: "14px 18px",
                marginBottom: 24,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 20 }}>📡</span>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
                <strong style={{ color: "#f1f5f9" }}>Real Binance Historical Kline Mode:</strong> Backtest executes on authentic Binance candle data for <span style={{ color: "#38bdf8" }}>{cfg.symbols.join(", ")}</span> from {startDate} to {endDate || yesterdayIso()}. Missing intervals are automatically fetched; synthetic fallbacks are strictly disabled.
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={run}
                disabled={running}
                style={{
                  background: running
                    ? "rgba(99, 102, 241, 0.4)"
                    : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 10,
                  padding: "12px 26px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: running ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 16px rgba(99, 102, 241, 0.4)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {running ? (
                  <>
                    <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                    Running Backtest...
                  </>
                ) : (
                  <>
                    <span>▶</span> Run Backtest
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={save}
                style={{
                  background: "rgba(30, 41, 59, 0.8)",
                  color: "#e2e8f0",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: 10,
                  padding: "12px 22px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>💾</span> Save Strategy
              </button>
            </div>

            {runProgress && (
              <div
                style={{
                  background: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  borderRadius: 10,
                  padding: "12px 18px",
                  marginTop: 16,
                  color: "#93c5fd",
                  fontSize: 13,
                }}
              >
                <strong>Execution Status:</strong> {runProgress}
              </div>
            )}

            <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 12 }}>
              {msg}
            </div>
          </div>
        </div>

        {/* ─── Real-Time Strategy Mechanics Cards ─── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 28 }}>
          <div style={{ background: "rgba(17, 24, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Stop Logic
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#f87171", marginTop: 6 }}>
              {cfg.stop === "atr"
                ? `ATR × ${cfg.atr}`
                : cfg.stop === "structure"
                  ? "Recent Structure Level"
                  : `ATR × ${cfg.atr} or Structure`}
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              Protects capital on invalidations. Triggered dynamically in tick simulation.
            </p>
          </div>

          <div style={{ background: "rgba(17, 24, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Target Architecture
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#4ade80", marginTop: 6 }}>
              T1 {cfg.t1}R · T2 {cfg.t2}R
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              Asymmetric payoff model: locks gains at T1 and lets runners reach T2.
            </p>
          </div>

          <div style={{ background: "rgba(17, 24, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Re-Entry Discipline
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fbbf24", marginTop: 6 }}>
              {payload.strategy.reentry.enabled
                ? `${payload.strategy.reentry.max_reentries} Max · ${payload.strategy.reentry.cooldown_bars} Bar Cooldown`
                : "Disabled"}
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              Enforces a strict cooling-off period to prevent psychological revenge trading.
            </p>
          </div>

          <div style={{ background: "rgba(17, 24, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Macro Trend Filter
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#c084fc", marginTop: 6 }}>
              {payload.strategy.trend_filter.use_trend_filter
                ? `${payload.strategy.trend_filter.higher_timeframe} EMA${payload.strategy.trend_filter.fast_ema} > EMA${payload.strategy.trend_filter.slow_ema}`
                : "Disabled"}
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              Filters out noisy counter-trend breakouts against the primary macro momentum.
            </p>
          </div>
        </div>

        {/* ─── Backtest Results Section ─── */}
        {job && <BacktestResult job={job} pollJob={pollJob} />}

        {/* ─── Strategy Configuration Summary ─── */}
        <StrategyPreview payload={payload} strategyId={strategyId} />
      </div>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
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
    <div
      style={{
        background: "rgba(15, 23, 42, 0.7)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderRadius: 12,
        padding: "14px 18px",
      }}
    >
      <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || "#f8fafc", marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

const td = { borderBottom: "1px solid rgba(255, 255, 255, 0.05)", padding: "10px 12px", color: "#cbd5e1", fontSize: 13 };
const tdStrong = { ...td, color: "#94a3b8", fontWeight: 700, width: 260 };

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
  const rowCounts = Object.values(rowsPerSymbol).filter((v: any) => v != null);
  const rowLabel = allSymbols.length > 1 && rowCounts.length
    ? `${rowCounts.join(" / ")} rows per selected symbol · ${job.market_data?.total_rows_all_symbols ?? rowCounts.reduce((a: any, b: any) => Number(a) + Number(b), 0)} total rows across ${allSymbols.length} symbols`
    : (job.market_data?.rows ?? "cached");
  const positive = Number(s.wins || 0);
  const negative = Number(s.losses || 0);
  const be = Math.max(0, Number(s.total_trades || 0) - positive - negative);

  const rows = [
    [
      "Positive / Negative / Breakeven Trades",
      `${positive} / ${negative} / ${be}`,
      "Classified by final realized R-multiple, not just target hits.",
    ],
    ["Bars Processed", s.bars_processed, "Historical bars scanned by engine."],
    ["Breakouts Detected", s.breakouts, "Total price level breakout triggers."],
    ["Retests Confirmed", s.retests, "Retest confirmations meeting tolerance."],
    ["Entries Executed", s.entries, "Valid entries matching risk & score."],
    ["Re-Entries Taken", s.re_entries, "Re-entries executed after cooldown."],
    ["Setups Rejected", s.rejections, "Blocked by score, cooldown or risk."],
    ["Setups Invalidated", s.invalidations, "Price broke beyond invalidation zone."],
    ["Setups Expired", s.entry_expired, "Exceeded maximum TTL bar duration."],
    ["Target 1 Hits", s.target1_hits, "Profit scaling exits achieved."],
    ["Target 2 Hits", s.target2_hits, "Full runner profit exits achieved."],
    ["Stop-Loss Hits", s.stop_hits, "Hard stop-loss executions."],
    ["Time Exits", s.time_exits, "Closed upon reaching max holding time."],
    [
      "HTF EMA Trend Rejections",
      s.trend_filter_rejections ?? 0,
      "Setups blocked because higher-timeframe EMA was bearish.",
    ],
    [
      "Max Drawdown (R)",
      `${fmt(s.max_drawdown_in_R)} R`,
      "Worst peak-to-trough equity drawdown.",
    ],
    [
      "Average Holding Duration",
      `${fmt(s.average_holding_bars)} bars`,
      "Average bar duration per trade.",
    ],
  ];

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 18,
        padding: 28,
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.25)",
        marginBottom: 28,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "#ffffff" }}>
            Backtest Execution Performance
          </h2>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
            Simulated performance metrics across selected historical Binance market data
          </p>
        </div>
        <Link
          href="/quant-coach"
          style={{
            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            color: "#ffffff",
            textDecoration: "none",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          🧠 Open Quant Coach Report →
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Kpi label="Status" value={pollJob?.status?.toUpperCase() || job.status?.toUpperCase()} color="#38bdf8" />
        <Kpi label="Total Trades" value={s.total_trades ?? job.trades?.length ?? 0} />
        <Kpi label="Gross R" value={`${fmt(s.gross_R)} R`} color={signedClass(s.gross_R)} />
        <Kpi label="Avg Expectancy" value={`${fmt(s.average_R)} R`} color={signedClass(s.average_R)} />
        <Kpi label="Win Rate" value={pct(s.win_rate)} color="#4ade80" />
        <Kpi label="Profit Factor" value={fmt(s.profit_factor)} />
      </div>

      {job.market_data && (
        <div
          style={{
            background: "rgba(15, 23, 42, 0.6)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            borderRadius: 12,
            padding: "16px 20px",
            marginBottom: 24,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px", color: "#f8fafc" }}>
            Historical Market Data Provenance
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={tdStrong}>Data Source</td>
                <td style={td}>Real Binance Spot Klines (Direct Exchange Cache)</td>
              </tr>
              <tr>
                <td style={tdStrong}>Market Basket</td>
                <td style={td}>{symbolLabel} · {job.market_data.timeframe}</td>
              </tr>
              <tr>
                <td style={tdStrong}>Tested Period</td>
                <td style={td}>{job.market_data.start_date} → {job.market_data.end_date}</td>
              </tr>
              <tr>
                <td style={tdStrong}>Data Throughput</td>
                <td style={td}>{rowLabel}</td>
              </tr>
              <tr>
                <td style={tdStrong}>Synthetic Data</td>
                <td style={{ ...td, color: "#4ade80", fontWeight: 700 }}>STRICTLY DISABLED (100% Real Data)</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Risk-Adjusted & Robustness Metrics */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px", color: "#f8fafc" }}>
          Risk-Adjusted Ratios & Statistical Robustness
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <Kpi label="Sharpe Ratio" value={metric(ra.sharpe)} />
          <Kpi label="Sortino Ratio" value={metric(ra.sortino)} />
          <Kpi label="Calmar Ratio" value={metric(ra.calmar)} />
          <Kpi label="Recovery Factor" value={metric(ra.recovery_factor)} />
          <Kpi label="Trade Expectancy" value={metric(ex.expectancy_R_per_trade, " R")} color={signedClass(ex.expectancy_R_per_trade)} />
          <Kpi label="Avg Win / Loss" value={`${metric(ex.average_winner_R, "R")} / ${metric(ex.average_loser_R, "R")}`} />
          <Kpi label="Max Streak (W / L)" value={`${risk.max_consecutive_wins ?? 0} / ${risk.max_consecutive_losses ?? 0}`} />
          <Kpi label="Overfitting Risk" value={robust.overfitting_risk_label || "Low"} color="#4ade80" />
        </div>
        {warnings.length > 0 && (
          <div style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.25)", borderRadius: 10, padding: "12px 16px", marginTop: 14, color: "#fbbf24", fontSize: 12 }}>
            <strong>Risk Warnings:</strong>
            <ul style={{ margin: "4px 0 0 18px", lineHeight: 1.6 }}>
              {warnings.map((w: string) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Detailed execution metrics table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)", color: "#94a3b8", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", fontSize: 11, textTransform: "uppercase" }}>Metric</th>
              <th style={{ padding: "10px 12px", fontSize: 11, textTransform: "uppercase" }}>Value</th>
              <th style={{ padding: "10px 12px", fontSize: 11, textTransform: "uppercase" }}>Quant Significance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([a, b, c]) => (
              <tr key={String(a)}>
                <td style={{ ...tdStrong, width: 280 }}>{a}</td>
                <td style={{ ...td, fontWeight: 700, color: "#f8fafc" }}>{b ?? 0}</td>
                <td style={{ ...td, color: "#94a3b8" }}>{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    ["Strategy Identifier", payload.user_strategy_id],
    ["Active Markets", payload.symbols?.join(", ")],
    ["Execution Timeframe", `${payload.timeframe} (${payload.bar_seconds}s bars)`],
    ["Breakout Lookback", `${payload.strategy.breakout_lookback} bars`],
    ["Retest Tolerance", `${payload.strategy.retest_tolerance_pct} (${Number(payload.strategy.retest_tolerance_pct) * 100}%)`],
    ["Minimum Setup Score", `${payload.strategy.min_setup_score} / 10`],
    [
      "Stop-Loss Rule",
      `${payload.strategy.stop_loss.type} · ATR Multiplier ${payload.strategy.stop_loss.atr_multiplier}`,
    ],
    [
      "Target Architecture",
      `Target 1: ${payload.strategy.targets.target1_R}R · Target 2: ${payload.strategy.targets.target2_R}R`,
    ],
    ["Risk Per Trade", `${payload.strategy.risk.risk_per_trade_pct}% of equity`],
    ["Setup TTL Expiry", `${payload.strategy.ttl_bars} bars`],
    ["Re-Entry Discipline", payload.strategy.reentry.enabled ? "Enabled" : "Disabled"],
    ["Max Allowed Re-Entries", payload.strategy.reentry.max_reentries],
    ["Re-Entry Cooldown", `${payload.strategy.reentry.cooldown_bars} bars`],
    ["Signal Cooldown", `${payload.strategy.signal_cooldown_bars} bars`],
    [
      "HTF Trend Filter",
      payload.strategy.trend_filter.use_trend_filter
        ? `${payload.strategy.trend_filter.higher_timeframe} EMA${payload.strategy.trend_filter.fast_ema} > EMA${payload.strategy.trend_filter.slow_ema}`
        : "Disabled",
    ],
  ];

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(22, 32, 51, 0.75) 0%, rgba(16, 24, 39, 0.95) 100%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 18,
        padding: 28,
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.25)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#ffffff" }}>
            Active Strategy Configuration Summary
          </h2>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
            Validated system specifications registered for backtest and live paper trading engines
          </p>
        </div>
        {strategyId && (
          <span style={{ fontSize: 11, color: "#a5b4fc", background: "rgba(99, 102, 241, 0.15)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(99, 102, 241, 0.3)" }}>
            Database ID: {strategyId.slice(0, 8)}...
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
    </div>
  );
}
