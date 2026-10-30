'use client';

import React, { useState, useMemo } from 'react';

export interface InstitutionalRiskHUDProps {
  portfolioEquity?: number;
  grossNotional?: number;
  initialMarginReq?: number;
  maintenanceMarginReq?: number;
  intradayDrawdownPct?: number;
  spyBeta?: number;
  sizeExposure?: number;
  valueExposure?: number;
  momentumExposure?: number;
  vegaExposure?: number;
  onEmergencyHalt?: () => void;
  onDeriskQuarter?: () => void;
}

export const InstitutionalRiskHUD: React.FC<InstitutionalRiskHUDProps> = ({
  portfolioEquity = 25_000_000,
  grossNotional = 42_500_000,
  initialMarginReq = 8_500_000,
  maintenanceMarginReq = 5_950_000,
  intradayDrawdownPct = 1.45,
  spyBeta = 0.42,
  sizeExposure = -0.15,
  valueExposure = 0.28,
  momentumExposure = 0.64,
  vegaExposure = -12_500,
  onEmergencyHalt,
  onDeriskQuarter,
}) => {
  const [marginModel, setMarginModel] = useState<'PORTFOLIO_MARGIN' | 'REG_T'>('PORTFOLIO_MARGIN');

  // Compute headroom & margin utilization
  const effectiveMarginReq = marginModel === 'PORTFOLIO_MARGIN' ? initialMarginReq : initialMarginReq * 1.65;
  const marginUtilizationPct = useMemo(() => {
    if (portfolioEquity <= 0) return 100;
    return Math.min(100, Math.max(0, (effectiveMarginReq / portfolioEquity) * 100));
  }, [effectiveMarginReq, portfolioEquity]);

  const excessLiquidity = Math.max(0, portfolioEquity - effectiveMarginReq);
  const leverageRatio = portfolioEquity > 0 ? (grossNotional / portfolioEquity).toFixed(2) : '0.00';

  // Early warning alert tier
  const alertTier = useMemo(() => {
    if (marginUtilizationPct >= 90 || intradayDrawdownPct >= 4.5) {
      return {
        level: 'CRITICAL',
        color: '#ef4444',
        bg: '#450a0a',
        border: '#b91c1c',
        badge: '🚨 90% LIQUIDATION / DE-LEVERAGING THRESHOLD',
      };
    }
    if (marginUtilizationPct >= 75 || intradayDrawdownPct >= 3.5) {
      return {
        level: 'ELEVATED',
        color: '#f97316',
        bg: '#431407',
        border: '#c2410c',
        badge: '⚠️ 75% ELEVATED MARGIN WARNING',
      };
    }
    if (marginUtilizationPct >= 50 || intradayDrawdownPct >= 2.0) {
      return {
        level: 'CAUTION',
        color: '#eab308',
        bg: '#422006',
        border: '#a16207',
        badge: '⚡ 50% CAUTION BUFFER ACCESSED',
      };
    }
    return {
      level: 'NORMAL',
      color: '#10b981',
      bg: '#022c22',
      border: '#047857',
      badge: '✓ MARGIN HEADROOM HEALTHY (< 50%)',
    };
  }, [marginUtilizationPct, intradayDrawdownPct]);

  return (
    <div
      style={{
        background: '#090d16',
        border: '1px solid #1e293b',
        borderRadius: 10,
        padding: 16,
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header & Early Warning Status Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          borderBottom: '1px solid #1e293b',
          paddingBottom: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.5, color: '#f8fafc' }}>
            🛡️ INSTITUTIONAL RISK & MARGIN COCKPIT
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 4,
              background: '#1e293b',
              color: '#94a3b8',
              letterSpacing: 0.5,
            }}
          >
            SEC 15c3-5 · REG T / TIMS PM
          </span>
        </div>

        {/* Early Warning Status Badge */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            padding: '4px 10px',
            borderRadius: 6,
            background: alertTier.bg,
            border: `1px solid ${alertTier.border}`,
            color: alertTier.color,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {alertTier.badge}
        </div>
      </div>

      {/* Grid: 3 Pillars (Margin Headroom, Factor Sensitivities, PB Clearing Balances) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {/* Pillar 1: Pre-Trade Margin Utilization Gauge */}
        <div
          style={{
            background: '#0c1322',
            border: '1px solid #1e293b',
            borderRadius: 8,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
              Margin Headroom & Leverage
            </span>
            {/* Toggle Model */}
            <div style={{ display: 'flex', background: '#090d16', borderRadius: 4, padding: 2 }}>
              <button
                type="button"
                onClick={() => setMarginModel('PORTFOLIO_MARGIN')}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 3,
                  border: 'none',
                  cursor: 'pointer',
                  background: marginModel === 'PORTFOLIO_MARGIN' ? '#3b82f6' : 'transparent',
                  color: marginModel === 'PORTFOLIO_MARGIN' ? '#ffffff' : '#64748b',
                }}
              >
                PM (TIMS)
              </button>
              <button
                type="button"
                onClick={() => setMarginModel('REG_T')}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 3,
                  border: 'none',
                  cursor: 'pointer',
                  background: marginModel === 'REG_T' ? '#3b82f6' : 'transparent',
                  color: marginModel === 'REG_T' ? '#ffffff' : '#64748b',
                }}
              >
                Reg T (50%)
              </button>
            </div>
          </div>

          {/* Utilization Progress Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: '#64748b' }}>Capacity Consumed:</span>
              <span style={{ fontWeight: 800, color: alertTier.color }}>
                {marginUtilizationPct.toFixed(1)}% ({leverageRatio}x Gross)
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: 8,
                background: '#1e293b',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${marginUtilizationPct}%`,
                  height: '100%',
                  background:
                    marginUtilizationPct > 85
                      ? 'linear-gradient(90deg, #f97316, #ef4444)'
                      : marginUtilizationPct > 60
                      ? 'linear-gradient(90deg, #10b981, #eab308)'
                      : '#10b981',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Key Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, marginTop: 4 }}>
            <div>
              <div style={{ color: '#64748b' }}>Effective Requirement</div>
              <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 12 }}>
                ${(effectiveMarginReq / 1_000_000).toFixed(2)}M
              </div>
            </div>
            <div>
              <div style={{ color: '#64748b' }}>Excess Liquidity</div>
              <div style={{ fontWeight: 700, color: '#10b981', fontSize: 12 }}>
                ${(excessLiquidity / 1_000_000).toFixed(2)}M
              </div>
            </div>
            <div>
              <div style={{ color: '#64748b' }}>Maint. Req (House)</div>
              <div style={{ fontWeight: 700, color: '#94a3b8' }}>
                ${(maintenanceMarginReq / 1_000_000).toFixed(2)}M
              </div>
            </div>
            <div>
              <div style={{ color: '#64748b' }}>Intraday Drawdown</div>
              <div
                style={{
                  fontWeight: 700,
                  color: intradayDrawdownPct > 3 ? '#ef4444' : '#f8fafc',
                }}
              >
                -{intradayDrawdownPct.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>

        {/* Pillar 2: Factor Sensitivity Cockpit */}
        <div
          style={{
            background: '#0c1322',
            border: '1px solid #1e293b',
            borderRadius: 8,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
              Factor Exposure Cockpit
            </span>
            <span style={{ fontSize: 10, color: '#64748b' }}>Barra / Axioma Style</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
            <div style={{ background: '#090d16', padding: '6px 10px', borderRadius: 4, border: '1px solid #1e293b' }}>
              <div style={{ color: '#64748b', fontSize: 10 }}>Market Beta (β_SPY)</div>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#38bdf8' }}>{spyBeta.toFixed(2)}</div>
            </div>
            <div style={{ background: '#090d16', padding: '6px 10px', borderRadius: 4, border: '1px solid #1e293b' }}>
              <div style={{ color: '#64748b', fontSize: 10 }}>Size Factor (SMB)</div>
              <div style={{ fontWeight: 800, fontSize: 13, color: sizeExposure >= 0 ? '#10b981' : '#f97316' }}>
                {sizeExposure > 0 ? `+${sizeExposure.toFixed(2)}` : sizeExposure.toFixed(2)}
              </div>
            </div>
            <div style={{ background: '#090d16', padding: '6px 10px', borderRadius: 4, border: '1px solid #1e293b' }}>
              <div style={{ color: '#64748b', fontSize: 10 }}>Value Factor (HML)</div>
              <div style={{ fontWeight: 800, fontSize: 13, color: valueExposure >= 0 ? '#10b981' : '#f97316' }}>
                {valueExposure > 0 ? `+${valueExposure.toFixed(2)}` : valueExposure.toFixed(2)}
              </div>
            </div>
            <div style={{ background: '#090d16', padding: '6px 10px', borderRadius: 4, border: '1px solid #1e293b' }}>
              <div style={{ color: '#64748b', fontSize: 10 }}>Momentum (MOM)</div>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#a855f7' }}>
                +{momentumExposure.toFixed(2)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#090d16',
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid #1e293b',
              fontSize: 11,
            }}
          >
            <span style={{ color: '#64748b' }}>Vol Vega (Δ / 1% VIX):</span>
            <span style={{ fontWeight: 700, color: vegaExposure < 0 ? '#ef4444' : '#10b981' }}>
              ${vegaExposure.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Pillar 3: Prime Broker Clearer Balances & Emergency Controls */}
        <div
          style={{
            background: '#0c1322',
            border: '1px solid #1e293b',
            borderRadius: 8,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
              Tier 1 Prime Broker Links
            </span>
            <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>● ALL SESSIONS ACTIVE</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
              <span>Goldman Sachs (GSET Primary):</span>
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>$15.2M Custody</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
              <span>Morgan Stanley (MSET Exec):</span>
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>$9.8M Custody</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
              <span>Citco Shadow NAV Drop Copy:</span>
              <span style={{ fontWeight: 700, color: '#10b981' }}>Tag 35=8 Synced</span>
            </div>
          </div>

          {/* Institutional Emergency Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
            <button
              type="button"
              onClick={onDeriskQuarter}
              style={{
                flex: 1,
                padding: '6px 10px',
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ⚡ DE-RISK 25%
            </button>
            <button
              type="button"
              onClick={onEmergencyHalt}
              style={{
                flex: 1,
                padding: '6px 10px',
                background: '#450a0a',
                color: '#ef4444',
                border: '1px solid #b91c1c',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              🛑 HALT DMA SUBMISSIONS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
