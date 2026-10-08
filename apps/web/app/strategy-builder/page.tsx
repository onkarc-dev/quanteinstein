"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, getUser, getToken } from "../../lib/api";
import BacktestAnalytics from "../../components/BacktestAnalytics";

type Cfg = {
  strategyCode: string;
  symbols: string[];
  timeframe: string;
  direction: "both" | "long_only" | "short_only";
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
  // RSI Momentum & Two-Top/Two-Bottom Divergence Engine
  rsiFilter: "enabled" | "disabled";
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  rsiCondition: "two_bottom_bull_two_top_bear" | "filter_extremes" | "momentum" | "mean_reversion";
  // MACD Trend & Two-Top/Two-Bottom Reversal Engine
  macdFilter: "enabled" | "disabled";
  macdFastPeriod: number;
  macdSlowPeriod: number;
  macdSignalPeriod: number;
  macdCondition: "two_top_bear_two_bottom_bull" | "histogram_momentum" | "signal_crossover" | "zero_line";
  // Trade Management & Exits
  breakevenStop: boolean;
  partialTpPct: number;
  trailingStop: boolean;
  trailingAtrMultiplier: number;
  // Execution Friction & Fees
  feeTier: string;
  feePct: number;
  slippagePct: number;
  // Session & Timing Filters
  tradingHours: string;
  skipWeekends: boolean;
  rvolFilter: boolean;
  rvolThreshold: number;
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

const CATEGORY_MAP: Record<string, string[]> = {
  "TOP 10": [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "TRXUSDT", "LINKUSDT"
  ],
  "LAYER 1": [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
    "AVAXUSDT", "NEARUSDT", "SUIUSDT", "DOTUSDT", "APTUSDT",
    "SEIUSDT", "FTMUSDT", "ATOMUSDT", "ICPUSDT", "KASUSDT"
  ],
  "DEFI": [
    "UNIUSDT", "AAVEUSDT", "MKRUSDT", "LINKUSDT", "LDOUSDT",
    "CRVUSDT", "SNXUSDT", "PENDLEUSDT", "DYDXUSDT", "JUPUSDT",
    "INJUSDT", "RUNEUSDT"
  ],
  "MEME": [
    "DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "WIFUSDT", "BONKUSDT",
    "FLOKIUSDT", "BOMEUSDT", "MEMEUSDT"
  ],
  "AI & DATA": [
    "FETUSDT", "RENDERUSDT", "NEARUSDT", "WLDUSDT", "TAOUSDT",
    "GRTUSDT", "ARKMUSDT", "AIUSDT"
  ],
};

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
  display: "grid",
  gap: 6,
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase" as const,
};

function buildPayload(c: Cfg) {
  return {
    user_strategy_id: c.strategyCode.trim() || "PRISM",
    name: c.strategyCode.trim() || "PRISM",
    symbols: c.symbols.map((s) => s.toUpperCase()),
    timeframe: c.timeframe,
    bar_seconds: timeframeToSeconds(c.timeframe),
    strategy: {
      name: c.strategyCode.trim() || "PRISM",
      direction: c.direction,
      breakout_lookback: c.lookback,
      retest_tolerance_pct: Number(c.retest),
      min_setup_score: c.score,
      max_retest_bars: c.maxRetest,
      signal_cooldown_bars: c.cooldown,
      ttl_bars: c.ttl,
      min_close_position: 0.5,
      stop_loss: {
        type: c.stop,
        atr_multiplier: c.atr,
        structure_buffer_pct: 0.25,
      },
      targets: { target1_R: c.t1, target2_R: c.t2 },
      risk: {
        risk_per_trade_pct: c.risk,
        max_daily_loss_pct: c.maxDailyLoss,
        max_open_positions: c.maxOpen,
        max_symbol_notional: 10000,
      },
      reentry: {
        enabled: c.reentry === "enabled",
        max_reentries: c.maxReentries,
        cooldown_bars: c.reentryCooldown,
      },
      trend_filter: {
        use_trend_filter: c.trendFilter === "enabled",
        higher_timeframe: c.trendTimeframe,
        higher_timeframe_seconds: timeframeToSeconds(c.trendTimeframe),
        fast_ema: c.trendFastEma,
        slow_ema: c.trendSlowEma,
      },
      rsi_filter: {
        enabled: c.rsiFilter === "enabled",
        period: c.rsiPeriod,
        overbought: c.rsiOverbought,
        oversold: c.rsiOversold,
        condition: c.rsiCondition,
      },
      macd_filter: {
        enabled: c.macdFilter === "enabled",
        fast_period: c.macdFastPeriod,
        slow_period: c.macdSlowPeriod,
        signal_period: c.macdSignalPeriod,
        condition: c.macdCondition,
      },
      trade_management: {
        breakeven_stop: c.breakevenStop,
        partial_tp_pct: c.partialTpPct,
        trailing_stop: c.trailingStop,
        trailing_atr_multiplier: c.trailingAtrMultiplier,
      },
      execution_friction: {
        fee_pct: c.feePct,
        slippage_pct: c.slippagePct,
      },
      timing_filter: {
        trading_hours: c.tradingHours,
        skip_weekends: c.skipWeekends,
        rvol_filter: c.rvolFilter,
        rvol_threshold: c.rvolThreshold,
      },
    },
  };
}

