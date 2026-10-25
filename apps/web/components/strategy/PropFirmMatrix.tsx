"use client";

import React, { useState } from "react";
import { PropFirmRiskConfig } from "../../types/strategy_v3";

interface Props {
  config: PropFirmRiskConfig;
  onChange: (cfg: PropFirmRiskConfig) => void;
}

const PROP_FIRM_PRESETS = {
  FTMO_CHALLENGE: {
    id: "FTMO_CHALLENGE",
    label: "FTMO $100k Standard",
    badge: "FTMO",
    mode: "CLOSED_BALANCE_EOD" as const,
    maxTrailingDd: 10.0,
    maxDailyLoss: 5.0,
    action: "FLATTEN_AND_HALT" as const,
    desc: "Closed balance trailing limit evaluated at 00:00 UTC",
    color: "#38bdf8",
  },
  TOPSTEP_FUTURES: {
    id: "TOPSTEP_FUTURES",
    label: "Topstep 150k Trading Combine",
    badge: "TOPSTEP",
    mode: "INTRADAY_EQUITY_PEAK_HWM" as const,
    maxTrailingDd: 4.5,
    maxDailyLoss: 3.0,
    action: "FLATTEN_AND_HALT" as const,
    desc: "Intraday unrealized equity peak trailing drawdown",
    color: "#fbbf24",
  },
  APEX_EVALUATION: {
    id: "APEX_EVALUATION",
    label: "Apex Trader Funding",
    badge: "APEX",
    mode: "INTRADAY_EQUITY_PEAK_HWM" as const,
    maxTrailingDd: 6.0,
    maxDailyLoss: 4.0,
    action: "FLATTEN_AND_HALT" as const,
    desc: "Live trailing peak with live trade liquidate circuit breaker",
    color: "#f87171",
  },
  FUNDED_NEXT: {
    id: "FUNDED_NEXT",
    label: "FundedNext Stellar 100k",
    badge: "FUNDEDNEXT",
    mode: "CLOSED_BALANCE_EOD" as const,
    maxTrailingDd: 10.0,
    maxDailyLoss: 5.0,
    action: "FLATTEN_AND_HALT" as const,
    desc: "Balanced balance-based challenge with news trading allowed",
    color: "#34d399",
  },
};

export default function PropFirmMatrix({ config, onChange }: Props) {
  const [activePreset, setActivePreset] = useState<string>("FTMO_CHALLENGE");

  function applyPreset(key: keyof typeof PROP_FIRM_PRESETS) {
    setActivePreset(key);
    const p = PROP_FIRM_PRESETS[key];
    onChange({
      ...config,
      drawdownMode: p.mode,
      maxTrailingDrawdownPct: p.maxTrailingDd,
      maxDailyLossPct: p.maxDailyLoss,
      hardBreakerAction: p.action,
    });
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
    <div
      style={{
        background: "rgba(12, 16, 28, 0.85)",
        border: "1px solid rgba(244, 63, 94, 0.25)",
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* ─── Header ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: "#f43f5e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Prop-Firm Challenge Circuit Breaker &amp; Risk Guard
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: 11, color: "#64748b" }}>
              Enforces real-time drawdown ceilings, auto-liquidations, and news embargoes required by funded evaluation firms.
            </p>
          </div>
        </div>

        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "3px 8px",
            borderRadius: 20,
            background: "rgba(244, 63, 94, 0.15)",
            color: "#fb7185",
            border: "1px solid rgba(244, 63, 94, 0.35)",
          }}
        >
          {config.drawdownMode === "INTRADAY_EQUITY_PEAK_HWM" ? "LIVE INTRADAY HWM" : "CLOSED BALANCE EOD"}
        </span>
      </div>

      {/* ─── Challenge Preset Baskets ─── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          Evaluation Firm Preset Templates
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          {Object.entries(PROP_FIRM_PRESETS).map(([k, p]) => {
            const isSelected = activePreset === k;
            return (
              <div
                key={k}
                onClick={() => applyPreset(k as any)}
                style={{
                  background: isSelected ? "rgba(244, 63, 94, 0.12)" : "rgba(8, 12, 22, 0.7)",
                  border: isSelected ? `1.5px solid ${p.color}` : "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                  transition: "all 0.12s ease",
                  boxShadow: isSelected ? `0 0 12px ${p.color}20` : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? "#ffffff" : "#e2e8f0" }}>
                    {p.label}
                  </span>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 800,
                      padding: "1px 5px",
                      borderRadius: 3,
                      background: `${p.color}20`,
                      color: p.color,
                      border: `1px solid ${p.color}40`,
                    }}
                  >
                    {p.badge}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>{p.desc}</div>
                <div style={{ display: "flex", gap: 8, fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                  <span>Max DD: <strong style={{ color: "#f87171" }}>{p.maxTrailingDd}%</strong></span>
                  <span>•</span>
                  <span>Daily: <strong style={{ color: "#fbbf24" }}>{p.maxDailyLoss}%</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Custom Rule Parameter Matrix ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, paddingTop: 4 }}>
        <div>
          <label style={labelStyle}>Drawdown Tracking Mode</label>
          <select
            value={config.drawdownMode}
            onChange={(e) => onChange({ ...config, drawdownMode: e.target.value as any })}
            style={inputStyle}
          >
            <option value="INTRADAY_EQUITY_PEAK_HWM">Intraday Peak HWM (Live Floating Peak)</option>
            <option value="CLOSED_BALANCE_EOD">Closed Balance EOD (Settled Balance at 00:00 UTC)</option>
          </select>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
            {config.drawdownMode === "INTRADAY_EQUITY_PEAK_HWM"
              ? "Strictest mode: floating equity peaks lock in trailing floor"
              : "Standard mode: only closed realized PnL ratchets drawdown"}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Max Trailing Drawdown (%)</label>
          <input
            type="number"
            step="0.5"
            min="1"
            max="25"
            value={config.maxTrailingDrawdownPct}
            onChange={(e) => onChange({ ...config, maxTrailingDrawdownPct: Number(e.target.value) })}
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
            Halt floor: {(100 - config.maxTrailingDrawdownPct).toFixed(1)}% of high-water mark
          </div>
        </div>

        <div>
          <label style={labelStyle}>Max Daily Loss Limit (%)</label>
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="15"
            value={config.maxDailyLossPct}
            onChange={(e) => onChange({ ...config, maxDailyLossPct: Number(e.target.value) })}
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
            Hard flatten if daily loss reaches {config.maxDailyLossPct}%
          </div>
        </div>

        <div>
          <label style={labelStyle}>Breaker Action on Breach</label>
          <select
            value={config.hardBreakerAction}
            onChange={(e) => onChange({ ...config, hardBreakerAction: e.target.value as any })}
            style={inputStyle}
          >
            <option value="FLATTEN_AND_HALT">🚨 Auto-Liquidate All &amp; Halt Engine</option>
            <option value="WARN_ONLY">⚠️ Notification Warning Only</option>
          </select>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
            Emergency kill-switch action
          </div>
        </div>

        <div>
          <label style={labelStyle}>News Embargo Window</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="number"
              min={0}
              max={60}
              value={config.newsRiskEmbargoMinutes}
              onChange={(e) => onChange({ ...config, newsRiskEmbargoMinutes: Number(e.target.value) })}
              style={{ ...inputStyle, width: "70px" }}
            />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Mins before/after CPI, FOMC, NFP</span>
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
            Halts entries during macroeconomic volatility spikes
          </div>
        </div>
      </div>
    </div>
  );
}
