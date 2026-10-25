"use client";

import React, { useState } from "react";
import { PortfolioAllocationConfig, DynamicUniverseFilter, AssetClass, WeightingMethod, RebalanceSchedule } from "../../types/strategy_v3";

interface Props {
  filter: DynamicUniverseFilter;
  onFilterChange: (f: DynamicUniverseFilter) => void;
  allocation: PortfolioAllocationConfig;
  onAllocationChange: (a: PortfolioAllocationConfig) => void;
  selectedSymbols: string[];
  onSelectSymbols: (symbols: string[]) => void;
}

const PRESET_BASKETS = {
  TOP_30_CRYPTO_ADV: {
    id: "TOP_30_CRYPTO_ADV",
    label: "Top 30 Binance Spot",
    badge: "CRYPTO",
    badgeColor: "#38bdf8",
    assetClass: "CRYPTO" as AssetClass,
    minAdv: 50_000_000,
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT", "NEARUSDT", "PEPEUSDT", "TRXUSDT", "DOTUSDT", "LTCUSDT"],
    desc: "Highest-liquidity spot & perp pairs filtered by 30-day ADV",
  },
  CME_INDEX_FUTURES: {
    id: "CME_INDEX_FUTURES",
    label: "CME Equity & Metal Futures",
    badge: "FUTURES",
    badgeColor: "#fbbf24",
    assetClass: "FUTURES" as AssetClass,
    minAdv: 10_000_000_000,
    symbols: ["NQ", "ES", "YM", "RTY", "GC"],
    desc: "CME micro/e-mini contracts (NQ, ES, YM, RTY, Gold)",
  },
  FX_MAJORS_CROSSES: {
    id: "FX_MAJORS_CROSSES",
    label: "Global FX Majors & G10",
    badge: "FOREX",
    badgeColor: "#34d399",
    assetClass: "FOREX" as AssetClass,
    minAdv: 50_000_000_000,
    symbols: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"],
    desc: "Top institutional currency pairs with tightest spreads",
  },
};

