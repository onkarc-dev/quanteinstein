'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';

export interface DomLevel {
  price: number;
  size: number;
  totalSize: number;
  depthPct: number;
  orderCount: number;
}

interface DepthOfMarketLadderProps {
  symbol: string;
  currentPrice: number;
  onPlaceLimitOrder: (side: 'BUY' | 'SELL', price: number, qty: number) => void;
  disabled?: boolean;
}

export function DepthOfMarketLadder({
  symbol,
  currentPrice,
  onPlaceLimitOrder,
  disabled = false,
}: DepthOfMarketLadderProps) {
  const [selectedQty, setSelectedQty] = useState<number>(1.0);
  const [hoveredPrice, setHoveredPrice] = useState<number | null>(null);
  const [orderFeedback, setOrderFeedback] = useState<string | null>(null);
  const tickSize = currentPrice > 1000 ? 0.5 : (currentPrice > 10 ? 0.01 : 0.0001);

  // Synthesize realistic Level 2 institutional depth based on BBO
  const { bids, asks, totalBidVol, totalAskVol, spreadBps, spreadDollar } = useMemo(() => {
    const p = currentPrice > 0 ? currentPrice : 100.0;
    const halfSpread = p * 0.0001; // ~2 bps spread
    const bestBid = p - halfSpread;
    const bestAsk = p + halfSpread;

    const askLevels: DomLevel[] = [];
    const bidLevels: DomLevel[] = [];

    let cumAsk = 0;
    for (let i = 8; i >= 1; i--) {
      const price = Number((bestAsk + i * tickSize).toFixed(currentPrice > 1000 ? 2 : 4));
      // Base size with depth taper
      const size = Number((Math.max(0.5, Math.sin(i * 1.5) * 1.8 + (10 - i) * 0.7 + (Math.sin(p * i) * 0.3))).toFixed(2));
      cumAsk += size;
      askLevels.push({
        price,
        size,
        totalSize: cumAsk,
        depthPct: 0,
        orderCount: Math.max(1, Math.floor(size * 3)),
      });
    }

    let cumBid = 0;
    for (let i = 1; i <= 8; i++) {
      const price = Number((bestBid - (i - 1) * tickSize).toFixed(currentPrice > 1000 ? 2 : 4));
      const size = Number((Math.max(0.5, Math.cos(i * 1.5) * 1.8 + (10 - i) * 0.7 + (Math.cos(p * i) * 0.3))).toFixed(2));
      cumBid += size;
      bidLevels.push({
        price,
        size,
        totalSize: cumBid,
        depthPct: 0,
        orderCount: Math.max(1, Math.floor(size * 3)),
      });
    }

    const maxVol = Math.max(cumAsk, cumBid, 1.0);
    askLevels.forEach(lvl => {
      lvl.depthPct = Math.min(100, Math.round((lvl.size / (maxVol * 0.3)) * 100));
    });
    bidLevels.forEach(lvl => {
      lvl.depthPct = Math.min(100, Math.round((lvl.size / (maxVol * 0.3)) * 100));
    });

    const spreadDollarVal = Math.max(tickSize, bestAsk - bestBid);
    const spreadBpsVal = (spreadDollarVal / p) * 10000;

    return {
      bids: bidLevels,
      asks: askLevels,
      totalBidVol: cumBid,
      totalAskVol: cumAsk,
      spreadBps: spreadBpsVal,
      spreadDollar: spreadDollarVal,
    };
  }, [currentPrice, tickSize]);

  const imbalancePct = useMemo(() => {
    const total = totalBidVol + totalAskVol;
    if (total <= 0) return 50;
    return Math.round((totalBidVol / total) * 100);
  }, [totalBidVol, totalAskVol]);

  const handleRowClick = (side: 'BUY' | 'SELL', price: number) => {
    if (disabled) return;
    onPlaceLimitOrder(side, price, selectedQty);
    setOrderFeedback(`Placed 1-Click Limit ${side} @ $${price.toFixed(currentPrice > 1000 ? 2 : 4)} (${selectedQty}x)`);
    setTimeout(() => setOrderFeedback(null), 3000);
  };

  return (
    <div
      style={{
        background: '#090d16',
        border: '1px solid #1e293b',
        borderRadius: 10,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'monospace',
      }}
    >
      {/* DOM Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#f8fafc', letterSpacing: 0.5 }}>
              ⚡ DEPTH OF MARKET (DOM) LADDER
            </span>
            <span
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontWeight: 700,
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
            >
              1-CLICK DMA
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            {symbol} • Tick: ${tickSize} • Spread: ${spreadDollar.toFixed(4)} ({spreadBps.toFixed(1)} bps)
          </div>
        </div>

        {/* Order Size Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Qty:</span>
          {[0.1, 0.5, 1.0, 5.0, 10.0].map(q => (
            <button
              key={q}
              onClick={() => setSelectedQty(q)}
              style={{
                background: selectedQty === q ? '#0284c7' : '#1e293b',
                color: selectedQty === q ? '#ffffff' : '#94a3b8',
                border: '1px solid',
                borderColor: selectedQty === q ? '#38bdf8' : '#334155',
                borderRadius: 4,
                padding: '3px 7px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Order Flow Imbalance Gauge */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
          <span style={{ color: '#22c55e', fontWeight: 700 }}>BID VOL: {totalBidVol.toFixed(2)} ({imbalancePct}%)</span>
          <span style={{ color: '#ef4444', fontWeight: 700 }}>ASK VOL: {totalAskVol.toFixed(2)} ({100 - imbalancePct}%)</span>
        </div>
        <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${imbalancePct}%`, background: '#22c55e', transition: 'width 0.3s ease' }} />
          <div style={{ width: `${100 - imbalancePct}%`, background: '#ef4444', transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* Price Ladder Table */}
      <div style={{ border: '1px solid #1e293b', borderRadius: 6, overflow: 'hidden' }}>
        {/* Table Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr 90px 1fr 80px',
            background: '#0d1322',
            padding: '6px 8px',
            fontSize: 10,
            fontWeight: 800,
            color: '#64748b',
            borderBottom: '1px solid #1e293b',
            textAlign: 'center',
          }}
        >
          <div style={{ textAlign: 'left' }}>BUY DMA</div>
          <div style={{ textAlign: 'right', paddingRight: 6 }}>BID DEPTH</div>
          <div>PRICE</div>
          <div style={{ textAlign: 'left', paddingLeft: 6 }}>ASK DEPTH</div>
          <div style={{ textAlign: 'right' }}>SELL DMA</div>
        </div>

        {/* ASKS (Descending from high to BBO) */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {asks.map(lvl => {
            const isHovered = hoveredPrice === lvl.price;
            return (
              <div
                key={`ask-${lvl.price}`}
                onMouseEnter={() => setHoveredPrice(lvl.price)}
                onMouseLeave={() => setHoveredPrice(null)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 90px 1fr 80px',
                  padding: '3px 8px',
                  fontSize: 11,
                  background: isHovered ? 'rgba(239, 68, 68, 0.12)' : 'transparent',
                  borderBottom: '1px solid rgba(30, 41, 59, 0.5)',
                  alignItems: 'center',
                  transition: 'background 0.1s ease',
                }}
              >
                {/* 1-Click Buy button at Ask */}
                <div>
                  {isHovered && !disabled && (
                    <button
                      onClick={() => handleRowClick('BUY', lvl.price)}
                      style={{
                        width: '100%',
                        padding: '2px 4px',
                        background: 'rgba(34, 197, 94, 0.8)',
                        border: 'none',
                        borderRadius: 3,
                        color: '#ffffff',
                        fontSize: 9,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      +BUY {selectedQty}
                    </button>
                  )}
                </div>

                {/* Empty Bid Depth Column */}
                <div />

                {/* Ask Price Column */}
                <div style={{ textAlign: 'center', color: '#f87171', fontWeight: 800 }}>
                  ${lvl.price.toFixed(currentPrice > 1000 ? 2 : 4)}
                </div>

                {/* Ask Depth Bar & Size */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '100%', paddingLeft: 6 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 1,
                      bottom: 1,
                      width: `${lvl.depthPct}%`,
                      background: 'rgba(239, 68, 68, 0.25)',
                      borderRadius: 2,
                    }}
                  />
                  <span style={{ position: 'relative', zIndex: 1, color: '#fca5a5', fontSize: 10 }}>
                    {lvl.size.toFixed(2)} ({lvl.orderCount})
                  </span>
                </div>

                {/* 1-Click Sell button at Ask */}
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => handleRowClick('SELL', lvl.price)}
                    disabled={disabled}
                    style={{
                      padding: '2px 6px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      borderRadius: 3,
                      color: '#f87171',
                      fontSize: 9,
                      fontWeight: 700,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    LIMIT
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* SPREAD INDICATOR */}
        <div
          style={{
            padding: '4px 8px',
            background: 'rgba(56, 189, 248, 0.08)',
            borderTop: '1px solid #38bdf8',
            borderBottom: '1px solid #38bdf8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 10,
            fontWeight: 700,
            color: '#38bdf8',
          }}
        >
          <span>BBO SPREAD</span>
          <span>LAST: ${currentPrice.toFixed(currentPrice > 1000 ? 2 : 4)}</span>
          <span>{spreadBps.toFixed(1)} BPS</span>
        </div>

        {/* BIDS (Descending from BBO down) */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {bids.map(lvl => {
            const isHovered = hoveredPrice === lvl.price;
            return (
              <div
                key={`bid-${lvl.price}`}
                onMouseEnter={() => setHoveredPrice(lvl.price)}
                onMouseLeave={() => setHoveredPrice(null)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 90px 1fr 80px',
                  padding: '3px 8px',
                  fontSize: 11,
                  background: isHovered ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                  borderBottom: '1px solid rgba(30, 41, 59, 0.5)',
                  alignItems: 'center',
                  transition: 'background 0.1s ease',
                }}
              >
                {/* 1-Click Buy button at Bid */}
                <div>
                  <button
                    onClick={() => handleRowClick('BUY', lvl.price)}
                    disabled={disabled}
                    style={{
                      padding: '2px 6px',
                      background: 'rgba(34, 197, 94, 0.2)',
                      border: '1px solid rgba(34, 197, 94, 0.5)',
                      borderRadius: 3,
                      color: '#4ade80',
                      fontSize: 9,
                      fontWeight: 700,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    LIMIT
                  </button>
                </div>

                {/* Bid Depth Bar & Size */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', height: '100%', paddingRight: 6 }}>
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 1,
                      bottom: 1,
                      width: `${lvl.depthPct}%`,
                      background: 'rgba(34, 197, 94, 0.25)',
                      borderRadius: 2,
                    }}
                  />
                  <span style={{ position: 'relative', zIndex: 1, color: '#86efac', fontSize: 10 }}>
                    ({lvl.orderCount}) {lvl.size.toFixed(2)}
                  </span>
                </div>

                {/* Bid Price Column */}
                <div style={{ textAlign: 'center', color: '#4ade80', fontWeight: 800 }}>
                  ${lvl.price.toFixed(currentPrice > 1000 ? 2 : 4)}
                </div>

                {/* Empty Ask Depth Column */}
                <div />

                {/* 1-Click Sell button at Bid */}
                <div style={{ textAlign: 'right' }}>
                  {isHovered && !disabled && (
                    <button
                      onClick={() => handleRowClick('SELL', lvl.price)}
                      style={{
                        width: '100%',
                        padding: '2px 4px',
                        background: 'rgba(239, 68, 68, 0.8)',
                        border: 'none',
                        borderRadius: 3,
                        color: '#ffffff',
                        fontSize: 9,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      -SELL {selectedQty}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Execution Feedback Banner */}
      {orderFeedback && (
        <div
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            color: '#86efac',
            fontSize: 11,
            textAlign: 'center',
            fontWeight: 700,
          }}
        >
          ✓ {orderFeedback}
        </div>
      )}
    </div>
  );
}
