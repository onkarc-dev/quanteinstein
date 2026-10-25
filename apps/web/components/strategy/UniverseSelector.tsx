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
    label: "🪙 Top 30 Binance Spot by 30d ADV",
    assetClass: "CRYPTO" as AssetClass,
    minAdv: 50_000_000,
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT", "NEARUSDT", "PEPEUSDT", "TRXUSDT", "DOTUSDT", "LTCUSDT"],
  },
  CME_INDEX_FUTURES: {
    label: "📈 CME Equity Index & Metal Futures (NQ, ES, YM, RTY, GC)",
    assetClass: "FUTURES" as AssetClass,
    minAdv: 10_000_000_000,
    symbols: ["NQ", "ES", "YM", "RTY", "GC"],
  },
  FX_MAJORS_CROSSES: {
    label: "💱 Global FX Majors + G10 Crosses",
    assetClass: "FOREX" as AssetClass,
    minAdv: 50_000_000_000,
    symbols: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"],
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
  const [screeningLoading, setScreeningLoading] = useState(false);

  function applyPreset(key: keyof typeof PRESET_BASKETS) {
    const p = PRESET_BASKETS[key];
    onFilterChange({
      ...filter,
      assetClass: p.assetClass,
      minAdvUsd: p.minAdv,
      topNByAdv: p.symbols.length,
    });
    onSelectSymbols(p.symbols);
  }

  return (
    <div className="space-y-4">
      {/* Preset Quick Baskets */}
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wider">
          Institutional Universe Presets
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {Object.entries(PRESET_BASKETS).map(([k, p]) => (
            <button
              key={k}
              type="button"
              onClick={() => applyPreset(k as any)}
              className="px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700/80 hover:border-sky-500 hover:bg-slate-800 text-left text-slate-200 transition-all"
            >
              <div className="font-semibold text-sky-400">{p.label}</div>
              <div className="text-[11px] text-slate-400 mt-1">
                {p.symbols.length} pairs · Min ADV ${(p.minAdv / 1e6).toFixed(0)}M
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        {/* Module 1 Part A: Dynamic Universe Screener */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-sky-400 uppercase tracking-wide flex items-center gap-1.5">
              <span>🌐</span> Dynamic Universe Filter
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/60">
              {filter.assetClass}
            </span>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Asset Class Classification</label>
            <select
              value={filter.assetClass}
              onChange={(e) => onFilterChange({ ...filter, assetClass: e.target.value as AssetClass })}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
            >
              <option value="CRYPTO">Crypto (Binance Spot & Perpetual Swaps)</option>
              <option value="FOREX">Global Forex (G10 Majors & Crosses)</option>
              <option value="FUTURES">CME Equity Index & Commodity Futures</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Minimum 30d ADV ($)</label>
              <input
                type="number"
                value={filter.minAdvUsd}
                onChange={(e) => onFilterChange({ ...filter, minAdvUsd: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Top N Ranked by ADV</label>
              <input
                type="number"
                value={filter.topNByAdv || 15}
                onChange={(e) => onFilterChange({ ...filter, topNByAdv: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Realized Volatility Threshold (Annualized %)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.05"
                placeholder="Min Vol (e.g. 0.15)"
                value={filter.minRealizedVol20d || 0.1}
                onChange={(e) => onFilterChange({ ...filter, minRealizedVol20d: Number(e.target.value) })}
                className="w-1/2 bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              />
              <span className="text-slate-500 text-xs">to</span>
              <input
                type="number"
                step="0.05"
                placeholder="Max Vol (e.g. 1.20)"
                value={filter.maxRealizedVol20d || 2.0}
                onChange={(e) => onFilterChange({ ...filter, maxRealizedVol20d: Number(e.target.value) })}
                className="w-1/2 bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Module 1 Part B: Portfolio-Level Weighting Math */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
              <span>⚖️</span> Allocation &amp; Weighting Math
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60">
              {allocation.weighting}
            </span>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Portfolio Weighting Math</label>
            <select
              value={allocation.weighting}
              onChange={(e) =>
                onAllocationChange({ ...allocation, weighting: e.target.value as WeightingMethod })
              }
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
            >
              <option value="INVERSE_VOLATILITY">Inverse Volatility / Risk Parity (w_i ∝ 1/σ_i)</option>
              <option value="EQUAL_WEIGHT">Equal Weighting (w_i = 1/N)</option>
              <option value="FIXED_UNIT_RISK">Fixed Unit Sizing (Dollar Risk Parity)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Rebalance Schedule</label>
              <select
                value={allocation.rebalanceSchedule}
                onChange={(e) =>
                  onAllocationChange({ ...allocation, rebalanceSchedule: e.target.value as RebalanceSchedule })
                }
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              >
                <option value="DAILY_CLOSE">Daily Close (00:00 UTC)</option>
                <option value="DRIFT_THRESHOLD">Drift Gated (&gt; 5% Drift)</option>
                <option value="WEEKLY">Weekly Close (Sunday)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Drift Rebalance (%)</label>
              <input
                type="number"
                step="1"
                value={Math.round(allocation.driftThresholdPct * 100)}
                onChange={(e) =>
                  onAllocationChange({ ...allocation, driftThresholdPct: Number(e.target.value) / 100 })
                }
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Weight per Asset (%)</label>
              <input
                type="number"
                step="1"
                value={Math.round(allocation.maxAssetWeightPct * 100)}
                onChange={(e) =>
                  onAllocationChange({ ...allocation, maxAssetWeightPct: Number(e.target.value) / 100 })
                }
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Gross Leverage</label>
              <input
                type="number"
                step="0.5"
                value={allocation.maxLeverageGross}
                onChange={(e) =>
                  onAllocationChange({ ...allocation, maxLeverageGross: Number(e.target.value) })
                }
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