export default function UniverseSelector({
  filter,
  onFilterChange,
  allocation,
  onAllocationChange,
  selectedSymbols,
  onSelectSymbols,
}: Props) {
  const [activePreset, setActivePreset] = useState<string>("TOP_30_CRYPTO_ADV");

  function applyPreset(key: keyof typeof PRESET_BASKETS) {
    setActivePreset(key);
    const p = PRESET_BASKETS[key];
    onFilterChange({
      ...filter,
      assetClass: p.assetClass,
      minAdvUsd: p.minAdv,
      topNByAdv: p.symbols.length,
    });
    onSelectSymbols(p.symbols);
  }

  const inputStyle: React.CSSProperties = {
    background: "#080c14",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    padding: "8px 12px",
    color: "#f8fafc",
    fontSize: 13,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#94a3b8",
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ─── Institutional Universe Preset Cards ─── */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Institutional Universe Presets
          </span>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            Click to auto-populate asset catalog &amp; weighting rules
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {Object.entries(PRESET_BASKETS).map(([k, p]) => {
            const isSelected = activePreset === k;
            return (
              <div
                key={k}
                onClick={() => applyPreset(k as any)}
                style={{
                  background: isSelected
                    ? "linear-gradient(135deg, rgba(14, 165, 233, 0.12) 0%, rgba(37, 99, 235, 0.08) 100%)"
                    : "rgba(10, 15, 26, 0.8)",
                  border: isSelected ? `1.5px solid ${p.badgeColor}` : "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: isSelected ? `0 0 16px ${p.badgeColor}25` : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: isSelected ? "#ffffff" : "#e2e8f0" }}>
                    {p.label}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: `${p.badgeColor}22`,
                      color: p.badgeColor,
                      border: `1px solid ${p.badgeColor}44`,
                    }}
                  >
                    {p.badge}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, lineHeight: 1.4 }}>
                  {p.desc}
                </div>
                <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                  <span>{p.symbols.length} Assets</span>
                  <span>•</span>
                  <span>Min ADV ${(p.minAdv / 1e6).toLocaleString()}M</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Module 1: Two Column Layout (Filter & Allocation) ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {/* Left: Dynamic Universe Screener */}
        <div
          style={{
            background: "rgba(8, 12, 22, 0.7)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 14,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14 }}>🌐</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Dynamic Universe Screener
              </span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 20,
                background: "rgba(14, 165, 233, 0.15)",
                color: "#38bdf8",
                border: "1px solid rgba(14, 165, 233, 0.3)",
              }}
            >
              Active: {filter.assetClass}
            </span>
          </div>

          <div>
            <label style={labelStyle}>Asset Class Scope</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {(["CRYPTO", "FOREX", "FUTURES"] as AssetClass[]).map((ac) => {
                const active = filter.assetClass === ac;
                return (
                  <button
                    key={ac}
                    type="button"
                    onClick={() => onFilterChange({ ...filter, assetClass: ac })}
                    style={{
                      background: active ? "rgba(14, 165, 233, 0.2)" : "#090d18",
                      border: active ? "1.5px solid #0ea5e9" : "1px solid rgba(255, 255, 255, 0.08)",
                      color: active ? "#38bdf8" : "#94a3b8",
                      borderRadius: 6,
                      padding: "7px 6px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.12s ease",
                    }}
                  >
                    {ac}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Min 30d ADV ($)</label>
              <input
                type="number"
                value={filter.minAdvUsd}
                onChange={(e) => onFilterChange({ ...filter, minAdvUsd: Number(e.target.value) })}
                style={inputStyle}
              />
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                ${(filter.minAdvUsd / 1e6).toFixed(0)}M volume cutoff
              </div>
            </div>

            <div>
              <label style={labelStyle}>Top N Ranked by ADV</label>
              <input
                type="number"
                min={1}
                max={50}
                value={filter.topNByAdv || 15}
                onChange={(e) => onFilterChange({ ...filter, topNByAdv: Number(e.target.value) })}
                style={inputStyle}
              />
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                Selects top {filter.topNByAdv || 15} pairs
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Realized Volatility Window (20d Annualized)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <input
                  type="number"
                  step="0.05"
                  value={filter.minRealizedVol20d || 0.1}
                  onChange={(e) => onFilterChange({ ...filter, minRealizedVol20d: Number(e.target.value) })}
                  style={inputStyle}
                  placeholder="Min Vol"
                />
              </div>
              <span style={{ color: "#64748b", fontSize: 12 }}>to</span>
              <div style={{ flex: 1 }}>
                <input
                  type="number"
                  step="0.05"
                  value={filter.maxRealizedVol20d || 2.0}
                  onChange={(e) => onFilterChange({ ...filter, maxRealizedVol20d: Number(e.target.value) })}
                  style={inputStyle}
                  placeholder="Max Vol"
                />
              </div>
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
              Excludes quiet non-moving or hyper-volatile unhedged assets
            </div>
          </div>
        </div>

        {/* Right: Portfolio Allocation & Weighting Math */}
        <div
          style={{
            background: "rgba(8, 12, 22, 0.7)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 14,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14 }}>⚖️</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#a855f7", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Portfolio Allocation &amp; Weighting Math
              </span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 20,
                background: "rgba(168, 85, 247, 0.15)",
                color: "#c084fc",
                border: "1px solid rgba(168, 85, 247, 0.3)",
              }}
            >
              {allocation.weighting}
            </span>
          </div>

          <div>
            <label style={labelStyle}>Weighting Model</label>
            <select
              value={allocation.weighting}
              onChange={(e) => onAllocationChange({ ...allocation, weighting: e.target.value as WeightingMethod })}
              style={inputStyle}
            >
              <option value="INVERSE_VOLATILITY">Inverse Volatility / Risk Parity (w_i ∝ 1/σ_i)</option>
              <option value="EQUAL_WEIGHT">Equal Weighting (w_i = 1/N)</option>
              <option value="FIXED_UNIT_SIZING">Fixed Unit Dollar Sizing (Equal ATR Dollar Risk)</option>
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Rebalance Schedule</label>
              <select
                value={allocation.rebalanceSchedule}
                onChange={(e) => onAllocationChange({ ...allocation, rebalanceSchedule: e.target.value as RebalanceSchedule })}
                style={inputStyle}
              >
                <option value="DAILY_CLOSE">Daily Close (00:00 UTC)</option>
                <option value="DRIFT_GATED">Drift-Gated Only</option>
                <option value="WEEKLY_CLOSE">Weekly Close (Sunday)</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Drift Threshold (%)</label>
              <input
                type="number"
                step="0.01"
                value={(allocation.driftThresholdPct * 100).toFixed(0)}
                onChange={(e) => onAllocationChange({ ...allocation, driftThresholdPct: Number(e.target.value) / 100 })}
                style={inputStyle}
              />
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                Triggers rebalance when drift &gt; {(allocation.driftThresholdPct * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Max Asset Weight Cap (%)</label>
              <input
                type="number"
                step="5"
                min="5"
                max="100"
                value={(allocation.maxAssetWeightPct * 100).toFixed(0)}
                onChange={(e) => onAllocationChange({ ...allocation, maxAssetWeightPct: Number(e.target.value) / 100 })}
                style={inputStyle}
              />
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                Clamps max exposure per pair
              </div>
            </div>

            <div>
              <label style={labelStyle}>Max Gross Portfolio Leverage</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="10"
                value={allocation.maxLeverageGross}
                onChange={(e) => onAllocationChange({ ...allocation, maxLeverageGross: Number(e.target.value) })}
                style={inputStyle}
              />
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                {allocation.maxLeverageGross}x max notional to equity
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Selected Universe Pair Chips ─── */}
      <div
        style={{
          background: "rgba(10, 15, 26, 0.6)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          borderRadius: 12,
          padding: "12px 16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
            Active Universe Portfolio: <span style={{ color: "#38bdf8" }}>{selectedSymbols.length} Instruments</span>
          </div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Estimated weight per asset: ~{(100 / Math.max(1, selectedSymbols.length)).toFixed(1)}% (Equal)
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {selectedSymbols.map((sym) => {
            const isFx = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"].includes(sym);
            const isFutures = ["NQ", "ES", "YM", "RTY", "GC"].includes(sym);
            const tagColor = isFutures ? "#fbbf24" : isFx ? "#34d399" : "#38bdf8";

            return (
              <span
                key={sym}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  background: `${tagColor}15`,
                  border: `1px solid ${tagColor}35`,
                  color: "#f8fafc",
                }}
              >
                <span style={{ fontSize: 8, fontWeight: 800, color: tagColor }}>
                  {isFutures ? "CME" : isFx ? "FX" : "CRYPTO"}
                </span>
                <span>{sym}</span>
                <span
                  onClick={() => onSelectSymbols(selectedSymbols.filter((s) => s !== sym))}
                  style={{ cursor: "pointer", color: "#94a3b8", fontSize: 10, marginLeft: 2 }}
                  title="Remove asset"
                >
                  ✕
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
