"use client";

import { useMemo, useState } from "react";
import { classifyTradeResultFromR, cleanupExitReason } from "../lib/tradeClassification";

export interface TradeRecord {
  trade_id?: string | number;
  symbol?: string;
  side?: string;
  entry_time?: string;
  entry_price?: number | string;
  stop_loss?: number | string;
  target1?: number | string;
  target2?: number | string;
  exit_time?: string;
  exit_price?: number | string;
  exit_reason?: string;
  r_multiple?: number | string;
  setup_score_at_entry?: number | string;
  regime_at_entry?: string;
  holding_bars?: number | string;
  [key: string]: any;
}

export interface SymbolStat {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: number;
  gross_R: number;
  net_R: number;
  profit_factor: number | null;
  max_drawdown_in_R: number;
  avg_R: number;
  best_R: number;
  worst_R: number;
}

interface BacktestAnalyticsProps {
  trades: TradeRecord[];
  summary?: any;
  strategyName?: string;
  feePct?: number;
  slippagePct?: number;
  riskPct?: number;
}

function fmt(n: any, d = 2): string {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x.toFixed(d).replace(/\.00$/, "") : "0";
}

function pct(n: any): string {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "0%";
}

function signedColor(n: any): string {
  const x = Number(n ?? 0);
  return x > 0 ? "#4ade80" : x < 0 ? "#f87171" : "#94a3b8";
}

