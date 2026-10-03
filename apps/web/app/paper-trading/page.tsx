"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api, formatApiError } from "../../lib/api";
import {
  appendTelemetryCandle,
  candlesForSymbol,
  normalizeLiveCandles,
  type LiveChartCandle,
} from "../../lib/liveChartCandles";
import { classifyTradeResultFromR } from "../../lib/tradeClassification";
import TradingChart from "../../components/TradingChart";

type StrategyRow = {
  id: string;
  name?: string;
  timeframe?: string;
  symbols?: string[];
  config?: any;
  created_at?: string;
  user_strategy_id?: string;
};

type LiveStatus = {
  status: string;
  session_id?: string;
  selected_strategy_id?: string;
  selected_strategy_name?: string;
  selected_strategy_db_id?: string;
  session_number?: number;
  config_path?: string;
  live_config?: any;
  symbol?: string;
  real_time?: boolean;
  synthetic_data_used?: boolean;
  last_price?: number;
  processed?: number;
  ticks_processed?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  open_position?: unknown;
  open_positions_detail?: any[];
  open_positions?: any[];
  selected_symbols?: string[];
  active_symbols?: string[];
  candles?: Record<string, any[]>;
  recent_candles?: any[];
  events?: any[];
  stdout_tail?: string[];
  error?: string;
  report_files?: Record<string, string>;
  metrics?: Record<string, any>;
  session_metrics?: Record<string, any>;
  symbol_states?: Record<string, any>;
  markets?: any[];
  market_table?: any[];
  supported_symbols?: string[];
  engine_ready?: boolean;
  process_running?: boolean;
  feed_status?: string;
  selected_binary_path?: string;
  binary_diagnostics?: {
    repo_root?: string;
    checked_paths?: string[];
    selected_binary_path?: string | null;
    binary_found?: boolean;
    build_command?: string;
  };
  last_heartbeat?: Record<string, any> | null;
  last_heartbeat_at?: string | null;
  wallet?: {
    starting_balance: number;
    current_balance: number; // Backwards-compatible alias for account_equity
    account_equity?: number;
    cash_balance?: number;
    realized_pnl: number;
    unrealized_pnl: number;
    locked_until?: string;
  };
};

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
const SUPPORTED_SYMBOLS = POPULAR_SYMBOLS;

function money(v: unknown) {
  const n = typeof v === "number" ? v : Number(v || 0);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function asNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function displayValue(v: any, formatter?: (value: any) => string) {
  if (v === undefined || v === null || v === "" || v === "-") return "not available";
  const n = Number(v);
  if (Number.isFinite(n) && n === 0) return formatter ? formatter(n) : "0";
  return formatter ? formatter(v) : String(v);
}
function cleanTime(v: any) {
  if (!v) return "-";
  const raw = String(v);
  const normalized = raw.endsWith("+00:00Z")
    ? raw.replace("+00:00Z", "Z")
    : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime()))
    return raw.replace("T", " ").replace("Z", " UTC");
  return d.toLocaleString(undefined, { hour12: false });
}
function chartUpdateTime(v: any) {
  if (v === undefined || v === null || v === "") return "not available";
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v > 1_000_000_000_000 ? v : v * 1000).toLocaleTimeString(undefined, { hour12: false });
  }
  return cleanTime(v);
}
function normalizeReason(v: any) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}
function prettyReason(reason: any) {
  const r = normalizeReason(reason);
  if (!r) return "";
  if (r === "TARGET1" || r === "TARGET_1" || r === "TARGET1_HIT") return "TARGET 1 HIT";
  if (r === "TARGET2" || r === "TARGET_2" || r === "TARGET2_HIT") return "TARGET 2 HIT";
  if (r === "STOP" || r === "STOP_LOSS" || r === "STOP_HIT") return "STOP LOSS";
  if (r === "TIME_EXIT") return "TIME EXIT";
  if (r === "USER_STOP_EXIT") return "USER STOP EXIT";
  if (r === "FORCED_EXIT" || r === "DATA_END_EXIT") return "FORCED EXIT";
  return r.replaceAll("_", " ");
}
function inferResult(entry: any, exit: any, rValue: any, side = "BUY") {
  const rResult = classifyTradeResultFromR(rValue);
  if (rResult !== "-") return rResult;

  const en = Number(entry),
    ex = Number(exit);
  const normalizedSide = String(side || "BUY").toUpperCase();

  if (Number.isFinite(en) && Number.isFinite(ex)) {
    const pnl = normalizedSide === "SELL" ? en - ex : ex - en;
    if (pnl > 0.0000001) return "WIN";
    if (pnl < -0.0000001) return "LOSS";
    return "BREAKEVEN";
  }

  return "-";
}
function inferExitReason(t: any) {
  if (t.status === "OPEN") return "OPEN POSITION";
  const side = String(t.side || "BUY").toUpperCase();
  const entry = Number(t.entry_price);
  const exit = Number(t.exit_price);
  const stop = Number(t.stop);
  const target1 = Number(t.target1);
  const target2 = Number(t.target2);
  const result = inferResult(entry, exit, t.r, side);
  const rawReason = prettyReason(t.exit_reason);

  // Price-consistent reason has priority over raw text. Raw C++ lines include
  // target1=/target2= price fields, and the UI must never confuse those with
  // exit_reason=TARGET_1/TARGET_2.
  if (side === "BUY" && Number.isFinite(entry) && Number.isFinite(exit)) {
    if (result === "LOSS") {
      if (Number.isFinite(stop) && exit <= stop) return "STOP LOSS";
      return "NEGATIVE EXIT";
    }
    if (result === "WIN") {
      if (Number.isFinite(target2) && exit >= target2) return "TARGET 2 HIT";
      if (Number.isFinite(target1) && exit >= target1) return "TARGET 1 HIT";
      if (rawReason === "TARGET 2 HIT" || rawReason === "TARGET 1 HIT") return rawReason;
      return "POSITIVE EXIT";
    }
    return "BREAKEVEN EXIT";
  }

  if (side === "SELL" && Number.isFinite(entry) && Number.isFinite(exit)) {
    if (result === "LOSS") {
      if (Number.isFinite(stop) && exit >= stop) return "STOP LOSS";
      return "NEGATIVE EXIT";
    }
    if (result === "WIN") {
      if (Number.isFinite(target2) && exit <= target2) return "TARGET 2 HIT";
      if (Number.isFinite(target1) && exit <= target1) return "TARGET 1 HIT";
      if (rawReason === "TARGET 2 HIT" || rawReason === "TARGET 1 HIT") return rawReason;
      return "POSITIVE EXIT";
    }
    return "BREAKEVEN EXIT";
  }

  if (result === "WIN") return "POSITIVE EXIT";
  if (result === "LOSS") return "NEGATIVE EXIT";
  if (result === "BREAKEVEN") return "BREAKEVEN EXIT";
  if (rawReason) return rawReason;
  return "-";
}
function buildTradeRows(events: any[]) {
  const chronological = [...(events || [])].reverse();
  const closed: any[] = [];
  const openBySymbol: Record<string, any[]> = {};

  const symOf = (e: any) => String(e?.symbol || e?.market || "BTCUSDT").toUpperCase();

  for (const e of chronological) {
    const type = String(e.event_type || "");
    const symbol = symOf(e);
    openBySymbol[symbol] = openBySymbol[symbol] || [];

    if (type === "PAPER_BUY_FILL") {
      openBySymbol[symbol].push({
        symbol,
        side: "BUY",
        entry_time: e.created_at,
        entry_price: e.fill || e.entry || e.price,
        qty: e.qty,
        stop: e.stop,
        target1: e.target1,
        target2: e.target2,
        setup_score: e.setup_score,
        status: "OPEN",
        result: "OPEN",
        exit_reason: "OPEN POSITION",
      });
    } else if (type === "PAPER_SELL_FILL") {
      const queue = openBySymbol[symbol] || [];
      const matchedBuy = queue.length ? queue[queue.length - 1] : null;
      const row: any = {
        symbol,
        side: "BUY",
        entry_time: matchedBuy?.entry_time || e.entry_time || e.created_at,
        exit_time: e.created_at,
        entry_price: e.entry || matchedBuy?.entry_price,
        exit_price: e.exit || e.fill || e.price,
        // SELL fills often do not echo qty, so carry qty from the matched BUY fill for the same symbol.
        qty: e.qty || matchedBuy?.qty || "-",
        stop: e.stop || matchedBuy?.stop,
        target1: e.target1 || matchedBuy?.target1,
        target2: e.target2 || matchedBuy?.target2,
        r: e.R_multiple || e.r || "-",
        pnl: e.pnl || e.realized_pnl || "-",
        status: "CLOSED",
      };
      row.result = inferResult(row.entry_price, row.exit_price, row.r, row.side);
      row.exit_reason_raw = e.exit_reason || "";
      row.exit_reason = inferExitReason({ ...row, exit_reason: row.exit_reason_raw });
      closed.push(row);
      if (queue.length) queue.pop();
    }
  }

  const openRows = Object.values(openBySymbol)
    .flat()
    .map((b) => ({ ...b, exit_reason: "OPEN POSITION" }));
  return [...openRows, ...closed].reverse();
}
function signedStyle(value: any): CSSProperties {
  const n = Number(String(value ?? "").replace(/[$,%Rμs, ]/g, ""));
  if (!Number.isFinite(n)) return {};
  if (n > 0) return { color: "#86efac" };
  if (n < 0) return { color: "#fca5a5" };
  return { color: "#e5e7eb" };
}

