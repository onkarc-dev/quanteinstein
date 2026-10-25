"use client";

import React, { useState } from "react";
import { api } from "../../lib/api";

interface Props {
  strategyReturns?: number[];
  startingEquity?: number;
  propLimitPct?: number;
}

export default function MonteCarloViewer({
  strategyReturns = [],
  startingEquity = 100_000,
  propLimitPct = 8.0,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [iterations, setIterations] = useState(2500);

  async function handleRunMonteCarlo() {
    setLoading(true);
    try {
      const sampleReturns =
        strategyReturns.length >= 10
          ? strategyReturns
          : [
              0.008, -0.004, 0.012, 0.003, -0.007, 0.015, -0.002, 0.009, -0.005, 0.011,
              -0.008, 0.014, -0.003, 0.006, 0.002, -0.009, 0.018, -0.004, 0.007, -0.006,
              0.011, -0.005, 0.004, -0.002, 0.016, -0.008, 0.013, 0.002, -0.004, 0.007,
            ];

      const res: any = await api("/quant-engine/monte-carlo/run", {
        method: "POST",
        body: JSON.stringify({
          returns: sampleReturns,
          iterations,
          starting_equity: startingEquity,
          prop_limit_pct: propLimitPct,
          expected_block_size: 10,
        }),
      });

      if (res?.ok && res.report) {
        setReport(res.report);
      }
    } catch (err) {
      console.error("Monte Carlo run failed:", err);
    } finally {
      setLoading(false);
    }
  }

  const selectStyle: React.CSSProperties = {
    background: "#080c14",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "#f8fafc",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    outline: "none",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        background: "rgba(14, 18, 30, 0.85)",
        border: "1px solid rgba(245, 158, 11, 0.25)",
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* ─── Header & Control Bar ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🎲</span>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Stationary Block Bootstrap Monte Carlo Suite
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: 11, color: "#64748b" }}>
              Politis-Romano resampling preserves serial autocorrelation and volatility clustering to compute authentic prop-firm failure probabilities.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={iterations}
            onChange={(e) => setIterations(Number(e.target.value))}
            style={selectStyle}
          >
            <option value={1000}>1,000 Resamples</option>
            <option value={2500}>2,500 Resamples</option>
            <option value={5000}>5,000 Resamples</option>
          </select>

          <button
            type="button"
            disabled={loading}
            onClick={handleRunMonteCarlo}
            style={{
              background: loading
                ? "rgba(245, 158, 11, 0.3)"
                : "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
              color: "#0f172a",
              border: "none",
              borderRadius: 8,
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 800,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: "0 2px 10px rgba(245, 158, 11, 0.3)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.12s ease",
            }}
          >
            {loading ? "Simulating Resamples..." : "▶ Run Stress Test"}
          </button>
        </div>
      </div>

      {/* ─── Results Dashboard ─── */}
      {report ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
          {/* Key Metric Gauges */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            {/* Metric 1: Prop Breach Risk */}
            <div
              style={{
                background: "rgba(8, 12, 22, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Prop Challenge Breach Risk</div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  marginTop: 4,
                  color:
                    report.prob_breaching_prop_limit_pct > 15
                      ? "#f87171"
                      : report.prob_breaching_prop_limit_pct > 5
                      ? "#fbbf24"
                      : "#4ade80",
                }}
              >
                {report.prob_breaching_prop_limit_pct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                Target: &lt; 5% for funded accounts
              </div>
            </div>

            {/* Metric 2: Max Drawdown (Median vs P95) */}
            <div
              style={{
                background: "rgba(8, 12, 22, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Max Drawdown (P50 / P95)</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4, color: "#e2e8f0" }}>
                <span style={{ color: "#38bdf8" }}>{report.median_max_drawdown_pct.toFixed(1)}%</span>
                <span style={{ fontSize: 14, color: "#64748b", margin: "0 6px" }}>/</span>
                <span style={{ color: "#f87171" }}>{report.p95_max_drawdown_pct.toFixed(1)}%</span>
              </div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                P95 Worst-case vs {report.prop_firm_limit_pct}% ceiling
              </div>
            </div>

            {/* Metric 3: Final Equity Median */}
            <div
              style={{
                background: "rgba(8, 12, 22, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Expected Final Capital (P50)</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4, color: "#4ade80" }}>
                ${report.median_final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                P5 Floor: ${report.p5_final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>

            {/* Metric 4: Ruin Probability */}
            <div
              style={{
                background: "rgba(8, 12, 22, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Probability of Ruin (50% DD)</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4, color: report.prob_ruin_50pct > 0 ? "#f87171" : "#4ade80" }}>
                {report.prob_ruin_50pct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                Annualized Sharpe: {report.median_sharpe.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Drawdown Distribution Histogram */}
          {report.drawdown_distribution_bins && report.drawdown_distribution_bins.length > 0 && (
            <div
              style={{
                background: "rgba(8, 12, 22, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 10,
                padding: "12px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Max Drawdown Probability Distribution ({iterations.toLocaleString()} Resample Paths)
                </span>
                <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>
                  Red line indicates {report.prop_firm_limit_pct}% Challenge Invalidation
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90, paddingTop: 10 }}>
                {(() => {
                  const maxCount = Math.max(...report.drawdown_distribution_bins.map((b: any) => b.count), 1);
                  return report.drawdown_distribution_bins.map((bin: any, idx: number) => {
                    const heightPct = Math.max(8, (bin.count / maxCount) * 100);
                    const rangeNum = parseFloat(bin.range);
                    const isBreachZone = rangeNum >= report.prop_firm_limit_pct;
                    const barColor = isBreachZone ? "#f43f5e" : "#0284c7";

                    return (
                      <div
                        key={idx}
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          height: "100%",
                          justifyContent: "flex-end",
                        }}
                      >
                        <div
                          title={`${bin.range}: ${bin.count} simulations`}
                          style={{
                            width: "100%",
                            height: `${heightPct}%`,
                            background: barColor,
                            borderRadius: "3px 3px 0 0",
                            transition: "height 0.2s ease",
                            opacity: 0.85,
                          }}
                        />
                        <span style={{ fontSize: 9, color: "#64748b", marginTop: 4, transform: "scale(0.85)", whiteSpace: "nowrap" }}>
                          {bin.range.split("-")[0]}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Percentile Table */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 8,
              background: "rgba(8, 12, 22, 0.6)",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.05)",
              textAlign: "center",
              fontSize: 11,
            }}
          >
            <div>
              <div style={{ color: "#64748b" }}>P5 (Best Case)</div>
              <div style={{ color: "#4ade80", fontWeight: 700, marginTop: 2 }}>
                ${report.p5_final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>P50 (Median)</div>
              <div style={{ color: "#38bdf8", fontWeight: 700, marginTop: 2 }}>
                ${report.median_final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>P90 Max DD</div>
              <div style={{ color: "#fbbf24", fontWeight: 700, marginTop: 2 }}>
                {report.p90_max_drawdown_pct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>P95 Worst DD</div>
              <div style={{ color: "#f87171", fontWeight: 700, marginTop: 2 }}>
                {report.p95_max_drawdown_pct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>P99 Black Swan</div>
              <div style={{ color: "#f43f5e", fontWeight: 700, marginTop: 2 }}>
                {report.p99_max_drawdown_pct.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px dashed rgba(245, 158, 11, 0.2)",
            borderRadius: 10,
            padding: "20px",
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 12,
          }}
        >
          Click <strong>▶ Run Stress Test</strong> above to execute a 2,500-iteration stationary block bootstrap on this strategy.
        </div>
      )}
    </div>
  );
}