function getTradeR(t: TradeRecord): number {
  const raw = t.r_multiple ?? t.R_multiple ?? t.r ?? 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function getTradeSide(t: TradeRecord): "LONG" | "SHORT" {
  if (t.side) {
    const s = String(t.side).toUpperCase();
    if (s.includes("SHORT") || s === "SELL") return "SHORT";
    return "LONG";
  }
  const ep = Number(t.entry_price);
  const sl = Number(t.stop_loss);
  if (Number.isFinite(ep) && Number.isFinite(sl) && sl > ep) return "SHORT";
  return "LONG";
}

export default function BacktestAnalytics({
  trades = [],
  summary,
  strategyName = "PRISM_STRATEGY",
  feePct = 0.04,
  slippagePct = 0.01,
  riskPct = 1.0,
}: BacktestAnalyticsProps) {
  const [selectedSymbolFilter, setSelectedSymbolFilter] = useState<string>("ALL");
  const [chartViewMode, setChartViewMode] = useState<"both" | "equity" | "drawdown">("both");
  const [logOutcomeFilter, setLogOutcomeFilter] = useState<"ALL" | "WIN" | "LOSS" | "BREAKEVEN">("ALL");
  const [logSearchQuery, setLogSearchQuery] = useState<string>("");
  const [logPage, setLogPage] = useState<number>(1);
  const [logPageSize, setLogPageSize] = useState<number>(15);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Available unique symbols
  const uniqueSymbols = useMemo(() => {
    const set = new Set<string>();
    trades.forEach((t) => {
      const s = String(t.symbol || "").trim().toUpperCase();
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [trades]);

  // Filtered trades based on top symbol filter
  const activeTrades = useMemo(() => {
    if (selectedSymbolFilter === "ALL") return trades;
    return trades.filter(
      (t) => String(t.symbol || "").trim().toUpperCase() === selectedSymbolFilter
    );
  }, [trades, selectedSymbolFilter]);

  // Equity Curve Points calculation
  const equityPoints = useMemo(() => {
    let cumR = 0;
    let peakR = 0;
    interface EquityPoint {
      index: number;
      tradeId: string | number;
      time: string;
      symbol: string;
      side: string;
      r: number;
      cumulativeR: number;
      highWaterMark: number;
      drawdownR: number;
      exitReason: string;
    }
    const pts: EquityPoint[] = [
      {
        index: 0,
        tradeId: 0,
        time: activeTrades[0]?.entry_time || "Start",
        symbol: selectedSymbolFilter,
        side: "-",
        r: 0,
        cumulativeR: 0,
        highWaterMark: 0,
        drawdownR: 0,
        exitReason: "Initial Equity",
      },
    ];

    activeTrades.forEach((t, i) => {
      const r = getTradeR(t);
      cumR += r;
      if (cumR > peakR) peakR = cumR;
      const dd = cumR - peakR;
      pts.push({
        index: i + 1,
        tradeId: t.trade_id ?? i + 1,
        time: t.exit_time || t.entry_time || `Trade ${i + 1}`,
        symbol: String(t.symbol || "").toUpperCase() || "MARKET",
        side: getTradeSide(t),
        r,
        cumulativeR: Number(cumR.toFixed(4)),
        highWaterMark: Number(peakR.toFixed(4)),
        drawdownR: Number(dd.toFixed(4)),
        exitReason: String(t.exit_reason || "EXIT"),
      });
    });

    return pts;
  }, [activeTrades, selectedSymbolFilter]);

  // Stats for the active equity curve
  const curveStats = useMemo(() => {
    if (equityPoints.length <= 1) {
      return { finalR: 0, peakR: 0, maxDd: 0, recoveryFactor: 0, wins: 0, losses: 0, be: 0 };
    }
    const finalPt = equityPoints[equityPoints.length - 1];
    const finalR = finalPt.cumulativeR;
    let peak = 0;
    let maxDd = 0;
    let wins = 0;
    let losses = 0;
    let be = 0;

    activeTrades.forEach((t) => {
      const r = getTradeR(t);
      if (r > 0.0001) wins++;
      else if (r < -0.0001) losses++;
      else be++;
    });

    equityPoints.forEach((p) => {
      if (p.cumulativeR > peak) peak = p.cumulativeR;
      const dd = peak - p.cumulativeR;
      if (dd > maxDd) maxDd = dd;
    });

    const recoveryFactor = maxDd > 0 ? Number((finalR / maxDd).toFixed(2)) : finalR > 0 ? 99.9 : 0;
    return {
      finalR,
      peakR: peak,
      maxDd: -maxDd,
      recoveryFactor,
      wins,
      losses,
      be,
    };
  }, [equityPoints, activeTrades]);

  // Per-symbol breakdown statistics
  const symbolBreakdown = useMemo((): SymbolStat[] => {
    const frictionR = ((feePct * 2) + (slippagePct * 2)) / (riskPct || 1.0);
    const groups: Record<string, TradeRecord[]> = {};

    uniqueSymbols.forEach((s) => {
      groups[s] = [];
    });

    trades.forEach((t) => {
      const s = String(t.symbol || "").trim().toUpperCase() || "UNKNOWN";
      if (!groups[s]) groups[s] = [];
      groups[s].push(t);
    });

    return Object.entries(groups).map(([sym, symTrades]) => {
      const rs = symTrades.map(getTradeR);
      const n = rs.length;
      const wins = rs.filter((x) => x > 0.0001);
      const losses = rs.filter((x) => x < -0.0001);
      const be = rs.filter((x) => Math.abs(x) <= 0.0001);
      const grossR = rs.reduce((a, b) => a + b, 0);
      const netR = grossR - (frictionR * n);
      const grossWin = wins.reduce((a, b) => a + b, 0);
      const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
      const pf = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 999 : null;

      let peak = 0;
      let eq = 0;
      let maxDd = 0;
      rs.forEach((x) => {
        eq += x;
        if (eq > peak) peak = eq;
        if (peak - eq > maxDd) maxDd = peak - eq;
      });

      return {
        symbol: sym,
        trades: n,
        wins: wins.length,
        losses: losses.length,
        breakeven: be.length,
        win_rate: n > 0 ? wins.length / n : 0,
        gross_R: Number(grossR.toFixed(3)),
        net_R: Number(netR.toFixed(3)),
        profit_factor: pf,
        max_drawdown_in_R: Number((-maxDd).toFixed(3)),
        avg_R: n > 0 ? Number((grossR / n).toFixed(3)) : 0,
        best_R: rs.length ? Number(Math.max(...rs).toFixed(3)) : 0,
        worst_R: rs.length ? Number(Math.min(...rs).toFixed(3)) : 0,
      };
    });
  }, [trades, uniqueSymbols, feePct, slippagePct, riskPct]);

  // Aggregate Basket Total
  const basketTotal = useMemo((): SymbolStat => {
    const totalTrades = symbolBreakdown.reduce((sum, s) => sum + s.trades, 0);
    const totalWins = symbolBreakdown.reduce((sum, s) => sum + s.wins, 0);
    const totalLosses = symbolBreakdown.reduce((sum, s) => sum + s.losses, 0);
    const totalBe = symbolBreakdown.reduce((sum, s) => sum + s.breakeven, 0);
    const totalGross = symbolBreakdown.reduce((sum, s) => sum + s.gross_R, 0);
    const totalNet = symbolBreakdown.reduce((sum, s) => sum + s.net_R, 0);

    return {
      symbol: "BASKET TOTAL",
      trades: totalTrades,
      wins: totalWins,
      losses: totalLosses,
      breakeven: totalBe,
      win_rate: totalTrades > 0 ? totalWins / totalTrades : 0,
      gross_R: Number(totalGross.toFixed(2)),
      net_R: Number(totalNet.toFixed(2)),
      profit_factor: summary?.profit_factor ?? (totalLosses ? Number((totalWins / totalLosses).toFixed(2)) : 0),
      max_drawdown_in_R: curveStats.maxDd,
      avg_R: totalTrades > 0 ? Number((totalGross / totalTrades).toFixed(3)) : 0,
      best_R: Math.max(0, ...symbolBreakdown.map((s) => s.best_R)),
      worst_R: Math.min(0, ...symbolBreakdown.map((s) => s.worst_R)),
    };
  }, [symbolBreakdown, summary, curveStats]);

  // Filtered trades for Inspection Log Table
  const filteredLogTrades = useMemo(() => {
    return activeTrades.filter((t, i) => {
      const r = getTradeR(t);
      const res = classifyTradeResultFromR(r);
      if (logOutcomeFilter !== "ALL" && res !== logOutcomeFilter) return false;

      if (logSearchQuery.trim()) {
        const q = logSearchQuery.toLowerCase();
        const tid = String(t.trade_id ?? i + 1).toLowerCase();
        const sym = String(t.symbol || "").toLowerCase();
        const reason = String(t.exit_reason || "").toLowerCase();
        const entryTime = String(t.entry_time || "").toLowerCase();
        const exitTime = String(t.exit_time || "").toLowerCase();
        if (
          !tid.includes(q) &&
          !sym.includes(q) &&
          !reason.includes(q) &&
          !entryTime.includes(q) &&
          !exitTime.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [activeTrades, logOutcomeFilter, logSearchQuery]);

  // Paginated log trades
  const totalLogPages = Math.max(1, Math.ceil(filteredLogTrades.length / logPageSize));
  const currentLogTrades = useMemo(() => {
    const start = (logPage - 1) * logPageSize;
    return filteredLogTrades.slice(start, start + logPageSize);
  }, [filteredLogTrades, logPage, logPageSize]);

  // Export CSV
  function downloadCsv() {
    if (!trades.length) return;
    const headers = [
      "Trade ID",
      "Symbol",
      "Side",
      "Entry Time",
      "Entry Price",
      "Stop Loss",
      "Target 1",
      "Target 2",
      "Exit Time",
      "Exit Price",
      "Exit Reason",
      "Realized R",
      "Outcome",
      "Setup Score",
      "Holding Bars",
    ];

    const rows = trades.map((t, idx) => {
      const r = getTradeR(t);
      return [
        t.trade_id ?? idx + 1,
        String(t.symbol || "").toUpperCase() || "UNKNOWN",
        getTradeSide(t),
        t.entry_time || "",
        t.entry_price ?? "",
        t.stop_loss ?? "",
        t.target1 ?? "",
        t.target2 ?? "",
        t.exit_time ?? "",
        t.exit_price ?? "",
        t.exit_reason ?? "",
        r,
        classifyTradeResultFromR(r),
        t.setup_score_at_entry ?? "",
        t.holding_bars ?? "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    });

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = strategyName.replace(/[^a-zA-Z0-9_-]/g, "_");
    link.setAttribute("href", url);
    link.setAttribute("download", `${safeName}_trades_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Chart Dimensions & Geometry
  const chartW = 900;
  const equityH = chartViewMode === "equity" ? 280 : chartViewMode === "both" ? 180 : 0;
  const ddH = chartViewMode === "drawdown" ? 220 : chartViewMode === "both" ? 110 : 0;
  const gap = chartViewMode === "both" ? 24 : 0;
  const totalChartH = equityH + ddH + gap + 40;
  const padLeft = 55;
  const padRight = 30;
  const plotW = chartW - padLeft - padRight;

  // Min/Max calculations for Equity Pane
  const maxEqR = Math.max(1, ...equityPoints.map((p) => Math.max(p.cumulativeR, p.highWaterMark))) * 1.1;
  const minEqR = Math.min(0, ...equityPoints.map((p) => p.cumulativeR)) * 1.1;
  const rangeEqR = Math.max(0.1, maxEqR - minEqR);

  // Min/Max for Drawdown Pane
  const minDdR = Math.min(-0.5, ...equityPoints.map((p) => p.drawdownR)) * 1.15;
  const rangeDdR = Math.abs(minDdR) || 1;

  function getX(index: number): number {
    if (equityPoints.length <= 1) return padLeft + plotW / 2;
    return padLeft + (index / (equityPoints.length - 1)) * plotW;
  }

  function getEqY(r: number): number {
    const fraction = (maxEqR - r) / rangeEqR;
    return 15 + fraction * (equityH - 30);
  }

  function getDdY(dd: number): number {
    const top = equityH + gap + 10;
    const fraction = Math.abs(dd) / rangeDdR;
    return top + fraction * (ddH - 25);
  }

  // SVG Paths
  const equityPath = useMemo(() => {
    if (equityPoints.length === 0) return "";
    return equityPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.index).toFixed(1)} ${getEqY(p.cumulativeR).toFixed(1)}`)
      .join(" ");
  }, [equityPoints, maxEqR, minEqR]);

  const equityAreaPath = useMemo(() => {
    if (equityPoints.length === 0) return "";
    const zeroY = getEqY(0);
    const firstX = getX(0);
    const lastX = getX(equityPoints.length - 1);
    const line = equityPoints
      .map((p) => `L ${getX(p.index).toFixed(1)} ${getEqY(p.cumulativeR).toFixed(1)}`)
      .join(" ");
    return `M ${firstX.toFixed(1)} ${zeroY.toFixed(1)} ${line} L ${lastX.toFixed(1)} ${zeroY.toFixed(1)} Z`;
  }, [equityPoints, maxEqR, minEqR]);

  const hwmPath = useMemo(() => {
    if (equityPoints.length === 0) return "";
    return equityPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.index).toFixed(1)} ${getEqY(p.highWaterMark).toFixed(1)}`)
      .join(" ");
  }, [equityPoints, maxEqR, minEqR]);

  const ddAreaPath = useMemo(() => {
    if (equityPoints.length === 0) return "";
    const topY = equityH + gap + 10;
    const firstX = getX(0);
    const lastX = getX(equityPoints.length - 1);
    const line = equityPoints
      .map((p) => `L ${getX(p.index).toFixed(1)} ${getDdY(p.drawdownR).toFixed(1)}`)
      .join(" ");
    return `M ${firstX.toFixed(1)} ${topY.toFixed(1)} ${line} L ${lastX.toFixed(1)} ${topY.toFixed(1)} Z`;
  }, [equityPoints, minDdR, equityH, gap, ddH]);

  const hoveredPoint = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < equityPoints.length
    ? equityPoints[hoverIndex]
    : null;

  return (
    <div style={{ marginTop: 24, marginBottom: 28, display: "grid", gap: 24 }}>
      {/* ─── MODULE 1: INTERACTIVE EQUITY CURVE & UNDERWATER DRAWDOWN ─── */}
      <div
        style={{
          background: "linear-gradient(180deg, rgba(17, 24, 39, 0.85) 0%, rgba(13, 19, 33, 0.95) 100%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 16 }}>📈</span>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: "-0.01em" }}>
                Cumulative Equity Curve & Underwater Drawdown
              </h3>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 12 }}>
              Continuous R-multiple progression and high-water mark drawdown simulation
            </p>
          </div>

          {/* Quick KPIs */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 8, padding: "6px 12px", textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Final Return</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: signedColor(curveStats.finalR) }}>
                {curveStats.finalR > 0 ? "+" : ""}{fmt(curveStats.finalR)} R
              </div>
            </div>

            <div style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 8, padding: "6px 12px", textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Peak Equity</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#38bdf8" }}>
                +{fmt(curveStats.peakR)} R
              </div>
            </div>

            <div style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 8, padding: "6px 12px", textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Max Drawdown</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#f87171" }}>
                {fmt(curveStats.maxDd)} R
              </div>
            </div>

            <div style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: 8, padding: "6px 12px", textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Recovery Factor</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0" }}>
                {fmt(curveStats.recoveryFactor)}
              </div>
            </div>
          </div>
        </div>

        {/* View mode switcher & Symbol filters */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setSelectedSymbolFilter("ALL")}
              style={{
                background: selectedSymbolFilter === "ALL" ? "rgba(99, 102, 241, 0.25)" : "rgba(30, 41, 59, 0.6)",
                color: selectedSymbolFilter === "ALL" ? "#a5b4fc" : "#94a3b8",
                border: `1px solid ${selectedSymbolFilter === "ALL" ? "#6366f1" : "rgba(255, 255, 255, 0.08)"}`,
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              All Basket Pairs ({trades.length})
            </button>
            {uniqueSymbols.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => setSelectedSymbolFilter(sym)}
                style={{
                  background: selectedSymbolFilter === sym ? "rgba(99, 102, 241, 0.25)" : "rgba(30, 41, 59, 0.6)",
                  color: selectedSymbolFilter === sym ? "#a5b4fc" : "#94a3b8",
                  border: `1px solid ${selectedSymbolFilter === sym ? "#6366f1" : "rgba(255, 255, 255, 0.08)"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {sym}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, background: "rgba(15, 23, 42, 0.7)", padding: 3, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              type="button"
              onClick={() => setChartViewMode("both")}
              style={{
                background: chartViewMode === "both" ? "rgba(99, 102, 241, 0.4)" : "transparent",
                color: chartViewMode === "both" ? "#ffffff" : "#94a3b8",
                border: "none",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Dual Pane
            </button>
            <button
              type="button"
              onClick={() => setChartViewMode("equity")}
              style={{
                background: chartViewMode === "equity" ? "rgba(99, 102, 241, 0.4)" : "transparent",
                color: chartViewMode === "equity" ? "#ffffff" : "#94a3b8",
                border: "none",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Equity Only
            </button>
            <button
              type="button"
              onClick={() => setChartViewMode("drawdown")}
              style={{
                background: chartViewMode === "drawdown" ? "rgba(99, 102, 241, 0.4)" : "transparent",
                color: chartViewMode === "drawdown" ? "#ffffff" : "#94a3b8",
                border: "none",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Drawdown Only
            </button>
          </div>
        </div>

        {/* SVG Equity Chart Container */}
        {activeTrades.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#64748b", fontSize: 13, background: "rgba(15, 23, 42, 0.4)", borderRadius: 10 }}>
            No trades executed for {selectedSymbolFilter === "ALL" ? "the selected basket" : selectedSymbolFilter}.
          </div>
        ) : (
          <div style={{ position: "relative", width: "100%", overflowX: "auto" }}>
            <svg
              viewBox={`0 0 ${chartW} ${totalChartH}`}
              style={{ width: "100%", height: "auto", display: "block", userSelect: "none" }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = (e.clientX - rect.left) * (chartW / rect.width);
                const relX = Math.max(padLeft, Math.min(padLeft + plotW, mouseX));
                const ratio = (relX - padLeft) / plotW;
                const idx = Math.round(ratio * (equityPoints.length - 1));
                setHoverIndex(idx);
              }}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                <linearGradient id="eq-grad-pos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="dd-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0.45" />
                </linearGradient>
              </defs>

              {/* ─── PANE 1: Equity Curve ─── */}
              {equityH > 0 && (
                <g>
                  {/* Pane label */}
                  <text x={padLeft} y={12} fill="#64748b" fontSize="10" fontWeight="700" textAnchor="start">
                    CUMULATIVE RETURN (R-MULTIPLES)
                  </text>

                  {/* Horizontal grid lines & Y labels */}
                  {[maxEqR, (maxEqR + minEqR) / 2, 0, minEqR].map((level, i) => {
                    const y = getEqY(level);
                    return (
                      <g key={i}>
                        <line
                          x1={padLeft}
                          y1={y}
                          x2={padLeft + plotW}
                          y2={y}
                          stroke={level === 0 ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)"}
                          strokeDasharray={level === 0 ? "4 4" : undefined}
                        />
                        <text
                          x={padLeft - 8}
                          y={y + 3}
                          fill={level === 0 ? "#cbd5e1" : "#64748b"}
                          fontSize="10"
                          textAnchor="end"
                          fontWeight={level === 0 ? "700" : "500"}
                        >
                          {level > 0 ? "+" : ""}{level.toFixed(1)}R
                        </text>
                      </g>
                    );
                  })}

                  {/* High water mark line */}
                  <path d={hwmPath} fill="none" stroke="#38bdf8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />

                  {/* Gradient area */}
                  <path d={equityAreaPath} fill="url(#eq-grad-pos)" />

                  {/* Equity main line */}
                  <path
                    d={equityPath}
                    fill="none"
                    stroke={curveStats.finalR >= 0 ? "#22c55e" : "#f87171"}
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
              )}

              {/* ─── PANE 2: Underwater Drawdown ─── */}
              {ddH > 0 && (
                <g>
                  {/* Pane label */}
                  <text x={padLeft} y={equityH + gap + 4} fill="#64748b" fontSize="10" fontWeight="700" textAnchor="start">
                    UNDERWATER DRAWDOWN (R)
                  </text>

                  {/* 0 Drawdown baseline */}
                  <line
                    x1={padLeft}
                    y1={equityH + gap + 10}
                    x2={padLeft + plotW}
                    y2={equityH + gap + 10}
                    stroke="rgba(255, 255, 255, 0.2)"
                    strokeWidth="1"
                  />
                  <text x={padLeft - 8} y={equityH + gap + 14} fill="#94a3b8" fontSize="10" textAnchor="end" fontWeight="700">
                    0.0R
                  </text>

                  {/* Max drawdown horizontal line */}
                  <line
                    x1={padLeft}
                    y1={getDdY(curveStats.maxDd)}
                    x2={padLeft + plotW}
                    y2={getDdY(curveStats.maxDd)}
                    stroke="rgba(239, 68, 68, 0.3)"
                    strokeDasharray="3 3"
                  />
                  <text x={padLeft - 8} y={getDdY(curveStats.maxDd) + 3} fill="#f87171" fontSize="10" textAnchor="end">
                    {curveStats.maxDd.toFixed(1)}R
                  </text>

                  {/* Drawdown area */}
                  <path d={ddAreaPath} fill="url(#dd-grad)" />

                  {/* Drawdown outline */}
                  <path
                    d={equityPoints
                      .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.index).toFixed(1)} ${getDdY(p.drawdownR).toFixed(1)}`)
                      .join(" ")}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </g>
              )}

              {/* Bottom Trade Count Axis */}
              <line
                x1={padLeft}
                y1={totalChartH - 25}
                x2={padLeft + plotW}
                y2={totalChartH - 25}
                stroke="rgba(255, 255, 255, 0.1)"
              />
              {[0, 0.25, 0.5, 0.75, 1].map((pctStep, idx) => {
                const ptIdx = Math.round(pctStep * (equityPoints.length - 1));
                const x = getX(ptIdx);
                return (
                  <g key={idx}>
                    <line x1={x} y1={totalChartH - 25} x2={x} y2={totalChartH - 20} stroke="rgba(255,255,255,0.15)" />
                    <text x={x} y={totalChartH - 10} fill="#64748b" fontSize="10" textAnchor="middle">
                      Trade {ptIdx}
                    </text>
                  </g>
                );
              })}

              {/* Hover Crosshair & Indicators */}
              {hoveredPoint && (
                <g>
                  {/* Vertical cursor guide */}
                  <line
                    x1={getX(hoveredPoint.index)}
                    y1={10}
                    x2={getX(hoveredPoint.index)}
                    y2={totalChartH - 25}
                    stroke="#38bdf8"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity="0.8"
                  />

                  {/* Dot on equity curve */}
                  {equityH > 0 && (
                    <circle
                      cx={getX(hoveredPoint.index)}
                      cy={getEqY(hoveredPoint.cumulativeR)}
                      r="4.5"
                      fill="#22c55e"
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                  )}

                  {/* Dot on drawdown curve */}
                  {ddH > 0 && (
                    <circle
                      cx={getX(hoveredPoint.index)}
                      cy={getDdY(hoveredPoint.drawdownR)}
                      r="4"
                      fill="#ef4444"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  )}
                </g>
              )}
            </svg>

            {/* Interactive Floating Tooltip */}
            {hoveredPoint && (
              <div
                style={{
                  position: "absolute",
                  left: Math.min(plotW - 140, Math.max(10, (hoveredPoint.index / (equityPoints.length - 1)) * plotW)),
                  top: 15,
                  background: "rgba(15, 23, 42, 0.95)",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 11,
                  color: "#f8fafc",
                  pointerEvents: "none",
                  boxShadow: "0 8px 20px rgba(0, 0, 0, 0.4)",
                  minWidth: 170,
                  zIndex: 10,
                }}
              >
                <div style={{ fontWeight: 800, color: "#38bdf8", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 4, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                  <span>Trade #{hoveredPoint.index}</span>
                  <span>{hoveredPoint.symbol} ({hoveredPoint.side})</span>
                </div>
                <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 4 }}>
                  {hoveredPoint.time}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: "#94a3b8" }}>Realized R:</span>
                  <span style={{ fontWeight: 700, color: signedColor(hoveredPoint.r) }}>
                    {hoveredPoint.r > 0 ? "+" : ""}{fmt(hoveredPoint.r)} R
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: "#94a3b8" }}>Portfolio Equity:</span>
                  <span style={{ fontWeight: 700, color: signedColor(hoveredPoint.cumulativeR) }}>
                    {hoveredPoint.cumulativeR > 0 ? "+" : ""}{fmt(hoveredPoint.cumulativeR)} R
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: "#94a3b8" }}>Drawdown:</span>
                  <span style={{ fontWeight: 700, color: hoveredPoint.drawdownR === 0 ? "#4ade80" : "#f87171" }}>
                    {hoveredPoint.drawdownR === 0 ? "0.00 R (Peak)" : `${fmt(hoveredPoint.drawdownR)} R`}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 2 }}>
                  <span style={{ color: "#94a3b8" }}>Exit Reason:</span>
                  <span style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 10 }}>
                    {hoveredPoint.exitReason.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── MODULE 2: MULTI-SYMBOL BASKET PERFORMANCE BREAKDOWN ─── */}
      <div
        style={{
          background: "linear-gradient(180deg, rgba(17, 24, 39, 0.85) 0%, rgba(13, 19, 33, 0.95) 100%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>🪙</span>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: "-0.01em" }}>
                Multi-Market Basket Performance Breakdown
              </h3>
            </div>
            <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
              Independent performance attribution per tested cryptocurrency pair ({symbolBreakdown.length} markets)
            </p>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            Click any row to filter trade log and equity curve
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", color: "#94a3b8" }}>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Market</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Trades</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>W / L / BE</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Win Rate</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Gross Return</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Net Return (Fric)</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Profit Factor</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Max DD (R)</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Avg R / Trade</th>
                <th style={{ padding: "10px 12px", textTransform: "uppercase", fontSize: 11 }}>Best / Worst</th>
              </tr>
            </thead>
            <tbody>
              {symbolBreakdown.map((s) => {
                const isSelected = selectedSymbolFilter === s.symbol;
                return (
                  <tr
                    key={s.symbol}
                    onClick={() => setSelectedSymbolFilter(isSelected ? "ALL" : s.symbol)}
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                      cursor: "pointer",
                      background: isSelected ? "rgba(99, 102, 241, 0.15)" : "transparent",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <td style={{ padding: "11px 12px", fontWeight: 700, color: "#f8fafc" }}>
                      <span
                        style={{
                          background: isSelected ? "rgba(99, 102, 241, 0.3)" : "rgba(30, 41, 59, 0.8)",
                          border: `1px solid ${isSelected ? "#818cf8" : "rgba(255,255,255,0.08)"}`,
                          borderRadius: 6,
                          padding: "3px 8px",
                          fontSize: 11,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {s.symbol}
                      </span>
                    </td>
                    <td style={{ padding: "11px 12px", color: "#cbd5e1" }}>{s.trades}</td>
                    <td style={{ padding: "11px 12px", color: "#94a3b8" }}>
                      <span style={{ color: "#4ade80" }}>{s.wins}</span> /{" "}
                      <span style={{ color: "#f87171" }}>{s.losses}</span> /{" "}
                      <span style={{ color: "#94a3b8" }}>{s.breakeven}</span>
                    </td>
                    <td style={{ padding: "11px 12px", fontWeight: 700, color: s.win_rate >= 0.5 ? "#4ade80" : "#fbbf24" }}>
                      {pct(s.win_rate)}
                    </td>
                    <td style={{ padding: "11px 12px", fontWeight: 700, color: signedColor(s.gross_R) }}>
                      {s.gross_R > 0 ? "+" : ""}{fmt(s.gross_R)} R
                    </td>
                    <td style={{ padding: "11px 12px", fontWeight: 700, color: signedColor(s.net_R) }}>
                      {s.net_R > 0 ? "+" : ""}{fmt(s.net_R)} R
                    </td>
                    <td style={{ padding: "11px 12px", color: "#f8fafc", fontWeight: 600 }}>
                      {s.profit_factor != null ? fmt(s.profit_factor) : "—"}
                    </td>
                    <td style={{ padding: "11px 12px", color: "#f87171" }}>
                      {fmt(s.max_drawdown_in_R)} R
                    </td>
                    <td style={{ padding: "11px 12px", color: signedColor(s.avg_R), fontWeight: 600 }}>
                      {s.avg_R > 0 ? "+" : ""}{fmt(s.avg_R)} R
                    </td>
                    <td style={{ padding: "11px 12px", color: "#94a3b8", fontSize: 11 }}>
                      <span style={{ color: "#4ade80" }}>+{fmt(s.best_R)}</span> /{" "}
                      <span style={{ color: "#f87171" }}>{fmt(s.worst_R)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Basket Total Summary Row */}
            <tfoot>
              <tr
                style={{
                  background: "rgba(15, 23, 42, 0.9)",
                  borderTop: "2px solid rgba(255, 255, 255, 0.12)",
                  fontWeight: 800,
                }}
              >
                <td style={{ padding: "12px", color: "#38bdf8" }}>
                  BASKET TOTAL ({symbolBreakdown.length} PAIRS)
                </td>
                <td style={{ padding: "12px", color: "#f8fafc" }}>{basketTotal.trades}</td>
                <td style={{ padding: "12px", color: "#cbd5e1" }}>
                  <span style={{ color: "#4ade80" }}>{basketTotal.wins}</span> /{" "}
                  <span style={{ color: "#f87171" }}>{basketTotal.losses}</span> /{" "}
                  <span style={{ color: "#94a3b8" }}>{basketTotal.breakeven}</span>
                </td>
                <td style={{ padding: "12px", color: basketTotal.win_rate >= 0.5 ? "#4ade80" : "#fbbf24" }}>
                  {pct(basketTotal.win_rate)}
                </td>
                <td style={{ padding: "12px", color: signedColor(basketTotal.gross_R) }}>
                  {basketTotal.gross_R > 0 ? "+" : ""}{fmt(basketTotal.gross_R)} R
                </td>
                <td style={{ padding: "12px", color: signedColor(basketTotal.net_R) }}>
                  {basketTotal.net_R > 0 ? "+" : ""}{fmt(basketTotal.net_R)} R
                </td>
                <td style={{ padding: "12px", color: "#f8fafc" }}>
                  {fmt(basketTotal.profit_factor)}
                </td>
                <td style={{ padding: "12px", color: "#f87171" }}>
                  {fmt(basketTotal.max_drawdown_in_R)} R
                </td>
                <td style={{ padding: "12px", color: signedColor(basketTotal.avg_R) }}>
                  {basketTotal.avg_R > 0 ? "+" : ""}{fmt(basketTotal.avg_R)} R
                </td>
                <td style={{ padding: "12px", color: "#94a3b8", fontSize: 11 }}>
                  <span style={{ color: "#4ade80" }}>+{fmt(basketTotal.best_R)}</span> /{" "}
                  <span style={{ color: "#f87171" }}>{fmt(basketTotal.worst_R)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ─── MODULE 3: TRADE-BY-TRADE INSPECTION LOG & CSV EXPORT ─── */}
      <div
        style={{
          background: "linear-gradient(180deg, rgba(17, 24, 39, 0.85) 0%, rgba(13, 19, 33, 0.95) 100%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>📋</span>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: "-0.01em" }}>
                Trade-by-Trade Execution Audit Log
              </h3>
            </div>
            <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
              Inspect simulated executions, fill levels, duration, and R-multiple realizations
            </p>
          </div>

          <button
            type="button"
            onClick={downloadCsv}
            disabled={trades.length === 0}
            style={{
              background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(79, 70, 229, 0.35) 100%)",
              color: "#a5b4fc",
              border: "1px solid rgba(99, 102, 241, 0.4)",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 700,
              cursor: trades.length === 0 ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>⬇</span> Export Trade Log (CSV)
          </button>
        </div>

        {/* Toolbar: Search & Outcome Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search by Symbol, ID, Exit Reason or Date..."
            value={logSearchQuery}
            onChange={(e) => {
              setLogSearchQuery(e.target.value);
              setLogPage(1);
            }}
            style={{
              background: "#0d1322",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 8,
              padding: "7px 12px",
              color: "#f8fafc",
              fontSize: 12,
              outline: "none",
              minWidth: 260,
              flex: "1 1 200px",
            }}
          />

          <select
            value={logOutcomeFilter}
            onChange={(e) => {
              setLogOutcomeFilter(e.target.value as any);
              setLogPage(1);
            }}
            style={{
              background: "#0d1322",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 8,
              padding: "7px 12px",
              color: "#cbd5e1",
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="ALL">All Outcomes</option>
            <option value="WIN">Winners (&gt;0 R)</option>
            <option value="LOSS">Losers (&lt;0 R)</option>
            <option value="BREAKEVEN">Breakeven (0 R)</option>
          </select>

          <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
            Showing {currentLogTrades.length} of {filteredLogTrades.length} trades
          </span>
        </div>

        {/* Trade Log Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", color: "#94a3b8" }}>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>#</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Symbol</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Side</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Entry Time</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Entry Price</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Exit Time</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Exit Price</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Holding</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Exit Reason</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Result</th>
                <th style={{ padding: "9px 10px", fontSize: 11, textTransform: "uppercase" }}>Realized R</th>
              </tr>
            </thead>
            <tbody>
              {currentLogTrades.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: "28px", textAlign: "center", color: "#64748b" }}>
                    No matching trades found.
                  </td>
                </tr>
              ) : (
                currentLogTrades.map((t, idx) => {
                  const r = getTradeR(t);
                  const result = classifyTradeResultFromR(r);
                  const reason = cleanupExitReason(t.exit_reason, r);
                  const side = getTradeSide(t);
                  const rowId = t.trade_id ?? (logPage - 1) * logPageSize + idx + 1;

                  return (
                    <tr
                      key={String(rowId)}
                      style={{
                        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                        transition: "background 0.1s ease",
                      }}
                    >
                      <td style={{ padding: "9px 10px", color: "#64748b", fontFamily: "monospace" }}>
                        {rowId}
                      </td>
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: "#f8fafc" }}>
                        <span
                          style={{
                            background: "rgba(30, 41, 59, 0.8)",
                            padding: "2px 6px",
                            borderRadius: 4,
                            border: "1px solid rgba(255,255,255,0.06)",
                            fontSize: 11,
                          }}
                        >
                          {String(t.symbol || "").toUpperCase() || "UNKNOWN"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <span
                          style={{
                            color: side === "LONG" ? "#4ade80" : "#f87171",
                            fontWeight: 700,
                            fontSize: 10,
                          }}
                        >
                          {side}
                        </span>
                      </td>
                      <td style={{ padding: "9px 10px", color: "#cbd5e1", fontSize: 11 }}>
                        {t.entry_time || "—"}
                      </td>
                      <td style={{ padding: "9px 10px", color: "#f8fafc", fontFamily: "monospace" }}>
                        ${fmt(t.entry_price)}
                      </td>
                      <td style={{ padding: "9px 10px", color: "#cbd5e1", fontSize: 11 }}>
                        {t.exit_time || "—"}
                      </td>
                      <td style={{ padding: "9px 10px", color: "#f8fafc", fontFamily: "monospace" }}>
                        ${fmt(t.exit_price)}
                      </td>
                      <td style={{ padding: "9px 10px", color: "#94a3b8" }}>
                        {t.holding_bars != null ? `${t.holding_bars} bars` : "—"}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <span
                          style={{
                            background:
                              reason.includes("TARGET")
                                ? "rgba(34, 197, 94, 0.15)"
                                : reason.includes("STOP")
                                  ? "rgba(239, 68, 68, 0.15)"
                                  : "rgba(148, 163, 184, 0.15)",
                            color:
                              reason.includes("TARGET")
                                ? "#4ade80"
                                : reason.includes("STOP")
                                  ? "#f87171"
                                  : "#cbd5e1",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {reason.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ padding: "9px 10px", fontWeight: 700 }}>
                        <span
                          style={{
                            color:
                              result === "WIN"
                                ? "#4ade80"
                                : result === "LOSS"
                                  ? "#f87171"
                                  : "#94a3b8",
                          }}
                        >
                          {result}
                        </span>
                      </td>
                      <td style={{ padding: "9px 10px", fontWeight: 800, color: signedColor(r) }}>
                        {r > 0 ? "+" : ""}{fmt(r, 3)} R
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {filteredLogTrades.length > logPageSize && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255, 255, 255, 0.06)", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Rows per page:</span>
              <select
                value={logPageSize}
                onChange={(e) => {
                  setLogPageSize(+e.target.value);
                  setLogPage(1);
                }}
                style={{
                  background: "#0d1322",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: 6,
                  padding: "3px 8px",
                  color: "#cbd5e1",
                  fontSize: 11,
                }}
              >
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                Page {logPage} of {totalLogPages}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  disabled={logPage <= 1}
                  onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                  style={{
                    background: "rgba(30, 41, 59, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    color: logPage <= 1 ? "#475569" : "#cbd5e1",
                    cursor: logPage <= 1 ? "not-allowed" : "pointer",
                    fontSize: 11,
                  }}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  disabled={logPage >= totalLogPages}
                  onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                  style={{
                    background: "rgba(30, 41, 59, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    color: logPage >= totalLogPages ? "#475569" : "#cbd5e1",
                    cursor: logPage >= totalLogPages ? "not-allowed" : "pointer",
                    fontSize: 11,
                  }}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