function resultStyle(result: any): CSSProperties {
  const r = String(result || "").toUpperCase();
  if (r === "WIN") return { color: "#86efac", fontWeight: 800 };
  if (r === "LOSS") return { color: "#fca5a5", fontWeight: 800 };
  if (r === "OPEN") return { color: "#93c5fd", fontWeight: 800 };
  return { color: "#e5e7eb" };
}


function reasonStyle(reason: any): CSSProperties {
  const r = String(reason || "").toUpperCase();
  if (r.includes("TARGET") || r.includes("PROFIT")) return { color: "#86efac", fontWeight: 800 };
  if (r.includes("STOP") || r.includes("NEGATIVE") || r.includes("LOSS")) return { color: "#fca5a5", fontWeight: 800 };
  if (r.includes("TIME")) return { color: "#93c5fd", fontWeight: 800 };
  if (r.includes("OPEN")) return { color: "#fbbf24", fontWeight: 800 };
  return { color: "#e5e7eb", fontWeight: 700 };
}
function countStyle(kind: "win" | "loss" | "be"): CSSProperties {
  if (kind === "win") return { color: "#86efac", fontWeight: 900 };
  if (kind === "loss") return { color: "#fca5a5", fontWeight: 900 };
  return { color: "#e5e7eb", fontWeight: 900 };
}

function triggerPrice(t: any) {
  const reason = String(t.exit_reason || "").toUpperCase();
  if (reason.includes("STOP")) return Number(t.stop);
  if (reason.includes("TARGET 2")) return Number(t.target2);
  if (reason.includes("TARGET 1")) return Number(t.target1);
  return NaN;
}

function slippageInTradeDirection(t: any) {
  const trigger = triggerPrice(t);
  const exit = Number(t.exit_price);
  if (!Number.isFinite(trigger) || !Number.isFinite(exit)) return null;
  const side = String(t.side || "BUY").toUpperCase();
  // Positive means better than the intended stop/target trigger; negative means worse fill.
  return side === "SELL" ? trigger - exit : exit - trigger;
}

function buildOpenPositions(status: LiveStatus, tradeRows: any[]) {
  const details = Array.isArray(status.open_positions_detail)
    ? status.open_positions_detail
    : Array.isArray(status.open_positions)
      ? status.open_positions
      : [];
  if (details.length) return details;

  const states = (status as any).symbol_states || {};
  const byState = Object.entries(states)
    .filter(([, st]: any) => Number(st?.open_trade || st?.open_positions || 0) > 0)
    .map(([symbol, st]: any) => ({
      symbol,
      side: st.open_side || "BUY",
      entry_price: st.open_entry,
      qty: st.open_qty || st.qty || "-",
      stop: st.open_stop,
      target1: st.target1,
      target2: st.target2,
      current_price: st.last_price,
      current_R: st.current_R ?? st.current_r,
      unrealized_pnl: st.unrealized_pnl,
    }));
  if (byState.length) return byState;

  return tradeRows
    .filter((t: any) => t.status === "OPEN")
    .map((t: any) => ({
      symbol: t.symbol,
      side: t.side || "BUY",
      entry_price: t.entry_price,
      qty: t.qty,
      stop: t.stop,
      target1: t.target1,
      target2: t.target2,
    }));
}

