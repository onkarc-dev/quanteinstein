"use client";

import React from "react";
import { PropFirmRiskConfig } from "../../types/strategy_v3";

interface Props {
  config: PropFirmRiskConfig;
  onChange: (cfg: PropFirmRiskConfig) => void;
}

const PROP_FIRM_PRESETS = {
  FTMO_CHALLENGE: {
    label: "🏆 FTMO ($100k Standard)",
    mode: "CLOSED_BALANCE_EOD" as const,
    maxTrailingDd: 10.0,
    maxDailyLoss: 5.0,
    action: "FLATTEN_AND_HALT" as const,
  },
  TOPSTEP_FUTURES: {
    label: "🎯 Topstep 150k Trading Combine",
    mode: "INTRADAY_EQUITY_PEAK_HWM" as const,
    maxTrailingDd: 4.5,
    maxDailyLoss: 3.0,
    action: "FLATTEN_AND_HALT" as const,
  },
  APEX_EVALUATION: {
    label: "⚡ Apex Trader Funding",
    mode: "INTRADAY_EQUITY_PEAK_HWM" as const,
    maxTrailingDd: 6.0,
    maxDailyLoss: 4.0,
    action: "FLATTEN_AND_HALT" as const,
  },
  FUNDED_NEXT: {
    label: "🌐 FundedNext Stellar 100k",
    mode: "CLOSED_BALANCE_EOD" as const,
    maxTrailingDd: 10.0,
    maxDailyLoss: 5.0,
    action: "FLATTEN_AND_HALT" as const,
  },
};

export default function PropFirmMatrix({ config, onChange }: Props) {
  function applyPreset(key: keyof typeof PROP_FIRM_PRESETS) {
    const p = PROP_FIRM_PRESETS[key];
    onChange({
      ...config,
      drawdownMode: p.mode,
      maxTrailingDrawdownPct: p.maxTrailingDd,
      maxDailyLossPct: p.maxDailyLoss,
      hardBreakerAction: p.action,
    });
  }

  return (
    <div className="space-y-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-rose-400 uppercase tracking-wide flex items-center gap-1.5">
          <span>🛡️</span> Prop-Firm Challenge Circuit Breaker
        </h3>
        <span className="text-[11px] px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/60">
          {config.drawdownMode}
        </span>
      </div>

      {/* Preset Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Object.entries(PROP_FIRM_PRESETS).map(([k, p]) => (
          <button
            key={k}
            type="button"
            onClick={() => applyPreset(k as any)}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700/80 hover:border-rose-500 hover:bg-slate-800 text-left text-slate-200 transition-all"
          >
            <div className="font-semibold text-rose-300 truncate">{p.label}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              DD: {p.maxTrailingDd}% · Daily: {p.maxDailyLoss}%
            </div>
          </button>
        ))}
      </div>

      {/* Custom Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Drawdown Evaluation Mode</label>
          <select
            value={config.drawdownMode}
            onChange={(e) => onChange({ ...config, drawdownMode: e.target.value as any })}
            className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
          >
            <option value="INTRADAY_EQUITY_PEAK_HWM">Intraday Equity Peak HWM (Live Trailing Peak)</option>
            <option value="CLOSED_BALANCE_EOD">Closed Balance EOD (End of Day Realized)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Max Trailing Drawdown (%)</label>
          <input
            type="number"
            step="0.5"
            value={config.maxTrailingDrawdownPct}
            onChange={(e) => onChange({ ...config, maxTrailingDrawdownPct: Number(e.target.value) })}
            className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Daily Loss Limit (%)</label>
          <input
            type="number"
            step="0.5"
            value={config.maxDailyLossPct}
            onChange={(e) => onChange({ ...config, maxDailyLossPct: Number(e.target.value) })}
            className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Breaker Action on Breach</label>
          <select
            value={config.hardBreakerAction}
            onChange={(e) => onChange({ ...config, hardBreakerAction: e.target.value as any })}
            className="w-full bg-slate-950 border border-slate-700 text-rose-300 font-semibold rounded px-2.5 py-1.5 text-xs"
          >
            <option value="FLATTEN_AND_HALT">🚨 Auto-Liquidate All Positions &amp; Halt Engine</option>
            <option value="NOTIFY_ONLY">⚠️ Warning Notification Only (Do Not Flatten)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">High-Impact News Embargo (Mins)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={config.newsRiskEmbargoMinutes}
              onChange={(e) => onChange({ ...config, newsRiskEmbargoMinutes: Number(e.target.value) })}
              className="w-24 bg-slate-950 border border-slate-700 text-slate-200 rounded px-2.5 py-1.5 text-xs"
            />
            <span className="text-slate-400 text-xs">
              Mins before CPI, FOMC, &amp; NFP (halts entries &amp; protects capital)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