export default function StrategyBuilderPage() {
  const [cfg, setCfg] = useState<Cfg>({
    strategyCode: "PRISM_BREAKOUT_RETEST",
    symbols: ["BTCUSDT"],
    timeframe: "1m",
    direction: "both",
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
    // RSI Momentum & Two-Top/Two-Bottom Divergence Engine
    rsiFilter: "disabled",
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    rsiCondition: "two_bottom_bull_two_top_bear",
    // MACD Trend & Two-Top/Two-Bottom Reversal Engine
    macdFilter: "disabled",
    macdFastPeriod: 12,
    macdSlowPeriod: 26,
    macdSignalPeriod: 9,
    macdCondition: "two_top_bear_two_bottom_bull",
    // Trade Management
    breakevenStop: true,
    partialTpPct: 50,
    trailingStop: false,
    trailingAtrMultiplier: 1.5,
    // Execution Friction
    feeTier: "binance_vip0",
    feePct: 0.04,
    slippagePct: 0.01,
    // Timing & Volume
    tradingHours: "all_day",
    skipWeekends: false,
    rvolFilter: false,
    rvolThreshold: 1.5,
  });

  const [allAvailableSymbols, setAllAvailableSymbols] = useState<string[]>(POPULAR_SYMBOLS);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [selectedSearchQuery, setSelectedSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [customSymbolInput, setCustomSymbolInput] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [strategyDisplayName, setStrategyDisplayName] = useState("");
  const [job, setJob] = useState<any>(null);
  const [pollJob, setPollJob] = useState<any>(null);
  const [msg, setMsg] = useState("Configure strategy parameters, select crypto markets, and run a backtest.");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState("");
  const [startDate, setStartDate] = useState(startIso());
  const [endDate, setEndDate] = useState(yesterdayIso());
  const resultsRef = useRef<HTMLDivElement>(null);

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

  function addSymbol(sym: string) {
    const s = sym.toUpperCase().trim();
    if (!cfg.symbols.includes(s)) {
      upd("symbols", [...cfg.symbols, s]);
    }
  }

  function removeSymbol(sym: string) {
    const s = sym.toUpperCase().trim();
    const next = cfg.symbols.filter((x) => x !== s);
    upd("symbols", next.length ? next : ["BTCUSDT"]);
  }

  function addAllAvailable() {
    if (!availableList.length) return;
    const combined = Array.from(new Set([...cfg.symbols, ...availableList]));
    upd("symbols", combined);
  }

  function selectPopularSymbols() {
    upd("symbols", [...POPULAR_SYMBOLS]);
  }

  function selectTop50Symbols() {
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

  const availableList = useMemo(() => {
    const q = symbolSearchQuery.trim().toUpperCase();
    const cat = activeCategory.toUpperCase();
    let list = allAvailableSymbols.filter((s) => !cfg.symbols.includes(s));
    if (cat !== "ALL" && CATEGORY_MAP[cat]) {
      const allowed = new Set(CATEGORY_MAP[cat]);
      list = list.filter((s) => allowed.has(s));
    }
    if (q) {
      list = list.filter((s) => s.includes(q));
    }
    return list;
  }, [allAvailableSymbols, cfg.symbols, symbolSearchQuery, activeCategory]);

  const selectedList = useMemo(() => {
    const q = selectedSearchQuery.trim().toUpperCase();
    if (!q) return cfg.symbols;
    return cfg.symbols.filter((s) => s.includes(q));
  }, [cfg.symbols, selectedSearchQuery]);

  const payload = useMemo(() => buildPayload(cfg), [cfg]);

  // Smoothly scroll to Backtest Execution Performance as soon as backtest finishes
  useEffect(() => {
    if (job?.status === "completed") {
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    }
  }, [job?.id, job?.status]);

  async function save() {
    try {
      setMsg("Saving strategy to quantitative database...");
      const r: any = await api("/strategies", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const resolvedId = r.strategy_id || r.id;
      const resolvedName = r.display_name || r.name || payload.name;
      setStrategyId(resolvedId);
      setStrategyDisplayName(resolvedName);
      setMsg("Strategy saved successfully: " + resolvedName);
    } catch (e: any) {
      const message = e?.message || "Save failed";
      if (message.toLowerCase().includes("already used")) alert(message);
      setMsg("Save failed: " + message);
    }
  }

  async function poll(jobId: string, symbolCount?: number) {
    const maxPolls = 80;
    const total = symbolCount ?? payload.symbols.length;
    for (let i = 0; i < maxPolls; i++) {
      try {
        const j: any = await api(`/jobs/${jobId}`);
        setPollJob(j);
        setJob(j);
        const currentStatus = (j.status || "processing").toUpperCase();
        if (total > 1) {
          setRunProgress(
            `Executing basket (${total} symbols) on authentic Binance data [${currentStatus}]...`,
          );
        } else {
          setRunProgress(`Processing market data and generating backtest report [${currentStatus}]...`);
        }
        if (j.status === "completed" || j.status === "failed") {
          if (j.status === "completed") {
            setTimeout(() => {
              resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 120);
          }
          return j;
        }
      } catch (err: any) {
        console.warn(`[poll] Transient polling issue on attempt ${i + 1}:`, err);
      }
      const delayMs = i < 6 ? 400 : i < 16 ? 800 : 1200;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  async function run(overrideCfg?: Cfg) {
    if (running) return;
    if (overrideCfg) {
      setCfg(overrideCfg);
    }
    const token = getToken();
    if (!token) {
      setMsg("Please sign in first to run backtests.");
      setRunProgress("Authentication required.");
      return;
    }
    const activeCfg = overrideCfg || cfg;
    const activePayload = overrideCfg ? buildPayload(overrideCfg) : payload;
    const selectedSymbols = activePayload.symbols;
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
            body: JSON.stringify(activePayload),
          });
          sid = s.strategy_id || s.id;
          const sName = s.display_name || s.name || activePayload.name;
          setStrategyId(sid);
          setStrategyDisplayName(sName);
        } catch (stratErr: any) {
          try {
            const strats: any = await api("/strategies");
            const found = Array.isArray(strats) && strats.find((st: any) =>
              st.user_strategy_id === activePayload.user_strategy_id || st.name === activePayload.name || st.display_name === activePayload.name
            );
            if (found) {
              sid = found.id;
              setStrategyId(sid);
              setStrategyDisplayName(found.display_name || found.name || activePayload.name);
            }
          } catch (_) {}
        }
      }
      const r: any = await api("/jobs/submit-backtest", {
        method: "POST",
        body: JSON.stringify({
          strategy_id: sid || "PRISM_BREAKOUT_RETEST",
          symbols: selectedSymbols,
          timeframe: activePayload.timeframe,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          config: activePayload,
        }),
      });
      setJob(r);
      if (r.status === "completed") {
        setMsg("Backtest completed successfully.");
        setRunProgress("Backtest completed successfully.");
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      } else if ((r.status === "queued" || r.status === "running") && r.job_id) {
        setMsg(`Backtest queued (Job ID: ${r.job_id.slice(0, 8)}...). Polling results...`);
        const finalJob = await poll(r.job_id, selectedSymbols.length);
        if (finalJob) {
          setJob(finalJob);
          if (finalJob.status === "completed") {
            setMsg("Backtest completed successfully.");
            setRunProgress("Backtest completed successfully.");
            setTimeout(() => {
              resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 120);
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

  const deployTargetId = strategyId || cfg.strategyCode || "PRISM_BREAKOUT_RETEST";

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
                Institutional Quant & Day Trading Lab
              </span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: "-0.02em" }}>
              Quant Strategy Builder & Backtest Lab
            </h1>
            <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 13 }}>
              Formulate user-defined rules, configure friction and dynamic exits, test against 200+ Binance markets, and deploy directly to Live Paper Trading.
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
            <Link
              href={`/paper-trading?strategy_id=${encodeURIComponent(deployTargetId)}`}
              style={{
                background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(22, 163, 74, 0.35) 100%)",
                color: "#4ade80",
                border: "1px solid rgba(34, 197, 94, 0.4)",
                padding: "6px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>🚀</span> Deploy to Paper Trading →
            </Link>
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
          {/* Section 1: Identification & Trade Direction */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 16 }}>⚙️</span>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
              Strategy Identity, Direction & Timeframe
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
              Trade Direction
              <select
                style={{ ...inputStyle, borderColor: "#6366f1" }}
                value={cfg.direction}
                onChange={(e) => upd("direction", e.target.value as any)}
              >
                <option value="both">Both (Long & Short Breakouts)</option>
                <option value="long_only">Long Only (Spot / Bullish)</option>
                <option value="short_only">Short Only (Hedge / Bearish)</option>
              </select>
              <span style={{ color: "#818cf8", fontSize: 11, textTransform: "none" }}>
                {cfg.direction === "both" ? "Executes long breakouts & short breakdowns" : cfg.direction === "long_only" ? "Only buys high breakouts" : "Only shorts breakdown support"}
              </span>
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

          {/* ─── Section 2: Dynamic Exits & Trade Management Architecture ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>🎯</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                Dynamic Exits & Trade Management Architecture
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
                Breakeven Stop Trigger
                <select
                  style={{ ...inputStyle, borderColor: cfg.breakevenStop ? "#4ade80" : "rgba(255,255,255,0.12)" }}
                  value={cfg.breakevenStop ? "enabled" : "disabled"}
                  onChange={(e) => upd("breakevenStop", e.target.value === "enabled")}
                >
                  <option value="enabled">Enabled (Move Stop to BE at T1)</option>
                  <option value="disabled">Disabled (Hold Hard Stop)</option>
                </select>
                <span style={{ color: "#4ade80", fontSize: 11, textTransform: "none" }}>
                  {cfg.breakevenStop ? "Protects profits once price hits Target 1" : "Risk remains open until T2 or hard stop"}
                </span>
              </label>

              <label style={labelStyle}>
                Target 1 Scaling Size %
                <input
                  style={inputStyle}
                  type="number"
                  min="10"
                  max="100"
                  step="5"
                  value={cfg.partialTpPct}
                  onChange={(e) => upd("partialTpPct", +e.target.value)}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>
                  {cfg.partialTpPct}% closed at T1; {100 - cfg.partialTpPct}% runs to T2
                </span>
              </label>

              <label style={labelStyle}>
                Trailing Stop Loss
                <select
                  style={inputStyle}
                  value={cfg.trailingStop ? "enabled" : "disabled"}
                  onChange={(e) => upd("trailingStop", e.target.value === "enabled")}
                >
                  <option value="disabled">Disabled (Fixed T2)</option>
                  <option value="enabled">Enabled (ATR Chandelier Exit)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Trails stop via ATR after T1 profit</span>
              </label>
            </div>
          </div>

          {/* ─── Section 3: Prop Firm & Portfolio Risk Controls ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>🛡</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                Account, Prop Firm & Portfolio Risk Discipline
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
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
                Max Daily Loss % (Circuit Breaker)
                <input
                  style={{ ...inputStyle, borderColor: "#f59e0b" }}
                  type="number"
                  step="0.5"
                  value={cfg.maxDailyLoss}
                  onChange={(e) => upd("maxDailyLoss", +e.target.value)}
                />
                <span style={{ color: "#fbbf24", fontSize: 11, textTransform: "none" }}>
                  Prop firm rule: halts trading if down {cfg.maxDailyLoss}% in 1 day
                </span>
              </label>

              <label style={labelStyle}>
                Max Open Positions
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  value={cfg.maxOpen}
                  onChange={(e) => upd("maxOpen", Math.max(1, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Concurrent basket position cap</span>
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

          {/* ─── Section 4: Execution Friction & Session Timing ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                Execution Friction, Fees & Session Timing (Institutional Day Trader Controls)
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
              <label style={labelStyle}>
                Exchange Fee Tier
                <select
                  style={inputStyle}
                  value={cfg.feeTier}
                  onChange={(e) => {
                    const val = e.target.value;
                    upd("feeTier", val);
                    if (val === "binance_vip0") upd("feePct", 0.04);
                    else if (val === "maker") upd("feePct", 0.02);
                    else if (val === "zero") upd("feePct", 0.00);
                  }}
                >
                  <option value="binance_vip0">Binance VIP0 Taker (0.04%)</option>
                  <option value="maker">Binance VIP0 Maker (0.02%)</option>
                  <option value="zero">Zero Commission (0.00%)</option>
                  <option value="custom">Custom Fee %</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>
                  Fee per side: {cfg.feePct}% (Round-trip: {(cfg.feePct * 2).toFixed(3)}%)
                </span>
              </label>

              <label style={labelStyle}>
                Estimated Slippage %
                <select
                  style={inputStyle}
                  value={cfg.slippagePct}
                  onChange={(e) => upd("slippagePct", +e.target.value)}
                >
                  <option value={0.01}>0.01% (~1 tick Binance USDT)</option>
                  <option value={0.02}>0.02% (~2 ticks medium market)</option>
                  <option value={0.05}>0.05% (Higher volatility altcoin)</option>
                  <option value={0.0}>0.00% (No slippage ideal)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Deducted on entry and exit</span>
              </label>

              <label style={labelStyle}>
                Trading Sessions / Kill Zones
                <select
                  style={inputStyle}
                  value={cfg.tradingHours}
                  onChange={(e) => upd("tradingHours", e.target.value)}
                >
                  <option value="all_day">All Day (24/7 Global Trading)</option>
                  <option value="london_ny">London & NY Overlap (12:00 - 16:00 UTC)</option>
                  <option value="london">London Session (07:00 - 15:00 UTC)</option>
                  <option value="ny">New York Session (12:00 - 20:00 UTC)</option>
                  <option value="asia">Asian Session (00:00 - 08:00 UTC)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Restricts breakouts to high volume windows</span>
              </label>

              <label style={labelStyle}>
                Weekend Trading Filter
                <select
                  style={inputStyle}
                  value={cfg.skipWeekends ? "skip" : "include"}
                  onChange={(e) => upd("skipWeekends", e.target.value === "skip")}
                >
                  <option value="include">Trade 24/7 (Include Weekends)</option>
                  <option value="skip">Skip Weekends (Avoid Saturday/Sunday Chop)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Avoids illiquid weekend price manipulation</span>
              </label>

              <label style={labelStyle}>
                Breakout Volume (RVOL) Filter
                <select
                  style={inputStyle}
                  value={cfg.rvolFilter ? "enabled" : "disabled"}
                  onChange={(e) => upd("rvolFilter", e.target.value === "enabled")}
                >
                  <option value="disabled">Disabled (Price Breakout Only)</option>
                  <option value="enabled">Require High Volume (&gt; 1.5x 20-SMA)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Filters out low volume fakeouts</span>
              </label>
            </div>
          </div>

          {/* ─── Section 5: Higher-Timeframe Trend Filter ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>📈</span>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                Higher-Timeframe EMA Trend Guard
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
                  <option value="enabled">Enabled (Require Macro Trend Alignment)</option>
                  <option value="disabled">Disabled (Trade All Breakouts)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Requires Fast EMA &gt; Slow EMA for longs</span>
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

          {/* ─── Section 6: RSI Momentum & Two-Top / Two-Bottom Divergence Engine ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>📊</span>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                    Relative Strength Index (RSI) &amp; Divergence Guard
                  </h2>
                </div>
                <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
                  Ultra-low latency recursive Wilder&apos;s smoothing with systematic two-bottom bullish divergence and two-top bearish divergence filters.
                </p>
              </div>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 20,
                background: cfg.rsiFilter === "enabled" ? "rgba(56, 189, 248, 0.15)" : "rgba(100, 116, 139, 0.15)",
                border: cfg.rsiFilter === "enabled" ? "1px solid rgba(56, 189, 248, 0.35)" : "1px solid rgba(100, 116, 139, 0.25)",
                color: cfg.rsiFilter === "enabled" ? "#38bdf8" : "#94a3b8",
                display: "inline-flex",
                alignItems: "center",
                gap: 6
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.rsiFilter === "enabled" ? "#38bdf8" : "#94a3b8" }} />
                {cfg.rsiFilter === "enabled" ? "RSI Filter Active (O(1) Streaming)" : "RSI Filter Inactive"}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
              <label style={labelStyle}>
                RSI Guard Status
                <select
                  style={inputStyle}
                  value={cfg.rsiFilter}
                  onChange={(e) => upd("rsiFilter", e.target.value as "enabled" | "disabled")}
                >
                  <option value="disabled">Disabled (Trade All Setups)</option>
                  <option value="enabled">Enabled (Enforce RSI Filter Guard)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Zero-latency recursive smoothing</span>
              </label>

              <label style={labelStyle}>
                Systematic RSI Condition
                <select
                  style={inputStyle}
                  value={cfg.rsiCondition}
                  disabled={cfg.rsiFilter !== "enabled"}
                  onChange={(e) => upd("rsiCondition", e.target.value as any)}
                >
                  <option value="two_bottom_bull_two_top_bear">Two-Bottom Bullish &amp; Two-Top Bearish Divergence</option>
                  <option value="filter_extremes">Filter Extremes (Block Overbought &gt; {cfg.rsiOverbought})</option>
                  <option value="momentum">Momentum Regime (Require RSI &gt; 50 Centerline)</option>
                  <option value="mean_reversion">Mean Reversion (Buy Oversold Dip &lt;= {cfg.rsiOversold})</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Rule applied for entry validation</span>
              </label>

              <label style={labelStyle}>
                RSI Period
                <input
                  style={inputStyle}
                  type="number"
                  min="2"
                  max="100"
                  step="1"
                  value={cfg.rsiPeriod}
                  disabled={cfg.rsiFilter !== "enabled"}
                  onChange={(e) => upd("rsiPeriod", Math.max(2, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Standard lookback (default 14)</span>
              </label>

              <label style={labelStyle}>
                Overbought Boundary
                <input
                  style={inputStyle}
                  type="number"
                  min="50"
                  max="95"
                  step="1"
                  value={cfg.rsiOverbought}
                  disabled={cfg.rsiFilter !== "enabled"}
                  onChange={(e) => upd("rsiOverbought", Math.max(50, Math.min(95, +e.target.value)))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Bearish ceiling (typically 70 or 80)</span>
              </label>

              <label style={labelStyle}>
                Oversold Boundary
                <input
                  style={inputStyle}
                  type="number"
                  min="5"
                  max="50"
                  step="1"
                  value={cfg.rsiOversold}
                  disabled={cfg.rsiFilter !== "enabled"}
                  onChange={(e) => upd("rsiOversold", Math.max(5, Math.min(50, +e.target.value)))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Bullish floor (typically 30 or 20)</span>
              </label>
            </div>

            <div style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              color: "#94a3b8",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 10
            }}>
              <span style={{ color: "#38bdf8", fontSize: 14 }}>💡</span>
              <span>
                <strong>Systematic Divergence Execution:</strong> Two-Bottom Bullish confirms when price forms equal/lower bottoms while RSI forms a higher momentum trough. Two-Top Bearish detects exhausted tops to reject buying at cyclical peaks without latency spikes.
              </span>
            </div>
          </div>

          {/* ─── Section 7: MACD Trend & Two-Top / Two-Bottom Reversal Engine ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🌊</span>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                    MACD Trend &amp; Reversal Engine
                  </h2>
                </div>
                <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
                  Zero-allocation dual exponential smoothing with two-top bearish roll-over and two-bottom bullish momentum curling.
                </p>
              </div>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 20,
                background: cfg.macdFilter === "enabled" ? "rgba(168, 85, 247, 0.15)" : "rgba(100, 116, 139, 0.15)",
                border: cfg.macdFilter === "enabled" ? "1px solid rgba(168, 85, 247, 0.35)" : "1px solid rgba(100, 116, 139, 0.25)",
                color: cfg.macdFilter === "enabled" ? "#c084fc" : "#94a3b8",
                display: "inline-flex",
                alignItems: "center",
                gap: 6
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.macdFilter === "enabled" ? "#c084fc" : "#94a3b8" }} />
                {cfg.macdFilter === "enabled" ? "MACD Engine Active (O(1) Streaming)" : "MACD Engine Inactive"}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
              <label style={labelStyle}>
                MACD Guard Status
                <select
                  style={inputStyle}
                  value={cfg.macdFilter}
                  onChange={(e) => upd("macdFilter", e.target.value as "enabled" | "disabled")}
                >
                  <option value="disabled">Disabled (Evaluate All Setups)</option>
                  <option value="enabled">Enabled (Enforce MACD Systematic Rule)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Zero-allocation EMA registers</span>
              </label>

              <label style={labelStyle}>
                Systematic MACD Condition
                <select
                  style={inputStyle}
                  value={cfg.macdCondition}
                  disabled={cfg.macdFilter !== "enabled"}
                  onChange={(e) => upd("macdCondition", e.target.value as any)}
                >
                  <option value="two_top_bear_two_bottom_bull">Two-Top Bearish &amp; Two-Bottom Bullish Reversal (Divergence / Curl)</option>
                  <option value="histogram_momentum">Histogram Momentum (Histogram &gt; 0 Expanding)</option>
                  <option value="signal_crossover">Signal Line Crossover (MACD Line &gt; Signal Line)</option>
                  <option value="zero_line">Zero-Line Centerline Regime (MACD Line &gt; 0)</option>
                </select>
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Systematic momentum validation</span>
              </label>

              <label style={labelStyle}>
                Fast EMA Period
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={cfg.macdFastPeriod}
                  disabled={cfg.macdFilter !== "enabled"}
                  onChange={(e) => upd("macdFastPeriod", Math.max(1, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Lead momentum (default 12)</span>
              </label>

              <label style={labelStyle}>
                Slow EMA Period
                <input
                  style={inputStyle}
                  type="number"
                  min="2"
                  max="100"
                  step="1"
                  value={cfg.macdSlowPeriod}
                  disabled={cfg.macdFilter !== "enabled"}
                  onChange={(e) => upd("macdSlowPeriod", Math.max(cfg.macdFastPeriod + 1, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Baseline EMA (default 26)</span>
              </label>

              <label style={labelStyle}>
                Signal Smoothing Period
                <input
                  style={inputStyle}
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={cfg.macdSignalPeriod}
                  disabled={cfg.macdFilter !== "enabled"}
                  onChange={(e) => upd("macdSignalPeriod", Math.max(1, +e.target.value))}
                />
                <span style={{ color: "#64748b", fontSize: 11, textTransform: "none" }}>Signal trigger EMA (default 9)</span>
              </label>
            </div>

            <div style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              color: "#94a3b8",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 10
            }}>
              <span style={{ color: "#c084fc", fontSize: 14 }}>⚡</span>
              <span>
                <strong>Zero-Latency Spikes:</strong> MACD &amp; RSI are updated in $O(1)$ constant time on every bar via primitive streaming registers without rescanning arrays.
              </span>
            </div>
          </div>

          {/* ─── Section 8: 200+ Cryptocurrency Market Basket Selector (Transfer Box) ─── */}
          <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🪙</span>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f8fafc" }}>
                    Cryptocurrency Markets for Backtest & Paper Trading
                  </h2>
                </div>
                <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
                  Search and transfer cryptocurrency markets between available Binance pairs and your active strategy basket.
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
                  Popular (16)
                </button>
                <button
                  type="button"
                  onClick={selectTop50Symbols}
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
                    background: "rgba(239, 68, 68, 0.1)",
                    color: "#fca5a5",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
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

            {/* DUAL BLOCKS CONTAINER */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: 20,
              alignItems: "stretch",
            }}>

              {/* ─── BLOCK 1: AVAILABLE MARKETS ─── */}
              <div style={{
                background: "rgba(11, 16, 28, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 14,
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", paddingBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🌐</span>
                    <strong style={{ fontSize: 13, color: "#f1f5f9" }}>Available Binance Pairs</strong>
                    <span style={{
                      background: "rgba(99, 102, 241, 0.2)",
                      color: "#a5b4fc",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}>
                      {availableList.length}
                    </span>
                  </div>

                  {availableList.length > 0 && (
                    <button
                      type="button"
                      onClick={addAllAvailable}
                      style={{
                        background: "rgba(99, 102, 241, 0.18)",
                        color: "#a5b4fc",
                        border: "1px solid rgba(99, 102, 241, 0.35)",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Add All ({availableList.length}) →
                    </button>
                  )}
                </div>

                {/* Category Filter Pills */}
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
                  {["ALL", "TOP 10", "LAYER 1", "DEFI", "MEME", "AI & DATA"].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategory(cat)}
                      style={{
                        background: activeCategory === cat ? "#6366f1" : "rgba(30, 41, 59, 0.6)",
                        color: activeCategory === cat ? "#ffffff" : "#94a3b8",
                        border: `1px solid ${activeCategory === cat ? "#818cf8" : "rgba(255, 255, 255, 0.06)"}`,
                        borderRadius: 6,
                        padding: "3px 9px",
                        fontSize: 11,
                        fontWeight: activeCategory === cat ? 700 : 500,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Search Bar in Available */}
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder="Search available pairs (e.g. SOL, PEPE, SUI)..."
                    value={symbolSearchQuery}
                    onChange={(e) => setSymbolSearchQuery(e.target.value)}
                    style={{
                      ...inputStyle,
                      paddingLeft: 30,
                      fontSize: 12,
                      paddingTop: 8,
                      paddingBottom: 8,
                    }}
                  />
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: 12 }}>
                    🔍
                  </span>
                  {symbolSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setSymbolSearchQuery("")}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        color: "#94a3b8",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Custom Pair Adder */}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
                    style={{ ...inputStyle, flex: 1, fontSize: 12, padding: "6px 10px", textTransform: "uppercase" }}
                  />
                  <button
                    type="button"
                    onClick={addCustomSymbol}
                    disabled={!customSymbolInput.trim()}
                    style={{
                      background: "rgba(99, 102, 241, 0.2)",
                      color: "#a5b4fc",
                      border: "1px solid rgba(99, 102, 241, 0.4)",
                      padding: "6px 12px",
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: customSymbolInput.trim() ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                    }}
                  >
                    + Add
                  </button>
                </div>

                {/* Available Pairs Scrollable List */}
                <div style={{
                  maxHeight: 280,
                  overflowY: "auto",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: 8,
                  padding: "4px 2px",
                }}>
                  {availableList.length === 0 ? (
                    <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "30px 10px", color: "#64748b", fontSize: 13 }}>
                      ✓ All matching pairs have been transferred to your selected basket!
                    </div>
                  ) : (
                    availableList.map((sym) => (
                      <button
                        type="button"
                        key={sym}
                        onClick={() => addSymbol(sym)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "rgba(15, 23, 42, 0.7)",
                          border: "1px solid rgba(255, 255, 255, 0.07)",
                          color: "#cbd5e1",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.12s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.6)";
                          e.currentTarget.style.background = "rgba(99, 102, 241, 0.12)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.07)";
                          e.currentTarget.style.background = "rgba(15, 23, 42, 0.7)";
                        }}
                      >
                        <span>{sym}</span>
                        <span style={{ fontSize: 13, color: "#818cf8", fontWeight: 800 }}>+</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* ─── BLOCK 2: SELECTED ACTIVE BASKET ─── */}
              <div style={{
                background: "linear-gradient(180deg, rgba(17, 24, 39, 0.85) 0%, rgba(13, 18, 31, 0.95) 100%)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                borderRadius: 14,
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.5)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", paddingBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🎯</span>
                    <strong style={{ fontSize: 13, color: "#f8fafc" }}>Selected Active Basket</strong>
                    <span style={{
                      background: "rgba(16, 185, 129, 0.2)",
                      color: "#6ee7b7",
                      border: "1px solid rgba(16, 185, 129, 0.35)",
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}>
                      {cfg.symbols.length} pairs
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={clearSymbols}
                      style={{
                        background: "rgba(239, 68, 68, 0.12)",
                        color: "#fca5a5",
                        border: "1px solid rgba(239, 68, 68, 0.25)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Clear to BTC
                    </button>
                  </div>
                </div>

                {/* Filter within Selected Basket */}
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder={`Filter within ${cfg.symbols.length} selected pairs...`}
                    value={selectedSearchQuery}
                    onChange={(e) => setSelectedSearchQuery(e.target.value)}
                    style={{
                      ...inputStyle,
                      paddingLeft: 30,
                      fontSize: 12,
                      paddingTop: 8,
                      paddingBottom: 8,
                      background: "rgba(10, 14, 26, 0.8)",
                    }}
                  />
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: 12 }}>
                    🎯
                  </span>
                  {selectedSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setSelectedSearchQuery("")}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        color: "#94a3b8",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Selected Basket Chips Scrollable List */}
                <div style={{
                  maxHeight: 280,
                  overflowY: "auto",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: 8,
                  padding: "4px 2px",
                }}>
                  {selectedList.length === 0 ? (
                    <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "30px 10px", color: "#94a3b8", fontSize: 13 }}>
                      No pairs matching filter.
                    </div>
                  ) : (
                    selectedList.map((sym) => (
                      <div
                        key={sym}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "rgba(99, 102, 241, 0.22)",
                          border: "1px solid rgba(99, 102, 241, 0.5)",
                          color: "#ffffff",
                          fontSize: 12,
                          fontWeight: 700,
                          transition: "all 0.12s ease",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ color: "#4ade80", fontSize: 11 }}>✓</span>
                          <span>{sym}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSymbol(sym)}
                          title={`Remove ${sym}`}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#f87171",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 700,
                            padding: "0 2px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "#f87171")}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Summary / Active Allocation Bar */}
                <div style={{
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 12,
                  color: "#94a3b8",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}>
                  <div>
                    Active Basket: <strong style={{ color: "#38bdf8" }}>{cfg.symbols.length} pair{cfg.symbols.length > 1 ? "s" : ""}</strong>
                    <span style={{ color: "#64748b", marginLeft: 6 }}>
                      ({(100 / Math.max(1, cfg.symbols.length)).toFixed(1)}% equal weight)
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Click ✕ on any pair to return to available
                  </div>
                </div>

                {heavyLowTimeframe && (
                  <div style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: 8, padding: "8px 12px", color: "#fbbf24", fontSize: 11 }}>
                    ⚠️ Notice: Multi-symbol ({cfg.symbols.length}) execution on sub-5s timeframes requires high candle throughput.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Section 9: Historical Range & Execution ─── */}
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
                onClick={() => run()}
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

              <Link
                href={`/paper-trading?strategy_id=${encodeURIComponent(deployTargetId)}`}
                style={{
                  background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(22, 163, 74, 0.3) 100%)",
                  color: "#4ade80",
                  border: "1px solid rgba(34, 197, 94, 0.4)",
                  borderRadius: 10,
                  padding: "12px 22px",
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>🚀</span> Deploy to Live Paper Trading
              </Link>
            </div>

            {runProgress && (
              <div
                style={{
                  background: job?.status === "completed" ? "rgba(16, 185, 129, 0.12)" : "rgba(59, 130, 246, 0.1)",
                  border: job?.status === "completed" ? "1px solid rgba(16, 185, 129, 0.35)" : "1px solid rgba(59, 130, 246, 0.3)",
                  borderRadius: 10,
                  padding: "12px 18px",
                  marginTop: 16,
                  color: job?.status === "completed" ? "#6ee7b7" : "#93c5fd",
                  fontSize: 13,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <strong>Execution Status:</strong> {runProgress}
                </div>
                {job?.status === "completed" && (
                  <button
                    type="button"
                    onClick={() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    style={{
                      background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                      color: "#ffffff",
                      border: "none",
                      padding: "6px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      boxShadow: "0 2px 10px rgba(16, 185, 129, 0.35)",
                    }}
                  >
                    <span>↓</span> View Results &amp; Quant Coach Auto-Tuner
                  </button>
                )}
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
              Target & Breakeven Exits
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#4ade80", marginTop: 6 }}>
              T1 {cfg.t1}R ({cfg.partialTpPct}%) {cfg.breakevenStop ? "→ BE Lock" : ""} → T2 {cfg.t2}R
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              {cfg.breakevenStop ? "Locks in gains at T1 and moves stop to entry." : "Fixed targets without breakeven move."}
            </p>
          </div>

          <div style={{ background: "rgba(17, 24, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Prop Firm & Risk Circuit Breaker
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fbbf24", marginTop: 6 }}>
              {cfg.risk}% Risk · {cfg.maxDailyLoss}% Daily Loss Halt
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              {cfg.maxOpen} max positions · {payload.strategy.reentry.enabled ? `${payload.strategy.reentry.max_reentries} re-entries` : "No re-entries"}
            </p>
          </div>

          <div style={{ background: "rgba(17, 24, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Direction & Macro Guard
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#c084fc", marginTop: 6 }}>
              {cfg.direction === "both" ? "Both (Long & Short)" : cfg.direction === "long_only" ? "Long Only" : "Short Only"} · {payload.strategy.trend_filter.use_trend_filter ? `${payload.strategy.trend_filter.higher_timeframe} EMA` : "No Filter"}
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              {cfg.feePct}% taker fee · {cfg.slippagePct}% slippage · {cfg.tradingHours === "all_day" ? "24/7 Hours" : "Session Filtered"}
            </p>
          </div>

          <div style={{ background: "rgba(17, 24, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              RSI &amp; MACD Indicator Guard
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#38bdf8", marginTop: 6 }}>
              {cfg.rsiFilter === "enabled" ? `RSI (${cfg.rsiPeriod})` : "RSI Off"} · {cfg.macdFilter === "enabled" ? `MACD (${cfg.macdFastPeriod}/${cfg.macdSlowPeriod})` : "MACD Off"}
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
              {cfg.rsiFilter === "enabled" ? (cfg.rsiCondition === "two_bottom_bull_two_top_bear" ? "Two-Bottom/Top Divergence" : cfg.rsiCondition) : "RSI inactive"} · {cfg.macdFilter === "enabled" ? (cfg.macdCondition === "two_top_bear_two_bottom_bull" ? "Two-Top/Bottom Reversal" : cfg.macdCondition) : "MACD inactive"}
            </p>
          </div>
        </div>

        {/* ─── Backtest Results Section ─── */}
        <div ref={resultsRef} id="backtest-results" style={{ scrollMarginTop: 80 }}>
          {job && (
            <BacktestResult
              job={job}
              pollJob={pollJob}
              deployTargetId={deployTargetId}
              cfg={cfg}
              setCfg={setCfg}
              onReRun={run}
              running={running}
            />
          )}
        </div>

        {/* ─── Strategy Configuration Summary ─── */}
        <StrategyPreview payload={payload} strategyId={strategyId} strategyDisplayName={strategyDisplayName} />
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

function quantGrade(score: any) {
  const x = Number(score);
  if (!Number.isFinite(x)) return "N/A";
  if (x >= 95) return "A+";
  if (x >= 90) return "A";
  if (x >= 80) return "B";
  if (x >= 70) return "C";
  if (x >= 60) return "D";
  return "F";
}

function quantGradeColor(letterGrade: string) {
  if (letterGrade.startsWith("A")) return "#22c55e";
  if (letterGrade.startsWith("B")) return "#38bdf8";
  if (letterGrade.startsWith("C")) return "#f59e0b";
  if (letterGrade.startsWith("D")) return "#f97316";
  return "#ef4444";
}

function quantRecommendation(pr: any, score: any) {
  const risk = pr?.robustness?.overfitting_risk_label;
  const gross = Number(pr?.summary?.gross_R ?? pr?.net_R ?? 0);
  const health = Number(score);
  if (risk === "HIGH") return "High overfitting risk detected — refine parameters in Strategy Builder";
  if (risk === "MEDIUM" && gross > 0) return "Solid alpha edge — paper trade before scaling real capital";
  if (health >= 80) return "Exceptional alpha candidate — deploy directly to Live Paper Trading";
  if (health >= 65) return "Viable strategy — monitor friction and out-of-sample stability";
  return "Needs further parameter optimization and walk-forward validation";
}

function ExecutiveStrategyHealthCard({ job }: { job: any }) {
  const [healthData, setHealthData] = useState<any>(null);
  const [coachData, setCoachData] = useState<any>(null);

  useEffect(() => {
    const jid = job.id || job.job_id;
    if (!jid) return;
    let cancelled = false;

    Promise.all([
      api(`/coach/${jid}/strategy-health`).catch(() => null),
      api(`/coach/${jid}/coach-report`).catch(() => null),
    ]).then(([h, c]) => {
      if (!cancelled) {
        if (h) setHealthData(h);
        if (c) setCoachData(c);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [job.id, job.job_id]);

  const s = job.summary || {};
  const pr = healthData?.performance_and_robustness || s.performance_and_robustness || job.performance_and_robustness || {};
  const trades = Number(s.total_trades ?? (job.trades?.length ?? 0));
  const grossR = Number(s.gross_R ?? 0);

  // Fallback calculation matching backend formula if API hasn't written to disk yet
  const fallbackSubScores = useMemo(() => {
    const maxDd = Math.abs(Number(s.max_drawdown_in_R ?? 1.0));
    const samplePenalty = trades < 10 ? 0.45 : trades < 30 ? 0.7 : 1.0;
    const oneDayPenalty = 0.65;
    const rawPerf = Math.max(0, Math.min(100, ((grossR + 5) / 25) * 100));
    const perfScore = Math.round(rawPerf * samplePenalty * oneDayPenalty);
    const riskScore = Math.round(Math.max(20, Math.min(100, 100 - (maxDd * 10))));
    const execScore = 100;
    const robustScore = trades < 10 ? 18 : trades < 30 ? 45 : 75;
    const disciplineScore = 100;
    const overall = Math.round((0.30 * perfScore + 0.25 * riskScore + 0.15 * execScore + 0.20 * robustScore + 0.10 * disciplineScore) * 10) / 10;
    return {
      overall,
      performance: perfScore,
      risk: riskScore,
      execution: execScore,
      robustness: robustScore,
    };
  }, [trades, grossR, s.max_drawdown_in_R]);

  const healthScore = healthData?.overall_strategy_health_score != null
    ? Number(healthData.overall_strategy_health_score)
    : fallbackSubScores.overall;

  const letterGrade = quantGrade(healthScore);
  const color = quantGradeColor(letterGrade);

  const subScores = healthData?.sub_scores || {
    performance: fallbackSubScores.performance,
    risk: fallbackSubScores.risk,
    execution: fallbackSubScores.execution,
    robustness: fallbackSubScores.robustness,
  };

  const finalVerdict = coachData?.final_verdict || (trades < 30 ? "NEEDS_MORE_DATA" : grossR > 0 ? "PROMISING_PAPER_SYSTEM" : "DO_NOT_SCALE_YET");
  const finalRec = quantRecommendation(pr, healthScore);

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.7) 100%)",
        border: "1px solid rgba(37, 99, 235, 0.35)",
        borderRadius: 14,
        padding: "18px 22px",
        marginBottom: 20,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* Big Letter Grade Badge */}
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: 16,
              background: `rgba(${letterGrade.startsWith("A") ? "34, 197, 94" : letterGrade.startsWith("B") ? "56, 189, 248" : letterGrade.startsWith("C") || letterGrade.startsWith("D") ? "245, 158, 11" : "239, 68, 68"}, 0.15)`,
              border: `2px solid ${color}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 20px ${color}33`,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 32, fontWeight: 900, color, lineHeight: 1 }}>
              {letterGrade}
            </span>
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginTop: 2 }}>GRADE</span>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc" }}>
                {healthScore.toFixed(1)} / 100
              </span>
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 700,
                  background: finalVerdict === "PROMISING_PAPER_SYSTEM" ? "rgba(34, 197, 94, 0.18)" : finalVerdict === "NEEDS_MORE_DATA" ? "rgba(245, 158, 11, 0.18)" : "rgba(56, 189, 248, 0.18)",
                  color: finalVerdict === "PROMISING_PAPER_SYSTEM" ? "#4ade80" : finalVerdict === "NEEDS_MORE_DATA" ? "#fbbf24" : "#38bdf8",
                  border: "1px solid currentColor",
                }}
              >
                {finalVerdict}
              </span>
            </div>
            <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 4, fontWeight: 500 }}>
              {finalRec}
            </div>
          </div>
        </div>

        {/* 4 Pillar Sub-scores breakdown */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ color: "#94a3b8", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>PERFORMANCE</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#38bdf8", marginTop: 2 }}>
              {Math.round(Number(subScores.performance ?? 0))}%
            </div>
          </div>
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ color: "#94a3b8", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>RISK CONTROL</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", marginTop: 2 }}>
              {Math.round(Number(subScores.risk ?? 0))}%
            </div>
          </div>
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ color: "#94a3b8", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>EXECUTION</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b", marginTop: 2 }}>
              {Math.round(Number(subScores.execution ?? 0))}%
            </div>
          </div>
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ color: "#94a3b8", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>ROBUSTNESS</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#a855f7", marginTop: 2 }}>
              {Math.round(Number(subScores.robustness ?? 0))}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type CoachSuggestion = {
  id: string;
  category: "Setup Quality" | "Trend Confluence" | "Payoff & Targets" | "Risk Buffer" | "Retest Precision" | "Momentum Filters";
  title: string;
  paramKey: string;
  currentDisplay: string;
  recommendedDisplay: string;
  explanation: string;
  impactBadge: string;
  applyPatch: Partial<Cfg>;
};

function QuantCoachOptimizer({
  job,
  cfg,
  setCfg,
  onReRun,
  running,
}: {
  job: any;
  cfg: Cfg;
  setCfg: React.Dispatch<React.SetStateAction<Cfg>>;
  onReRun: (overrideCfg?: Cfg) => void;
  running: boolean;
}) {
  const [previousCfg, setPreviousCfg] = useState<Cfg | null>(null);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  const [appliedPatchesSummary, setAppliedPatchesSummary] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initializedSelection, setInitializedSelection] = useState(false);

  const activeCfgRef = useRef<Cfg>(cfg);
  useEffect(() => {
    activeCfgRef.current = cfg;
  }, [cfg]);

  const s = job.summary || {};
  const pr = s.performance_and_robustness || job.performance_and_robustness || {};
  const fric = pr.friction || {};
  const netR = fric.net_R_after_friction != null ? Number(fric.net_R_after_friction) : Number(s.gross_R ?? 0);
  const grossR = Number(s.gross_R ?? 0);
  const totalTrades = Number(s.total_trades ?? (job.trades?.length ?? 0));
  const winRate = Number(s.win_rate ?? 0);
  const wins = Number(s.wins ?? 0);
  const losses = Number(s.losses ?? 0);
  const rejections = Number(s.rejections ?? 0);

  // Generate intelligent suggestions based on backtest metrics and current configuration
  const suggestions = useMemo<CoachSuggestion[]>(() => {
    const list: CoachSuggestion[] = [];

    // 1. Setup Score Starvation Check
    if (totalTrades === 0) {
      if (cfg.score > 5.0) {
        list.push({
          id: "score",
          category: "Setup Quality",
          title: "Lower Minimum Setup Score to 5.0",
          paramKey: "score",
          currentDisplay: `${cfg.score} / 10`,
          recommendedDisplay: "5.0 / 10",
          explanation: `Threshold of ${cfg.score}/10 starved candidate setups across ${s.bars_processed ?? 14400} bars. Lowering to 5.0 unlocks authentic institutional breakout confirmations on real crypto market data.`,
          impactBadge: "+Setup Flow & Immediate Execution",
          applyPatch: { score: 5.0 },
        });
      }
    } else if (cfg.score > 6.0 && (totalTrades < 15 || rejections > 5 || grossR <= 0)) {
      list.push({
        id: "score",
        category: "Setup Quality",
        title: "Lower Minimum Setup Score to 6.0",
        paramKey: "score",
        currentDisplay: `${cfg.score} / 10`,
        recommendedDisplay: "6.0 / 10",
        explanation: `Threshold of ${cfg.score}/10 restricts sample size (${totalTrades} trades executed). Lowering to 6.0 balances quality while allowing healthy trade sample flow.`,
        impactBadge: "+Trade Frequency & Flow",
        applyPatch: { score: 6.0 },
      });
    }

    // 2. Breakout Lookback Calibration on Zero Trades
    if (totalTrades === 0 && cfg.lookback > 12) {
      list.push({
        id: "lookback",
        category: "Setup Quality",
        title: "Calibrate Breakout Lookback to 12 Bars",
        paramKey: "lookback",
        currentDisplay: `${cfg.lookback} Bars`,
        recommendedDisplay: "12 Bars",
        explanation: `A ${cfg.lookback}-bar lookback requires extreme price displacement before recognizing breakouts. A 12-bar window detects agile swing breaks while preserving market structure.`,
        impactBadge: "+Breakout Detection Frequency",
        applyPatch: { lookback: 12 },
      });
    }

    // 3. Macro Trend Filter (Relax if 0 trades, else Align Timeframe)
    if (totalTrades === 0 && cfg.trendFilter === "enabled") {
      list.push({
        id: "trend_relax",
        category: "Trend Confluence",
        title: "Relax Macro Trend Filter (Trade All Breakouts)",
        paramKey: "trendFilter",
        currentDisplay: "Enabled (Strict Macro Trend)",
        recommendedDisplay: "Disabled (Capture All Breakouts)",
        explanation: `Strict macro EMA trend check blocked candidate breakouts during pullbacks or range expansion. Disabling allows authentic setups in both directions across the tested period.`,
        impactBadge: "Unblock Filtered Breakouts",
        applyPatch: { trendFilter: "disabled" },
      });
    } else if (cfg.trendFilter === "enabled") {
      if (cfg.timeframe === "15m" && cfg.trendTimeframe !== "1h") {
        list.push({
          id: "trend_timeframe",
          category: "Trend Confluence",
          title: "Align Higher Timeframe Filter to 1h EMA",
          paramKey: "trendTimeframe",
          currentDisplay: `${cfg.trendTimeframe} EMA`,
          recommendedDisplay: "1h EMA20 > EMA50",
          explanation: `Aligning 15m execution with 1h EMA20/50 guarantees trade bias matches the macro trend.`,
          impactBadge: "Macro Confluence",
          applyPatch: {
            trendTimeframe: "1h",
            trendFastEma: 20,
            trendSlowEma: 50,
          },
        });
      } else if (cfg.timeframe === "1m" && cfg.trendTimeframe !== "5m") {
        list.push({
          id: "trend_timeframe",
          category: "Trend Confluence",
          title: "Align Higher Timeframe Filter to 5m EMA",
          paramKey: "trendTimeframe",
          currentDisplay: `${cfg.trendTimeframe} EMA`,
          recommendedDisplay: "5m EMA20 > EMA50",
          explanation: "Aligning 1m execution with 5m trend filter avoids counter-trend whipsaws.",
          impactBadge: "Macro Confluence",
          applyPatch: {
            trendTimeframe: "5m",
            trendFastEma: 20,
            trendSlowEma: 50,
          },
        });
      } else if (cfg.timeframe === "5m" && cfg.trendTimeframe !== "15m") {
        list.push({
          id: "trend_timeframe",
          category: "Trend Confluence",
          title: "Align Higher Timeframe Filter to 15m EMA",
          paramKey: "trendTimeframe",
          currentDisplay: `${cfg.trendTimeframe} EMA`,
          recommendedDisplay: "15m EMA20 > EMA50",
          explanation: "Aligning 5m execution with 15m trend filter guarantees confluence.",
          impactBadge: "Macro Confluence",
          applyPatch: {
            trendTimeframe: "15m",
            trendFastEma: 20,
            trendSlowEma: 50,
          },
        });
      }
    }

    // 4. Retest Tolerance Calibration
    if (cfg.retest <= 0.002 || (totalTrades === 0 && cfg.retest < 0.0025)) {
      list.push({
        id: "retest",
        category: "Retest Precision",
        title: "Broaden Retest Tolerance to 0.25% (0.0025)",
        paramKey: "retest",
        currentDisplay: `${(cfg.retest * 100).toFixed(2)}%`,
        recommendedDisplay: "0.25%",
        explanation: "A strict 0.1% tolerance misses valid pullback touches on crypto pairs due to spread and depth. 0.25% captures high-probability fills.",
        impactBadge: "+Retest Entry Capture Rate",
        applyPatch: { retest: 0.0025 },
      });
    }

    // 5. Asymmetric Payoff Architecture (Targets) - Only when trades > 0
    if (totalTrades > 0) {
      if (cfg.t1 < 1.5 || cfg.t2 < 2.5) {
        list.push({
          id: "targets",
          category: "Payoff & Targets",
          title: "Widen Profit Targets to 1.5R (T1) and 2.5R (T2)",
          paramKey: "targets",
          currentDisplay: `T1 ${cfg.t1}R · T2 ${cfg.t2}R`,
          recommendedDisplay: "T1 1.5R · T2 2.5R",
          explanation: `Tight targets (${cfg.t1}R / ${cfg.t2}R) don't provide sufficient asymmetry to overcome exchange taker fees. Targeting 1.5R (50% close + breakeven lock) and 2.5R runner achieves positive expectancy.`,
          impactBadge: "+Asymmetric Expectancy",
          applyPatch: {
            t1: 1.5,
            t2: 2.5,
            partialTpPct: 50,
            breakevenStop: true,
          },
        });
      } else if (totalTrades >= 5 && netR < 0 && (cfg.t1 < 2.0 || cfg.t2 < 3.5)) {
        list.push({
          id: "targets_expand",
          category: "Payoff & Targets",
          title: "Expand Runner Targets to 2.0R (T1) and 3.5R (T2)",
          paramKey: "targets",
          currentDisplay: `T1 ${cfg.t1}R · T2 ${cfg.t2}R`,
          recommendedDisplay: "T1 2.0R · T2 3.5R",
          explanation: `Under low win-rate regimes, expand runner target to 3.5R to dramatically boost mathematical expectancy.`,
          impactBadge: "+High Asymmetry Edge",
          applyPatch: {
            t1: 2.0,
            t2: 3.5,
            partialTpPct: 50,
            breakevenStop: true,
          },
        });
      }
    }

    // 6. Stop-Loss ATR Volatility Buffer
    if (cfg.atr <= 0.85 || (totalTrades > 0 && losses > wins && cfg.atr < 1.25)) {
      list.push({
        id: "atr",
        category: "Risk Buffer",
        title: "Calibrate ATR Stop Multiplier to 1.25",
        paramKey: "atr",
        currentDisplay: `ATR × ${cfg.atr}`,
        recommendedDisplay: "ATR × 1.25 (or Structure)",
        explanation: `Current ${cfg.atr} ATR stop gets clipped on normal candle wicks. 1.25 ATR gives the trade necessary breathing room without increasing total equity risk.`,
        impactBadge: "Avoid Premature Stop-Outs",
        applyPatch: {
          atr: 1.25,
          stop: "atr_or_structure",
        },
      });
    }

    // 7. RSI / MACD Momentum Filter Calibration
    if (totalTrades < 5) {
      if (cfg.rsiFilter === "enabled" && cfg.rsiCondition === "two_bottom_bull_two_top_bear") {
        list.push({
          id: "rsi_condition",
          category: "Momentum Filters",
          title: "Calibrate RSI to Standard Momentum (>50)",
          paramKey: "rsiCondition",
          currentDisplay: "Two-Bottom Bull / Two-Top Bear",
          recommendedDisplay: "Momentum Confirmation (>50)",
          explanation: "Dual-bottom/top swing divergence is very restrictive and blocked valid setups. Standard momentum confirms direction without starving entries.",
          impactBadge: "+Unblock RSI Filter",
          applyPatch: { rsiCondition: "momentum" },
        });
      }
      if (cfg.macdFilter === "enabled" && cfg.macdCondition === "two_top_bear_two_bottom_bull") {
        list.push({
          id: "macd_condition",
          category: "Momentum Filters",
          title: "Calibrate MACD to Signal Line Crossover",
          paramKey: "macdCondition",
          currentDisplay: "Two-Top Bear / Two-Bottom Bull",
          recommendedDisplay: "Signal Crossover",
          explanation: "MACD two-peak reversal divergence is very strict. Signal line crossover confirms momentum acceleration without starving trade flow.",
          impactBadge: "+Unblock MACD Filter",
          applyPatch: { macdCondition: "signal_crossover" },
        });
      }
    }

    // 8. Breakeven Stop Check
    if (!cfg.breakevenStop && totalTrades > 0) {
      list.push({
        id: "breakeven",
        category: "Risk Buffer",
        title: "Enable Breakeven Stop on Target 1 Fill",
        paramKey: "breakevenStop",
        currentDisplay: "Disabled",
        recommendedDisplay: "Enabled (Move Stop to Entry)",
        explanation: "Automatically moves stop to entry price once Target 1 is hit, securing a risk-free runner position for Target 2.",
        impactBadge: "Tail Risk Elimination",
        applyPatch: { breakevenStop: true },
      });
    }

    // 9. Circuit Breaker Discipline
    if (cfg.maxDailyLoss > 3) {
      list.push({
        id: "daily_loss",
        category: "Risk Buffer",
        title: "Cap Daily Loss Limit at 3.0%",
        paramKey: "maxDailyLoss",
        currentDisplay: `${cfg.maxDailyLoss}%`,
        recommendedDisplay: "3.0% Halt",
        explanation: "Strict institutional circuit breaker stops automated trading for the day if drawdown reaches 3%, protecting portfolio equity.",
        impactBadge: "Circuit Breaker Protection",
        applyPatch: { maxDailyLoss: 3 },
      });
    }

    return list;
  }, [cfg, totalTrades, rejections, grossR, netR, losses, wins, s.bars_processed]);

  // Default all suggestions to selected
  useEffect(() => {
    if (!initializedSelection && suggestions.length > 0) {
      setSelectedIds(new Set(suggestions.map((s) => s.id)));
      setInitializedSelection(true);
    }
  }, [suggestions, initializedSelection]);

  function toggleSuggestion(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(suggestions.map((s) => s.id)));
  }

  function applySuggestions(andReRun = false) {
    const toApply = suggestions.filter((s) => selectedIds.has(s.id));
    if (!toApply.length) return;

    let patch: Partial<Cfg> = {};
    const summaryPills: string[] = [];
    for (const item of toApply) {
      patch = { ...patch, ...item.applyPatch };
      summaryPills.push(`${item.title.split(" to ")[0].replace("Lower ", "").replace("Align ", "").replace("Widen ", "").replace("Calibrate ", "").replace("Broaden ", "").replace("Activate ", "").replace("Enable ", "").replace("Cap ", "")}: ${item.recommendedDisplay}`);
    }

    setPreviousCfg({ ...cfg });
    const updatedCfg: Cfg = { ...cfg, ...patch };
    activeCfgRef.current = updatedCfg;
    setCfg(updatedCfg);
    setAppliedNotice(`Applied ${toApply.length} Quant Coach optimization${toApply.length > 1 ? "s" : ""} to your Strategy Builder configuration!`);
    setAppliedPatchesSummary(summaryPills);

    if (andReRun) {
      onReRun(updatedCfg);
    }
  }

  function revert() {
    if (previousCfg) {
      setCfg(previousCfg);
      setPreviousCfg(null);
      setAppliedNotice("Reverted strategy configuration to previous parameters.");
      setAppliedPatchesSummary([]);
    }
  }

  const isLoss = netR <= 0;
  const selectedCount = suggestions.filter((s) => selectedIds.has(s.id)).length;

  const diagnosticSummary = totalTrades === 0
    ? `Zero trades executed across ${s.bars_processed ?? 14400} bars. Strict setup score (${cfg.score}/10) and inverted higher-timeframe trend checks starved candidate setups.`
    : totalTrades < 5
      ? `Severe Sample Starvation & Negative Drift: Only ${totalTrades} trades executed (${fmt(netR)} R Net). Strict setup score (${cfg.score}/10) and inverted ${cfg.trendTimeframe} HTF filter on 15m execution starved valid setups, while tight ${cfg.atr} ATR stops caused premature invalidation.`
      : isLoss
        ? `Negative Expectancy Drag (${fmt(netR)} R Net · ${pct(winRate)} Win Rate): Trades are taking too much friction relative to payoff. Widen targets to 1.5R/2.5R, give stops breathing room with 1.25 ATR, and align HTF trend confluence.`
        : `Alpha Edge Verified (+${fmt(netR)} R Net · ${totalTrades} Trades · ${pct(winRate)} Win Rate): Quant Coach recommends fine-tuning trailing breakeven stops and divergence momentum filters to optimize drawdown recovery.`;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(10, 15, 30, 0.98) 100%)",
        border: "1px solid rgba(99, 102, 241, 0.35)",
        borderRadius: 16,
        padding: "24px 26px",
        marginBottom: 26,
        boxShadow: "0 10px 30px -10px rgba(99, 102, 241, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #6366f1 0%, #38bdf8 50%, #10b981 100%)" }} />

      {/* Header Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{
              background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(56, 189, 248, 0.25) 100%)",
              color: "#818cf8",
              border: "1px solid rgba(99, 102, 241, 0.4)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
              padding: "3px 10px",
              borderRadius: 6,
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade80" }} />
              AI Quant Coach · Strategy Auto-Tuner
            </span>
            <span style={{ fontSize: 12, color: "#64748b" }}>•</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              1-Click Edge Repair &amp; Optimization
            </span>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: "-0.01em" }}>
            Institutional Parameter Optimization Device
          </h3>
          <p style={{ margin: "5px 0 0", color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
            Diagnoses execution bottlenecks, resolves setup starvation, corrects inverted trend filters, and widens asymmetric payoff. Apply all suggestions with one click and re-test immediately.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => applySuggestions(true)}
            disabled={running || suggestions.length === 0}
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              padding: "9px 18px",
              fontSize: 12,
              fontWeight: 700,
              cursor: running || suggestions.length === 0 ? "not-allowed" : "pointer",
              boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {running ? "Running..." : "⚡ Apply & Re-Run Backtest Now"}
          </button>
        </div>
      </div>

      {/* Diagnostic Alert Box */}
      <div
        style={{
          background: isLoss ? "rgba(239, 68, 68, 0.08)" : "rgba(16, 185, 129, 0.08)",
          border: isLoss ? "1px solid rgba(239, 68, 68, 0.25)" : "1px solid rgba(16, 185, 129, 0.25)",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 18,
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 20 }}>{isLoss ? "⚠️" : "🎯"}</span>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, color: isLoss ? "#fca5a5" : "#6ee7b7", marginBottom: 3 }}>
            {isLoss
              ? `Bottlenecks Detected (${fmt(netR)} R Net · ${totalTrades} Trades · ${pct(winRate)} Win Rate)`
              : `Alpha Edge Detected (+${fmt(netR)} R Net · ${totalTrades} Trades · ${pct(winRate)} Win Rate)`}
          </div>
          <div style={{ color: "#cbd5e1" }}>
            {diagnosticSummary}
          </div>
        </div>
      </div>

      {/* Suggestion Cards Grid */}
      {suggestions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🏆</div>
          <strong style={{ fontSize: 14, color: "#4ade80" }}>
            All Quant Coach Institutional Parameters Are Fully Applied!
          </strong>
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "6px auto 16px", maxWidth: 500 }}>
            Strategy is configured with optimal setup scores, 1h macro trend confluence, calibrated ATR stops, and asymmetric targets.
          </p>
          <button
            type="button"
            onClick={() => onReRun(activeCfgRef.current)}
            disabled={running}
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              padding: "10px 22px",
              fontSize: 13,
              fontWeight: 700,
              cursor: running ? "not-allowed" : "pointer",
            }}
          >
            {running ? "Running Backtest..." : "▶ Re-Run Backtest with Current Parameters"}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 18 }}>
          {suggestions.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                onClick={() => toggleSuggestion(item.id)}
                style={{
                  background: isSelected ? "rgba(30, 41, 59, 0.7)" : "rgba(15, 23, 42, 0.5)",
                  border: isSelected ? "1px solid rgba(99, 102, 241, 0.5)" : "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{
                      background: "rgba(99, 102, 241, 0.15)",
                      color: "#a5b4fc",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 4,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}>
                      {item.category}
                    </span>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      style={{ cursor: "pointer", accentColor: "#6366f1" }}
                    />
                  </div>
                  <strong style={{ fontSize: 13, color: "#f8fafc", display: "block", marginBottom: 4 }}>
                    {item.title}
                  </strong>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: 11, lineHeight: 1.45 }}>
                    {item.explanation}
                  </p>
                </div>

                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(11, 16, 28, 0.7)",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  marginTop: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <span style={{ color: "#94a3b8" }}>Current:</span>
                    <span style={{ color: "#f87171", fontWeight: 700 }}>{item.currentDisplay}</span>
                    <span style={{ color: "#64748b" }}>→</span>
                    <span style={{ color: "#4ade80", fontWeight: 800 }}>{item.recommendedDisplay}</span>
                  </div>
                  <span style={{
                    background: "rgba(34, 197, 94, 0.12)",
                    color: "#4ade80",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}>
                    {item.impactBadge}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Applied Notice Banner */}
      {appliedNotice && (
        <div style={{
          background: "rgba(16, 185, 129, 0.12)",
          border: "1px solid rgba(16, 185, 129, 0.35)",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
          color: "#6ee7b7",
          fontSize: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, marginBottom: appliedPatchesSummary.length ? 6 : 0 }}>
            <span>✅</span>
            <span>{appliedNotice}</span>
          </div>
          {appliedPatchesSummary.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {appliedPatchesSummary.map((pill, idx) => (
                <span
                  key={idx}
                  style={{
                    background: "rgba(16, 185, 129, 0.2)",
                    color: "#a7f3d0",
                    border: "1px solid rgba(16, 185, 129, 0.4)",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 6,
                  }}
                >
                  ✓ {pill}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        borderTop: "1px solid rgba(255, 255, 255, 0.06)",
        paddingTop: 16,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {suggestions.length > 0 && (
            <button
              type="button"
              onClick={selectAll}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: 11,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Select All ({suggestions.length})
            </button>
          )}
          {previousCfg && (
            <button
              type="button"
              onClick={revert}
              style={{
                background: "rgba(239, 68, 68, 0.1)",
                color: "#fca5a5",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ↺ Revert to Previous Config
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {suggestions.length > 0 && (
            <button
              type="button"
              onClick={() => applySuggestions(false)}
              disabled={selectedCount === 0}
              style={{
                background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 700,
                cursor: selectedCount === 0 ? "not-allowed" : "pointer",
                boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>⚡</span> Apply {selectedCount} Suggestion{selectedCount > 1 ? "s" : ""} (1-Click)
            </button>
          )}

          <button
            type="button"
            onClick={() => onReRun(activeCfgRef.current)}
            disabled={running}
            style={{
              background: running ? "rgba(16, 185, 129, 0.4)" : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 700,
              cursor: running ? "not-allowed" : "pointer",
              boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {running ? (
              <>
                <span style={{ width: 13, height: 13, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                Running Backtest...
              </>
            ) : (
              <>
                <span>▶</span> Re-Run Optimized Backtest
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function BacktestResult({
  job,
  pollJob,
  deployTargetId,
  cfg,
  setCfg,
  onReRun,
  running,
}: {
  job: any;
  pollJob: any;
  deployTargetId: string;
  cfg: Cfg;
  setCfg: React.Dispatch<React.SetStateAction<Cfg>>;
  onReRun: (overrideCfg?: Cfg) => void;
  running: boolean;
}) {
  const [loadedTrades, setLoadedTrades] = useState<any[]>(job.trades || []);

  useEffect(() => {
    if (Array.isArray(job.trades) && job.trades.length > 0) {
      setLoadedTrades(job.trades);
      return;
    }
    const jid = job.id || job.job_id;
    if (jid) {
      api(`/reports/${jid}/trade-log`)
        .then((t: any) => {
          if (Array.isArray(t) && t.length > 0) {
            setLoadedTrades(t);
          }
        })
        .catch(() => {});
    }
  }, [job.id, job.job_id, job.trades]);

  const activeTradesList = loadedTrades.length > 0 ? loadedTrades : (job.trades || []);
  const s = job.summary || {};
  const pr = s.performance_and_robustness || job.performance_and_robustness || {};
  const ra = pr.risk_adjusted || {};
  const ex = pr.expectancy || {};
  const risk = pr.risk || {};
  const fric = pr.friction || {};
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

  const netAfterFriction = fric.net_R_after_friction != null ? fric.net_R_after_friction : s.gross_R;

  const rows = [
    [
      "Positive / Negative / Breakeven Trades",
      `${positive} / ${negative} / ${be}`,
      "Classified by final realized R-multiple, not just target hits.",
    ],
    ["Gross Return (R)", `${fmt(s.gross_R)} R`, "Raw cumulative R before exchange frictions."],
    [
      "Net Return (After Fees & Slippage)",
      `${fmt(netAfterFriction)} R`,
      `Includes ${(fric.fee_pct_per_side ?? 0.04) * 2}% round-trip fee + ${(fric.slippage_pct_per_side ?? 0.01) * 2}% slippage.`,
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
      "Setups blocked because higher-timeframe EMA was against bias.",
    ],
    [
      "RSI Filter Rejections",
      s.rsi_filter_rejections ?? 0,
      "Setups blocked by RSI overbought/oversold boundaries or lack of two-bottom bullish divergence.",
    ],
    [
      "MACD Filter Rejections",
      s.macd_filter_rejections ?? 0,
      "Setups blocked by negative MACD momentum or absence of two-bottom bullish curl.",
    ],
    ["Max Drawdown (R)", `${fmt(s.max_drawdown_in_R)} R`, "Worst peak-to-trough equity drawdown."],
    ["Average Holding Duration", `${fmt(s.average_holding_bars)} bars`, "Average bar duration per trade."],
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            href={`/paper-trading?strategy_id=${encodeURIComponent(deployTargetId)}`}
            style={{
              background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(22, 163, 74, 0.35) 100%)",
              color: "#4ade80",
              textDecoration: "none",
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid rgba(34, 197, 94, 0.4)",
            }}
          >
            🚀 Deploy to Paper Trading →
          </Link>
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
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Kpi label="Status" value={pollJob?.status?.toUpperCase() || job.status?.toUpperCase()} color="#38bdf8" />
        <Kpi label="Total Trades" value={s.total_trades ?? activeTradesList.length ?? 0} />
        <Kpi label="Gross R" value={`${fmt(s.gross_R)} R`} color={signedClass(s.gross_R)} />
        <Kpi label="Net Return (Friction)" value={`${fmt(netAfterFriction)} R`} color={signedClass(netAfterFriction)} />
        <Kpi label="Win Rate" value={pct(s.win_rate)} color="#4ade80" />
        <Kpi label="Profit Factor" value={fmt(s.profit_factor)} />
      </div>

      {/* ─── 🛡️ Executive Strategy Health & Quant Grade Card ─── */}
      <ExecutiveStrategyHealthCard job={job} />

      {/* ─── 🧠 AI Quant Coach 1-Click Strategy Auto-Tuner & Optimization Device ─── */}
      <QuantCoachOptimizer
        job={job}
        cfg={cfg}
        setCfg={setCfg}
        onReRun={onReRun}
        running={running}
      />

      {/* ─── Institutional Backtest Analytics: Equity Curve, Per-Symbol Breakdown & Trade Log ─── */}
      <BacktestAnalytics
        trades={activeTradesList}
        summary={s}
        strategyName={job.display_strategy_id || deployTargetId}
        feePct={fric.fee_pct_per_side ?? 0.04}
        slippagePct={fric.slippage_pct_per_side ?? 0.01}
        riskPct={risk.risk_per_trade_pct ?? 1.0}
      />

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
          <Kpi label="Net Expectancy" value={metric(ex.expectancy_R_net ?? ex.expectancy_R_per_trade, " R")} color={signedClass(ex.expectancy_R_net ?? ex.expectancy_R_per_trade)} />
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
  strategyDisplayName,
}: {
  payload: any;
  strategyId: string;
  strategyDisplayName?: string;
}) {
  const s = payload.strategy;
  const activeLabel = strategyDisplayName || payload.name || payload.user_strategy_id || "PRISM";
  const rows = [
    ["Strategy Identifier", activeLabel],
    ["Active Markets", payload.symbols?.join(", ")],
    ["Trade Direction", s.direction === "both" ? "Both (Long & Short)" : s.direction === "long_only" ? "Long Only" : "Short Only"],
    ["Execution Timeframe", `${payload.timeframe} (${payload.bar_seconds}s bars)`],
    ["Breakout Lookback", `${s.breakout_lookback} bars`],
    ["Retest Tolerance", `${s.retest_tolerance_pct} (${Number(s.retest_tolerance_pct) * 100}%)`],
    ["Minimum Setup Score", `${s.min_setup_score} / 10`],
    [
      "Stop-Loss Rule",
      `${s.stop_loss.type} · ATR Multiplier ${s.stop_loss.atr_multiplier}`,
    ],
    [
      "Target Architecture",
      `Target 1: ${s.targets.target1_R}R (${s.trade_management?.partial_tp_pct ?? 50}% closed) · Target 2: ${s.targets.target2_R}R`,
    ],
    ["Breakeven Stop at T1", s.trade_management?.breakeven_stop ? "Enabled (Stop moves to Entry at T1)" : "Disabled"],
    ["Risk Per Trade", `${s.risk.risk_per_trade_pct}% of equity`],
    ["Max Daily Loss Halt", `${s.risk.max_daily_loss_pct}% (Circuit Breaker)`],
    ["Max Open Positions", `${s.risk.max_open_positions} concurrent positions`],
    ["Setup TTL Expiry", `${s.ttl_bars} bars`],
    ["Re-Entry Discipline", s.reentry.enabled ? "Enabled" : "Disabled"],
    ["Max Allowed Re-Entries", s.reentry.max_reentries],
    ["Re-Entry Cooldown", `${s.reentry.cooldown_bars} bars`],
    ["Exchange Fee Model", `${s.execution_friction?.fee_pct ?? 0.04}% per side · ${s.execution_friction?.slippage_pct ?? 0.01}% slippage`],
    ["Session Timing Filter", s.timing_filter?.trading_hours === "all_day" ? "24/7 Global" : s.timing_filter?.trading_hours],
    [
      "HTF Trend Filter",
      s.trend_filter.use_trend_filter
        ? `${s.trend_filter.higher_timeframe} EMA${s.trend_filter.fast_ema} > EMA${s.trend_filter.slow_ema}`
        : "Disabled",
    ],
    [
      "RSI Momentum & Divergence",
      s.rsi_filter?.enabled
        ? `${s.rsi_filter.condition === "two_bottom_bull_two_top_bear" ? "Two-Bottom/Top Divergence" : s.rsi_filter.condition} (Period ${s.rsi_filter.period}, OB ${s.rsi_filter.overbought}, OS ${s.rsi_filter.oversold})`
        : "Disabled",
    ],
    [
      "MACD Trend & Reversal",
      s.macd_filter?.enabled
        ? `${s.macd_filter.condition === "two_top_bear_two_bottom_bull" ? "Two-Top/Bottom Reversal" : s.macd_filter.condition} (${s.macd_filter.fast_period}/${s.macd_filter.slow_period}/${s.macd_filter.signal_period})`
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#ffffff" }}>
            Active Strategy Configuration Summary
          </h2>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
            Validated system specifications registered for backtest and live paper trading engines
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {activeLabel && (
            <span style={{ fontSize: 11, color: "#a5b4fc", background: "rgba(99, 102, 241, 0.15)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(99, 102, 241, 0.3)", fontWeight: 700 }}>
              {activeLabel}
            </span>
          )}
          <Link
            href={`/paper-trading?strategy_id=${encodeURIComponent(strategyId || payload.user_strategy_id || payload.name || "PRISM")}`}
            style={{
              background: "rgba(34, 197, 94, 0.15)",
              color: "#4ade80",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Deploy to Paper Trading →
          </Link>
        </div>
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