function symbolStateFor(status: LiveStatus, symbol: string) {
  const wanted = String(symbol || "").toUpperCase();
  const states = status.symbol_states || {};
  const key = Object.keys(states).find((candidate) => candidate.toUpperCase() === wanted);
  return key ? states[key] : {};
}

function priceForSymbol(status: LiveStatus, symbol: string, marketRows: any[], heartbeat: Record<string, any> | null | undefined) {
  const wanted = String(symbol || "").toUpperCase();
  const state = symbolStateFor(status, wanted);
  const market = marketRows.find((m: any) => String(m?.symbol || "").toUpperCase() === wanted);
  const heartbeatSymbol = String(heartbeat?.symbol || "").toUpperCase();
  return (
    state.last_price ??
    state.latest_price ??
    market?.latest_price ??
    (heartbeatSymbol === wanted ? heartbeat?.latest_price : undefined) ??
    status.last_price
  );
}

function Countdown({ until }: { until?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return (
    <span>
      {h}h {m}m {s}s
    </span>
  );
}

export default function PaperTradingPage() {
  const [status, setStatus] = useState<LiveStatus>({ status: "loading" });
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["BTCUSDT"]);
  const [chartSymbol, setChartSymbol] = useState("BTCUSDT");
  const [allSymbols, setAllSymbols] = useState<string[]>(POPULAR_SYMBOLS);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [customSymbolInput, setCustomSymbolInput] = useState("");
  const [telemetryCandles, setTelemetryCandles] = useState<Record<string, LiveChartCandle[]>>({});
  const [initialCandles, setInitialCandles] = useState<Record<string, LiveChartCandle[]>>({});
  const [message, setMessage] = useState(
    "Real-time Binance multi-market live paper mode. No real-money execution.",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api("/live-paper/symbols")
      .then((res: any) => {
        if (!cancelled && Array.isArray(res?.symbols) && res.symbols.length > 0) {
          setAllSymbols(res.symbols);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    try {
      setStatus((await api("/live-paper/status")) as LiveStatus);
    } catch (err) {
      setMessage(formatApiError(err));
      setStatus({ status: "error", error: formatApiError(err) });
    }
  }

  async function loadStrategies() {
    try {
      const rows: any = await api("/strategies");
      const list = Array.isArray(rows) ? rows : [];
      setStrategies(list);
      if (!selectedStrategyId && list.length) {
        setSelectedStrategyId(list[0].id);
        setSelectedSymbols(list[0].symbols?.length ? list[0].symbols : ["BTCUSDT"]);
      }
    } catch (err) {
      setMessage(
        `Could not load Strategy Builder configs: ${formatApiError(err)}`,
      );
      setStrategies([]);
    }
  }

  function toggleLiveSymbol(sym: string) {
    const clean = sym.trim().toUpperCase();
    const set = new Set(selectedSymbols);
    set.has(clean) ? set.delete(clean) : set.add(clean);
    const next = [...set];
    setSelectedSymbols(next.length ? next : ["BTCUSDT"]);
  }

  function selectAllLiveSymbols() {
    setSelectedSymbols([...POPULAR_SYMBOLS]);
  }

  function useStrategySymbols() {
    const st = strategies.find((s) => s.id === selectedStrategyId);
    const symbols = st?.symbols?.length ? st.symbols : ["BTCUSDT"];
    setSelectedSymbols(symbols);
  }

  function addCustomSymbol() {
    const raw = customSymbolInput.trim().toUpperCase();
    if (!raw) return;
    const sym = raw.endsWith("USDT") ? raw : `${raw}USDT`;
    if (!selectedSymbols.includes(sym)) {
      setSelectedSymbols((prev) => [...prev, sym]);
    }
    if (!allSymbols.includes(sym)) {
      setAllSymbols((prev) => [sym, ...prev]);
    }
    setChartSymbol(sym);
    setCustomSymbolInput("");
    setMessage(`Added ${sym} to live paper active markets.`);
  }

  async function start() {
    setBusy(true);
    try {
      const r = (await api("/live-paper/start", {
        method: "POST",
        body: JSON.stringify({
          strategy_id: selectedStrategyId || undefined,
          symbols: selectedSymbols,
        }),
      })) as LiveStatus;
      setStatus(r);
      const cfgName =
        r.selected_strategy_name ||
        r.live_config?.name ||
        "latest Strategy Builder config";
      setMessage(
        r.status === "disabled"
          ? r.error
          : `Live paper session active for ${cfgName} on ${selectedSymbols.join(", ")}. Real-time Binance market stream connected.`,
      );
    } catch (err) {
      setMessage(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const r = (await api("/live-paper/stop", {
        method: "POST",
      })) as LiveStatus;
      setStatus(r);
      setMessage(
        "Session stopped. Final live paper report was generated successfully.",
      );
    } catch (err) {
      setMessage(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadStrategies();
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wallet = status.wallet || {
    starting_balance: 100000,
    current_balance: 100000,
    account_equity: 100000,
    cash_balance: 100000,
    realized_pnl: 0,
    unrealized_pnl: 0,
  };
  const realizedPnl = status.realized_pnl ?? wallet.realized_pnl ?? 0;
  const unrealizedPnl = status.unrealized_pnl ?? wallet.unrealized_pnl ?? 0;
  const cashBalance = wallet.cash_balance ?? wallet.starting_balance + realizedPnl;
  const accountEquity = wallet.account_equity ?? wallet.current_balance ?? cashBalance + unrealizedPnl;
  const locked = Boolean(wallet.locked_until);
  const events = useMemo(
    () => [...(status.events || [])].reverse(),
    [status.events],
  );
  const metrics = status.session_metrics || status.metrics || {};
  const liveConfig = status.live_config || {};

  // Production-safe config display:
  // Backend no longer exposes internal live_config/config_path for security.
  // So the UI must read saved Strategy Builder parameters from /strategies.
  const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId);
  const selectedConfig = selectedStrategy?.config || {};
  const selectedRules = selectedConfig.strategy || selectedConfig || {};
  const selectedRisk = selectedRules.risk || selectedConfig.risk || {};
  const selectedTargets = selectedRules.targets || selectedConfig.targets || {};

  const cfgLookback =
    metrics.cfg_lookback ??
    liveConfig.strategy?.breakout_lookback ??
    selectedRules.breakout_lookback ??
    selectedConfig.breakout_lookback ??
    "-";

  const cfgMinScore =
    metrics.cfg_min_score ??
    liveConfig.strategy?.min_setup_score ??
    selectedRules.min_setup_score ??
    selectedConfig.min_setup_score ??
    "-";

  const cfgRiskPct =
    metrics.cfg_risk_pct ??
    liveConfig.strategy?.risk?.risk_per_trade_pct ??
    selectedRisk.risk_per_trade_pct ??
    "-";

  const cfgTarget1 =
    liveConfig.strategy?.targets?.target1_R ??
    selectedTargets.target1_R ??
    "-";

  const cfgTarget2 =
    liveConfig.strategy?.targets?.target2_R ??
    selectedTargets.target2_R ??
    "-";

  const activeStrategyName =
    status.selected_strategy_name ||
    liveConfig.name ||
    selectedStrategy?.name ||
    selectedRules.name ||
    "Default C++ config";

  const activeStrategyId =
    status.selected_strategy_id ||
    liveConfig.strategy_id ||
    selectedStrategy?.user_strategy_id ||
    selectedConfig.user_strategy_id ||
    selectedConfig.strategy_id ||
    selectedStrategyId ||
    "";

  const activeBarSeconds =
    metrics.cfg_bar_seconds ||
    liveConfig.bar_seconds ||
    selectedConfig.bar_seconds ||
    selectedStrategy?.config?.bar_seconds ||
    "-";
  const activeBarSecondsNum = Number(activeBarSeconds);
  const tradeRows = useMemo(() => buildTradeRows(events), [events]);
  const openPositions = useMemo(() => buildOpenPositions(status, tradeRows), [status, tradeRows]);
  const marketRows = Array.isArray(status.markets)
    ? status.markets
    : Array.isArray(status.market_table)
      ? status.market_table
      : [];
  const activeMarkets = marketRows.filter((m: any) => m.paper_status === "ACTIVE_WEBSOCKET");
  const primaryMarket =
    activeMarkets.find((m: any) => m.symbol === (status.symbol || liveConfig.symbols?.[0])) ||
    activeMarkets[0] ||
    marketRows.find((m: any) => m.symbol === (selectedSymbols[0] || status.symbol)) ||
    null;
  const primarySymbol =
    primaryMarket?.symbol ||
    (status.symbol && status.symbol !== "MULTI" ? status.symbol : selectedSymbols[0]) ||
    "Market";
  const chartSymbols = allSymbols.length ? allSymbols : POPULAR_SYMBOLS;
  const selectedChartSymbol = chartSymbol || "BTCUSDT";
  const heartbeat = status.last_heartbeat || {};
  const selectedChartState = symbolStateFor(status, selectedChartSymbol);
  const selectedChartPrice = priceForSymbol(status, selectedChartSymbol, marketRows, heartbeat);
  const backendChartCandles = [
    ...candlesForSymbol(status.candles, selectedChartSymbol),
    ...(selectedChartSymbol === String(primarySymbol || "").toUpperCase()
      ? normalizeLiveCandles(status.recent_candles)
      : []),
  ];
  const uniqueBackendChartCandles = Array.from(
    new Map(backendChartCandles.map((candle) => [String(candle.time), candle])).values(),
  ).slice(-1000);
  const chartCandles = uniqueBackendChartCandles.length
    ? uniqueBackendChartCandles
    : telemetryCandles[selectedChartSymbol]?.length
      ? telemetryCandles[selectedChartSymbol]
      : initialCandles[selectedChartSymbol] || [];
  const primaryPrice = heartbeat.latest_price ?? primaryMarket?.latest_price ?? status.last_price;
  const chartLastUpdate =
    status.last_heartbeat_at ||
    selectedChartState.last_update ||
    selectedChartState.updated_at ||
    (chartCandles.length ? chartCandles[chartCandles.length - 1]?.time : "");
  const chartLastCandle = chartCandles[chartCandles.length - 1];
  const openTrade = Number(metrics.open_trade || metrics.open_positions || 0);
  const totalTrades = Number(metrics.total_trades || 0);
  const wins = Number(metrics.wins || 0);
  const losses = Number(metrics.losses || 0);
  const breakevens = Number(metrics.breakevens || 0);
  const canStart =
    !busy &&
    !locked &&
    status.status !== "running" &&
    status.status !== "starting";
  const canStop =
    !busy && (status.status === "running" || status.status === "starting");
  const liveStatusLabel =
    status.status === "starting"
      ? "STARTING"
      : status.status === "running" && status.feed_status === "connected"
        ? "CONNECTED"
        : status.status === "running"
          ? "WAITING FOR FEED"
          : status.engine_ready
            ? "ENGINE READY"
            : "STOPPED";
  const setupScore =
    metrics.current_setup_score ??
    metrics.setup_score ??
    metrics.open_setup_score ??
    metrics.last_setup_score ??
    0;

  useEffect(() => {
    let cancelled = false;
    async function fetchCandles() {
      try {
        const res: any = await api(`/live-paper/candles?symbol=${selectedChartSymbol}&limit=100`);
        if (!cancelled && Array.isArray(res?.candles) && res.candles.length) {
          setInitialCandles((prev) => ({
            ...prev,
            [selectedChartSymbol]: res.candles,
          }));
        }
      } catch (err) {
        // Fallback silently if offline or endpoint not ready
      }
    }
    if (!status.candles?.[selectedChartSymbol]?.length && !initialCandles[selectedChartSymbol]?.length) {
      fetchCandles();
    }
    return () => {
      cancelled = true;
    };
  }, [selectedChartSymbol, status.candles, initialCandles]);

  useEffect(() => {
    if (uniqueBackendChartCandles.length) return;
    const price = Number(selectedChartPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    setTelemetryCandles((prev) => ({
      ...prev,
      [selectedChartSymbol]: appendTelemetryCandle(
        prev[selectedChartSymbol] || [],
        price,
        status.last_heartbeat_at || Date.now(),
        activeBarSecondsNum || 1,
        1000,
      ),
    }));
  }, [
    activeBarSecondsNum,
    metrics.processed,
    selectedChartPrice,
    selectedChartSymbol,
    status.last_heartbeat_at,
    status.processed,
    status.ticks_processed,
    uniqueBackendChartCandles.length,
  ]);

  return (
    <main style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <section style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 34, marginBottom: 8 }}>Live Paper Trading</h1>
        <p style={{ color: "#94a3b8" }}>
          Real-time Binance cryptocurrency markets · live market data · paper account equity 100000 · no real broker orders.
        </p>
      </section>

      <section style={{ ...panelStyle, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <h2 style={{ ...h2Style, marginBottom: 2 }}>{selectedChartSymbol} Live Market Chart</h2>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Select or search any of {allSymbols.length || 500}+ Binance cryptocurrency markets to view its real candlestick chart and live paper trades.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>Search Crypto:</span>
            <input
              type="text"
              placeholder="e.g. PEPE, SUI, DOGE..."
              value={symbolSearchQuery}
              onChange={(e) => setSymbolSearchQuery(e.target.value.toUpperCase())}
              style={{ ...inputStyle, width: 130, textTransform: "uppercase" }}
            />
            <select
              value={selectedChartSymbol}
              onChange={(e) => setChartSymbol(e.target.value)}
              style={{ ...inputStyle, minWidth: 160 }}
            >
              {allSymbols
                .filter((s) => !symbolSearchQuery.trim() || s.includes(symbolSearchQuery.trim().toUpperCase()))
                .slice(0, 100)
                .map((sym) => {
                  const p = marketRows.find((m: any) => m.symbol === sym)?.latest_price;
                  return (
                    <option key={sym} value={sym}>
                      {sym} {p ? `($${Number(p) < 1 ? Number(p).toFixed(4) : money(p)})` : ""}
                    </option>
                  );
                })}
            </select>
          </div>
        </div>

        {/* Popular & Active Crypto Quick-Tabs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(115px, 1fr))",
            gap: 8,
            marginBottom: 14,
          }}
        >
          {Array.from(new Set([
            ...POPULAR_SYMBOLS,
            ...(selectedChartSymbol ? [selectedChartSymbol] : []),
            ...selectedSymbols,
          ])).slice(0, 16).map((sym) => {
            const isSelected = sym === selectedChartSymbol;
            const symMarket = marketRows.find((m: any) => m.symbol === sym);
            const symPrice = symMarket?.latest_price || (symbolStateFor(status, sym) as any)?.last_price;
            const isTradeActive = (status.active_symbols?.includes(sym) || selectedSymbols.includes(sym)) && (status.status === "running" || status.status === "starting");
            return (
              <button
                key={sym}
                type="button"
                onClick={() => setChartSymbol(sym)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: isSelected ? "2px solid #38bdf8" : "1px solid #334155",
                  background: isSelected ? "rgba(56, 189, 248, 0.16)" : "#0b1220",
                  color: isSelected ? "#38bdf8" : "#cbd5e1",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.15s ease",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontWeight: isSelected ? 800 : 600, fontSize: 13 }}>
                  {isTradeActive && (
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 6px #22c55e" }} />
                  )}
                  {sym}
                </div>
                <div style={{ fontSize: 11, color: isSelected ? "#e0f2fe" : "#94a3b8" }}>
                  {Number(symPrice) > 0 ? (symPrice < 1 ? `$${Number(symPrice).toFixed(4)}` : `$${money(symPrice)}`) : "-"}
                </div>
              </button>
            );
          })}
        </div>

        {chartCandles.length ? (
          <TradingChart
            candles={chartCandles}
            markers={tradeRows.filter((t: any) => !t.symbol || String(t.symbol).toUpperCase() === selectedChartSymbol).slice(-8).map((t:any) => ({
              time: chartCandles[chartCandles.length - 1]?.time,
              position: t.result === 'LOSS' ? 'aboveBar' : 'belowBar',
              text: t.status === "OPEN" ? "OPEN" : t.result || 'TRADE',
              price: Number(t.exit_price || t.entry_price || primaryPrice || 0),
            }))}
            lines={openPositions.find((p: any) => String(p.symbol || "").toUpperCase() === selectedChartSymbol) ? [
              { title: 'Stop', price: Number(openPositions.find((p: any) => String(p.symbol || "").toUpperCase() === selectedChartSymbol)?.stop || 0), color: '#ef4444', style: 'dashed' as const },
              { title: 'Target 1', price: Number(openPositions.find((p: any) => String(p.symbol || "").toUpperCase() === selectedChartSymbol)?.target1 || 0), color: '#22c55e' },
              { title: 'Target 2', price: Number(openPositions.find((p: any) => String(p.symbol || "").toUpperCase() === selectedChartSymbol)?.target2 || 0), color: '#38bdf8' },
            ].filter((x:any)=>Number(x.price)>0) : []}
          />
        ) : (
          <div style={{ height: 320, border: "1px dashed #334155", borderRadius: 8, display: "grid", placeItems: "center", color: "#94a3b8", background: "#0f172a" }}>
            Loading {selectedChartSymbol} chart candles...
          </div>
        )}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#94a3b8", fontSize: 12, marginTop: 10 }}>
          <span>Market: <strong style={{ color: "#38bdf8" }}>{selectedChartSymbol}</strong></span>
          <span>Chart candles: {chartCandles.length}</span>
          <span>
            Last OHLC: {chartLastCandle
              ? `${Number(chartLastCandle.open).toFixed(2)} / ${Number(chartLastCandle.high).toFixed(2)} / ${Number(chartLastCandle.low).toFixed(2)} / ${Number(chartLastCandle.close).toFixed(2)}`
              : "not available"}
          </span>
          <span>Last price: {Number(selectedChartPrice) > 0 ? (selectedChartPrice < 1 ? `$${Number(selectedChartPrice).toFixed(4)}` : `$${money(selectedChartPrice)}`) : "not available"}</span>
          <span>Last update: {chartUpdateTime(chartLastUpdate)}</span>
        </div>
        <p style={{ color: '#fbbf24', marginBottom: 0, marginTop: 8 }}>Paper trading only. No real broker orders. No financial advice.</p>
      </section>

      <section style={{ ...panelStyle, marginBottom: 16 }}>
        <h2 style={h2Style}>Live Strategy Builder Config</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(260px, 1fr) repeat(5, minmax(120px, 170px))",
            gap: 12,
            alignItems: "end",
          }}
        >
          <label
            style={{ display: "grid", gap: 6, color: "#94a3b8", fontSize: 13 }}
          >
            Strategy used by live C++ engine
            <select
              value={selectedStrategyId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedStrategyId(id);
                const st = strategies.find((s) => s.id === id);
                if (st?.symbols?.length) setSelectedSymbols(st.symbols);
              }}
              disabled={!canStart}
              style={inputStyle}
            >
              <option value="">Latest saved strategy / default config</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || "Strategy"} ·{" "}
                  {s.user_strategy_id || s.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <Mini label="Active" value={activeStrategyName} />
          <Mini
            label="Lookback"
            value={String(cfgLookback)}
          />
          <Mini
            label="Min score"
            value={String(cfgMinScore)}
          />
          <Mini
            label="Risk %"
            value={String(cfgRiskPct)}
          />
          <Mini
            label="Bar length"
            value={activeBarSeconds === "-" ? "-" : `${activeBarSeconds}s`}
          />
        </div>
        <div
          style={{
            marginTop: 14,
            borderTop: "1px solid #243044",
            paddingTop: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <b>Activate paper markets</b>
            <div>
              <button
                type="button"
                onClick={selectAllLiveSymbols}
                disabled={!canStart}
                title="Select all popular markets"
              >
                Select Popular
              </button>{" "}
              <button
                type="button"
                className="secondary"
                onClick={useStrategySymbols}
                disabled={!canStart}
              >
                Use strategy symbols
              </button>
            </div>
          </div>
          <div className="symbol-picker">
            {Array.from(new Set([...POPULAR_SYMBOLS, ...selectedSymbols])).map((sym) => (
              <label key={sym} className="symbol-chip">
                <input
                  type="checkbox"
                  checked={selectedSymbols.includes(sym)}
                  disabled={!canStart}
                  onChange={() => toggleLiveSymbol(sym)}
                />
                <span>{sym}</span>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Add any crypto pair (e.g. PEPE, SUI, DOGE)..."
              value={customSymbolInput}
              onChange={(e) => setCustomSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomSymbol();
                }
              }}
              style={{ ...inputStyle, width: 280, textTransform: "uppercase" }}
            />
            <button
              type="button"
              onClick={addCustomSymbol}
              disabled={!canStart || !customSymbolInput.trim()}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              + Add to Markets
            </button>
          </div>

          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 8 }}>
            Selected active markets ({selectedSymbols.length}): {selectedSymbols.join(", ")}. Multi-symbol live paper mode executes real-time Binance market simulation on all selected pairs.
          </p>
        </div>
      </section>

      <section
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}
      >
        <button onClick={start} disabled={!canStart}>
          Start Live Paper Trading
        </button>
        <button
          onClick={stop}
          disabled={!canStop}
          style={{ background: "#ef4444" }}
        >
          Stop & Exit
        </button>
        <button
          onClick={() => {
            loadStrategies();
            refresh();
          }}
          disabled={busy}
          className="secondary"
        >
          Refresh
        </button>
        {locked && (
          <div
            style={{
              padding: "10px 14px",
              border: "1px solid #ef4444",
              borderRadius: 8,
              color: "#fecaca",
            }}
          >
            Locked for <Countdown until={wallet.locked_until} />
          </div>
        )}
      </section>

      <p
        style={{
          marginBottom: 20,
          color: status.error ? "#fecaca" : "#cbd5e1",
        }}
      >
        {message}
      </p>
      <section style={{ ...panelStyle, marginBottom: 20, background: "#0f172a" }}>
        <h2 style={h2Style}>Local engine status</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Mini label="Readiness" value={status.engine_ready ? "Engine ready" : "Binary missing"} />
          <Mini label="Process" value={status.process_running ? "Running" : "Stopped"} />
          <Mini label="Feed" value={String(status.feed_status || (status.engine_ready ? "ready" : "binary_missing")).replaceAll("_", " ")} />
          <Mini label="Heartbeat" value={status.last_heartbeat_at ? cleanTime(status.last_heartbeat_at) : "waiting for heartbeat"} />
          <Mini label="Active symbols" value={`${status.active_symbols?.length || 0} / ${status.selected_symbols?.length || selectedSymbols.length}`} />
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "#93c5fd", fontWeight: 800 }}>Debug: local binary resolution</summary>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <tbody>
              <SummaryRow label="Repo root" value={status.binary_diagnostics?.repo_root || "-"} />
              <SummaryRow label="Selected binary" value={status.selected_binary_path || status.binary_diagnostics?.selected_binary_path || "Not found"} />
              <SummaryRow label="Build command" value={status.binary_diagnostics?.build_command || "cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release --target prism_live_paper_trading"} />
            </tbody>
          </table>
          <pre style={preStyle}>{(status.binary_diagnostics?.checked_paths || []).join("\n") || "No checked paths reported yet."}</pre>
        </details>
      </section>
      <section style={{ ...panelStyle, marginBottom: 20, background: "#0f172a" }}>
        <h2 style={h2Style}>Execution model</h2>
        <p style={{ color: "#cbd5e1", fontSize: 13 }}>
          Live paper trading uses <b>realistic tick-based market fills</b>. Stop and target prices are intended trigger levels; actual exit price can differ because the paper broker exits on the next live Binance trade tick. The Trade Journal shows slippage explicitly so stop/target differences are transparent.
        </p>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 8 }}>
          Closed-trade metrics are shown from one atomic session snapshot. Cash Balance moves only after closed trades. Account Equity = Cash Balance + Unrealized PnL, so it can move every tick while a position is open. Wins/Losses, Gross R, Avg R and Last Result update together only after the C++ ledger reports a closed trade.
        </p>
      </section>

      {status.error && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#1e1b4b",
            padding: 12,
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          {status.error}
        </pre>
      )}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <Card label="Live status" value={liveStatusLabel} />
        <Card
          label={`${primarySymbol} price`}
          value={primaryPrice ? `$${money(primaryPrice)}` : "waiting for feed"}
        />
        <Card
          label="Account equity"
          value={`$${money(heartbeat.equity ?? accountEquity)}`}
        />
        <Card
          label="Cash balance"
          value={`$${money(heartbeat.cash ?? cashBalance)}`}
        />
        <Card
          label="Realized PnL"
          value={`$${money(realizedPnl)}`}
        />
        <Card
          label="Unrealized PnL"
          value={`$${money(heartbeat.unrealized_pnl ?? unrealizedPnl)}`}
        />
        <Card
          label="Open positions"
          value={openPositions.length ? `${openPositions.length} active` : "0"}
        />
        <Card
          label="Ticks processed"
          value={String(status.processed || metrics.processed || 0)}
        />
        <Card label="Signals" value={String(metrics.signals || 0)} />
        <Card label="Live setup score" value={String(setupScore)} />
        <Card label="Bars" value={String(metrics.bars || 0)} />
        <Card label="Total trades" value={String(totalTrades)} />
        <Card label="Heartbeat trades" value={heartbeat.trades === undefined ? "waiting for feed" : String(heartbeat.trades)} />
        <WinLossCard wins={wins} losses={losses} breakevens={breakevens} />
        <Card label="Gross R" value={String(metrics.gross_R ?? 0)} />
        <Card label="Avg R" value={String(metrics.avg_R ?? 0)} />
        <Card
          label="Last result"
          value={String(metrics.last_result || "NONE")}
        />
        <Card
          label="P95 engine"
          value={metrics.p95_engine_us ? `${metrics.p95_engine_us} us` : "not available"}
        />
        <Card label="Strategy ID" value={activeStrategyId || "-"} />
        <Card
          label="Live bar length"
          value={activeBarSeconds === "-" ? "-" : `${activeBarSeconds}s`}
        />
      </section>

      <section style={{ ...panelStyle, marginBottom: 20 }}>
        <h2 style={h2Style}>10 Binance Markets Monitor</h2>
        <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 10 }}>
          All 10 supported paper markets are listed here. ACTIVE_WEBSOCKET rows
          have emitted live ticks; WAITING rows are selected but have not emitted
          telemetry yet.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table
            className="pro-table"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                <Th>Symbol</Th>
                <Th>Covered</Th>
                <Th>Status</Th>
                <Th>Latest price</Th>
                <Th>Messages</Th>
                <Th>Bars</Th>
                <Th>Signals</Th>
                <Th>Trades</Th>
                <Th>P95 engine</Th>
              </tr>
            </thead>
            <tbody>
              {marketRows.length ? (
                marketRows.map((m: any) => (
                  <tr key={m.symbol}>
                    <Td>{m.symbol}</Td>
                    <Td>{m.covered ? "YES" : "NO"}</Td>
                    <Td>
                      <span
                        className={
                          m.paper_status === "ACTIVE_WEBSOCKET"
                            ? "pill pill-green"
                            : "pill pill-white"
                        }
                      >
                        {m.paper_status}
                      </span>
                    </Td>
                    <Td>
                      {m.latest_price ? `$${money(m.latest_price)}` : "waiting"}
                    </Td>
                    <Td>{m.paper_status === "SUPPORTED" ? "not started" : m.messages || 0}</Td>
                    <Td>{m.paper_status === "SUPPORTED" ? "not started" : m.bars || 0}</Td>
                    <Td>{m.paper_status === "SUPPORTED" ? "not started" : m.signals || 0}</Td>
                    <Td>{m.paper_status === "SUPPORTED" ? "not started" : m.trades || 0}</Td>
                    <Td>{m.p95_engine_us ? `${m.p95_engine_us} us` : "waiting"}</Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td colSpan={9}>
                    Market monitor waiting for backend status.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
        <div style={panelStyle}>
          <h2 style={h2Style}>Open Positions</h2>
          <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 10 }}>
            Multi-symbol paper positions are shown symbol-wise. No raw JSON is shown here.
          </p>
          {openPositions.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <Th>Symbol</Th>
                    <Th>Side</Th>
                    <Th>Entry</Th>
                    <Th>Qty</Th>
                    <Th>Current</Th>
                    <Th>Current R</Th>
                    <Th>Unrealized</Th>
                    <Th>Stop</Th>
                    <Th>Targets</Th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p: any, i: number) => (
                    <tr key={`${p.symbol || "POS"}-${i}`}>
                      <Td><span style={{ color: "#93c5fd", fontWeight: 800 }}>{p.symbol || "-"}</span></Td>
                      <Td>{p.side || "BUY"}</Td>
                      <Td>{displayValue(p.entry_price, (v) => `$${money(v)}`)}</Td>
                      <Td>{displayValue(p.qty)}</Td>
                      <Td>{displayValue(p.current_price, (v) => `$${money(v)}`)}</Td>
                      <Td><span style={signedStyle(p.current_R)}>{displayValue(p.current_R, (v) => `${Number(v).toFixed(3)}R`)}</span></Td>
                      <Td><span style={signedStyle(p.unrealized_pnl)}>{displayValue(p.unrealized_pnl, (v) => `$${money(v)}`)}</span></Td>
                      <Td>{displayValue(p.stop, (v) => `$${money(v)}`)}</Td>
                      <Td>{p.target1 ? `$${money(p.target1)} / ${displayValue(p.target2, (v) => `$${money(v)}`)}` : "not available"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ border: "1px dashed #334155", borderRadius: 10, padding: 16, color: "#94a3b8" }}>
              No open positions right now. New positions will appear here with symbol, entry, stop, targets and live R.
            </div>
          )}
        </div>
        <div style={panelStyle}>
          <h2 style={h2Style}>Live Strategy Config</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <SummaryRow label="Strategy ID" value={activeStrategyId || "-"} />
              <SummaryRow label="Strategy name" value={activeStrategyName} />
              <SummaryRow
                label="Symbols"
                value={(
                  liveConfig.symbols ||
                  selectedSymbols || [status.symbol || "BTCUSDT"]
                ).join(", ")}
              />
              <SummaryRow
                label="Timeframe"
                value={liveConfig.timeframe || "1m"}
              />
              <SummaryRow
                label="Bar length"
                value={
                  activeBarSeconds === "-" ? "-" : `${activeBarSeconds} seconds`
                }
              />
              <SummaryRow
                label="Lookback / Min score"
                value={`${cfgLookback} / ${cfgMinScore}`}
              />
              <SummaryRow
                label="Risk / Targets"
                value={`${cfgRiskPct}% · ${cfgTarget1}R / ${cfgTarget2}R`}
              />
              <SummaryRow
                label="Config file"
                value={
                  status.session_id && status.status !== "idle"
                    ? "Prepared internally"
                    : "Waiting for live session"
                }
              />
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ ...panelStyle, marginTop: 16 }}>
        <h2 style={h2Style}>Trade Journal</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Symbol</Th>
                <Th>Side</Th>
                <Th>Entry time</Th>
                <Th>Entry price</Th>
                <Th>Qty</Th>
                <Th>Exit time</Th>
                <Th>Exit price</Th>
                <Th>Exit reason</Th>
                <Th>Result</Th>
                <Th>R</Th>
                <Th>Stop</Th>
                <Th>Targets</Th>
                <Th>Slippage</Th>
              </tr>
            </thead>
            <tbody>
              {tradeRows.length ? (
                tradeRows.map((t, i) => (
                  <tr key={i}>
                    <Td>{tradeRows.length - i}</Td>
                    <Td><span style={{ color: "#93c5fd", fontWeight: 800 }}>{t.symbol || status.symbol || "-"}</span></Td>
                    <Td>{t.side || "BUY"}</Td>
                    <Td>{cleanTime(t.entry_time)}</Td>
                    <Td>${money(t.entry_price)}</Td>
                    <Td>{t.qty || "-"}</Td>
                    <Td>
                      {t.status === "OPEN" ? "-" : cleanTime(t.exit_time)}
                    </Td>
                    <Td>
                      {t.status === "OPEN" ? "-" : `$${money(t.exit_price)}`}
                    </Td>
                    <Td><span style={reasonStyle(t.exit_reason)}>{t.exit_reason || "-"}</span></Td>
                    <Td>
                      <span
                        style={resultStyle(
                          t.status === "OPEN" ? "OPEN" : t.result,
                        )}
                      >
                        {t.status === "OPEN" ? "OPEN" : t.result || "-"}
                      </span>
                    </Td>
                    <Td>
                      <span style={signedStyle(t.r)}>
                        {t.r && t.r !== "-" ? Number(t.r).toFixed(3) : "-"}
                      </span>
                    </Td>
                    <Td>{t.stop ? `$${money(t.stop)}` : "-"}</Td>
                    <Td>
                      {t.target1
                        ? `$${money(t.target1)} / $${money(t.target2)}`
                        : "-"}
                    </Td>
                    <Td>
                      {(() => {
                        const slip = slippageInTradeDirection(t);
                        return slip === null ? "-" : (
                          <span style={signedStyle(slip)}>
                            {slip >= 0 ? "+" : "-"}${money(Math.abs(slip))}
                          </span>
                        );
                      })()}
                    </Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td colSpan={14}>
                    No paper trades yet. The strategy needs enough closed bars
                    and a valid setup before it opens a trade.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>



    </main>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td
        style={{
          borderBottom: "1px solid #1e293b",
          padding: "8px 6px",
          color: "#94a3b8",
          width: 160,
        }}
      >
        {label}
      </td>
      <td
        style={{
          borderBottom: "1px solid #1e293b",
          padding: "8px 6px",
          fontWeight: 700,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

function WinLossCard({
  wins,
  losses,
  breakevens,
}: {
  wins: number;
  losses: number;
  breakevens: number;
}) {
  return (
    <div style={panelStyle}>
      <div style={{ color: "#94a3b8", fontSize: 13 }}>Wins / Losses / BE</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>
        <span style={countStyle("win")}>{wins}</span>
        <span style={{ color: "#64748b" }}> / </span>
        <span style={countStyle("loss")}>{losses}</span>
        <span style={{ color: "#64748b" }}> / </span>
        <span style={countStyle("be")}>{breakevens}</span>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  const lower = label.toLowerCase();
  const style = lower.includes("last result")
    ? resultStyle(value)
    : lower.includes("pnl") ||
        lower.includes("gross r") ||
        lower.includes("avg r")
      ? signedStyle(value)
      : {};
  return (
    <div style={panelStyle}>
      <div style={{ color: "#94a3b8", fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, ...style }}>
        {value}
      </div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "#94a3b8", fontSize: 12 }}>{label}</div>
      <div
        style={{
          fontWeight: 700,
          marginTop: 5,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}
function Th({ children }: any) {
  return (
    <th
      style={{
        textAlign: "left",
        color: "#94a3b8",
        borderBottom: "1px solid #334155",
        padding: 8,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, colSpan }: any) {
  return (
    <td
      colSpan={colSpan}
      style={{
        borderBottom: "1px solid #1e293b",
        padding: 8,
        verticalAlign: "top",
        fontSize: 13,
      }}
    >
      {children}
    </td>
  );
}
const panelStyle: CSSProperties = {
  background: "#111827",
  border: "1px solid #243044",
  borderRadius: 12,
  padding: 16,
};
const h2Style: CSSProperties = { fontSize: 18, marginBottom: 12 };
const preStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  overflowX: "auto",
  color: "#cbd5e1",
  fontSize: 13,
};
const inputStyle: CSSProperties = {
  background: "#0b1020",
  color: "#e5e7eb",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "10px 12px",
};
