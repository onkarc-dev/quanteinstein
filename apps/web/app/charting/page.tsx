'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import TradingChart, { TradingCandle, TradingLine, TradingMarker } from '../../components/TradingChart';
import { api, formatApiError } from '../../lib/api';

// The 16 prominently featured cryptocurrency pairs
export const FEATURED_16_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'PEPEUSDT',
  'SUIUSDT',
  'NEARUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'TRXUSDT',
  'SHIBUSDT',
  'DOTUSDT',
  'LTCUSDT',
];

const TIMEFRAMES = [
  { label: '1s', value: '1s' },
  { label: '1m', value: '1m' },
  { label: '3m', value: '3m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
];

const CANDLE_LIMITS = [50, 100, 250, 500];

interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
}

function formatPrice(val: number | undefined | null): string {
  if (val == null || !Number.isFinite(val) || val === 0) return '---';
  if (val >= 1000) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (val >= 1) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (val >= 0.0001) {
    return val.toFixed(6);
  }
  return val.toFixed(8);
}

function formatVolume(val: number | undefined | null): string {
  if (val == null || !Number.isFinite(val)) return '---';
  if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(2) + 'B';
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(2) + 'M';
  if (val >= 1_000) return (val / 1_000).toFixed(1) + 'K';
  return val.toFixed(0);
}

export default function ChartingPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('1m');
  const [selectedLimit, setSelectedLimit] = useState<number>(100);
  const [allSymbols, setAllSymbols] = useState<string[]>(FEATURED_16_SYMBOLS);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [customInput, setCustomInput] = useState<string>('');
  const [recentSymbols, setRecentSymbols] = useState<string[]>(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);

  const [candles, setCandles] = useState<TradingCandle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'websocket' | 'polling' | 'offline'>('connecting');

  // Market metrics & ticker state
  const [tickers, setTickers] = useState<Record<string, Ticker24h>>({});
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('');

  // Technical overlays
  const [showChannel, setShowChannel] = useState<boolean>(true);
  const [showRiskBracket, setShowRiskBracket] = useState<boolean>(true);
  const [showMarkers, setShowMarkers] = useState<boolean>(true);
  const [chartHeight, setChartHeight] = useState<number>(460);

  const prevPriceRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  // 1. Fetch available 200+ crypto markets
  useEffect(() => {
    let cancelled = false;
    api('/live-paper/symbols')
      .then((res: any) => {
        if (!cancelled && Array.isArray(res?.symbols) && res.symbols.length > 0) {
          const fetched = res.symbols.map((s: string) => s.toUpperCase());
          // Ensure featured 16 are at top
          const combined = Array.from(new Set([...FEATURED_16_SYMBOLS, ...fetched]));
          setAllSymbols(combined);
        }
      })
      .catch(() => {
        // Fallback to Binance Vision REST exchangeInfo if API is offline
        fetch('https://data-api.binance.vision/api/v3/exchangeInfo')
          .then((r) => r.json())
          .then((d) => {
            if (!cancelled && Array.isArray(d?.symbols)) {
              const usdtPairs = d.symbols
                .filter((s: any) => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
                .map((s: any) => s.symbol);
              const combined = Array.from(new Set([...FEATURED_16_SYMBOLS, ...usdtPairs]));
              setAllSymbols(combined);
            }
          })
          .catch(() => {});
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Fetch 24h Ticker statistics for active symbols periodically
  useEffect(() => {
    let cancelled = false;

    async function loadTickers() {
      try {
        const resp = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr');
        const data = await resp.json();
        if (!cancelled && Array.isArray(data)) {
          const map: Record<string, Ticker24h> = {};
          for (const item of data) {
            const sym = item.symbol;
            if (sym && sym.endsWith('USDT')) {
              map[sym] = {
                symbol: sym,
                lastPrice: Number(item.lastPrice || 0),
                priceChangePercent: Number(item.priceChangePercent || 0),
                highPrice: Number(item.highPrice || 0),
                lowPrice: Number(item.lowPrice || 0),
                volume: Number(item.volume || 0),
                quoteVolume: Number(item.quoteVolume || 0),
              };
            }
          }
          setTickers(map);
        }
      } catch {
        // Silently retry on next interval
      }
    }

    loadTickers();
    const intervalId = setInterval(loadTickers, 4000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  // 3. Load historical candles whenever symbol, timeframe, or limit changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg('');

    async function loadHistoricalCandles() {
      const sym = selectedSymbol.toUpperCase();
      const tf = selectedTimeframe === '1s' ? '1m' : selectedTimeframe; // Binance Vision klines API supports >= 1m
      let fetchedCandles: TradingCandle[] = [];

      // Attempt 1: Fetch via backend endpoint
      try {
        const res: any = await api(`/live-paper/candles?symbol=${sym}&interval=${tf}&limit=${selectedLimit}`);
        if (Array.isArray(res?.candles) && res.candles.length > 0) {
          fetchedCandles = res.candles.map((c: any) => ({
            time: Number(c.time),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 0),
          }));
        }
      } catch {
        // Fallback to Binance Vision directly
      }

      // Attempt 2: Fallback to direct Binance Vision REST API
      if (!fetchedCandles.length) {
        try {
          const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${tf}&limit=${selectedLimit}`;
          const resp = await fetch(url);
          const raw = await resp.json();
          if (Array.isArray(raw) && raw.length > 0) {
            fetchedCandles = raw.map((k: any) => ({
              time: Math.floor(k[0] / 1000),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5] || 0),
            }));
          }
        } catch (err: any) {
          if (!cancelled) {
            setErrorMsg(`Could not fetch candles for ${sym}: ${err?.message || 'Network error'}`);
          }
        }
      }

      if (!cancelled && fetchedCandles.length > 0) {
        // Sort chronologically
        fetchedCandles.sort((a, b) => Number(a.time) - Number(b.time));
        setCandles(fetchedCandles);
        setLoading(false);
        const lastC = fetchedCandles[fetchedCandles.length - 1];
        if (lastC) {
          prevPriceRef.current = lastC.close;
          setLastUpdateTime(new Date().toLocaleTimeString());
        }
      } else if (!cancelled) {
        setLoading(false);
      }
    }

    loadHistoricalCandles();

    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, selectedTimeframe, selectedLimit]);

  // 4. Real-Time Streaming (Binance WebSocket with Polling Fallback)
  useEffect(() => {
    let cancelled = false;
    const sym = selectedSymbol.toLowerCase();
    const tf = selectedTimeframe === '1s' ? '1m' : selectedTimeframe;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('connecting');

    // Connect to Binance public WebSocket stream for live candlestick updates
    const streamName = `${sym}@kline_${tf}`;
    const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}`;

    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!cancelled) setConnectionStatus('websocket');
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.k) {
            const k = msg.k;
            const barTime = Math.floor(k.t / 1000);
            const openP = Number(k.o);
            const highP = Number(k.h);
            const lowP = Number(k.l);
            const closeP = Number(k.c);
            const vol = Number(k.v || 0);

            // Detect price direction flash
            const prev = prevPriceRef.current;
            if (prev > 0 && closeP !== prev) {
              setPriceFlash(closeP > prev ? 'up' : 'down');
              setTimeout(() => setPriceFlash(null), 500);
            }
            prevPriceRef.current = closeP;
            setLastUpdateTime(new Date().toLocaleTimeString());

            setCandles((prevCandles) => {
              if (!prevCandles.length) {
                return [{ time: barTime, open: openP, high: highP, low: lowP, close: closeP, volume: vol }];
              }
              const last = prevCandles[prevCandles.length - 1];
              if (last.time === barTime) {
                // Update current forming bar
                const updated = [...prevCandles];
                updated[updated.length - 1] = {
                  time: barTime,
                  open: openP,
                  high: Math.max(last.high, highP),
                  low: Math.min(last.low, lowP),
                  close: closeP,
                  volume: vol,
                };
                return updated;
              } else if (barTime > Number(last.time)) {
                // New bar started
                return [...prevCandles.slice(-(selectedLimit - 1)), {
                  time: barTime,
                  open: openP,
                  high: highP,
                  low: lowP,
                  close: closeP,
                  volume: vol,
                }];
              }
              return prevCandles;
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      socket.onerror = () => {
        if (!cancelled) setConnectionStatus('polling');
      };

      socket.onclose = () => {
        if (!cancelled && connectionStatus === 'websocket') {
          setConnectionStatus('polling');
        }
      };
    } catch {
      setConnectionStatus('polling');
    }

    // Secondary Polling Safety Net: if WebSocket fails or lags, poll live price every 2 seconds
    const pollId = setInterval(async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${selectedSymbol.toUpperCase()}`);
        const d = await r.json();
        const p = Number(d?.price);
        if (p > 0 && !cancelled) {
          const prev = prevPriceRef.current;
          if (prev > 0 && p !== prev) {
            setPriceFlash(p > prev ? 'up' : 'down');
            setTimeout(() => setPriceFlash(null), 500);
          }
          prevPriceRef.current = p;
          setLastUpdateTime(new Date().toLocaleTimeString());

          setCandles((prevList) => {
            if (!prevList.length) return prevList;
            const updated = [...prevList];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = {
              ...last,
              high: Math.max(last.high, p),
              low: Math.min(last.low, p),
              close: p,
            };
            return updated;
          });
        }
      } catch {
        // ignore
      }
    }, 2000);

    return () => {
      cancelled = true;
      if (socket) {
        socket.close();
      }
      clearInterval(pollId);
    };
  }, [selectedSymbol, selectedTimeframe, selectedLimit, connectionStatus]);

  // Update recent symbols list
  function handleSelectSymbol(sym: string) {
    const clean = sym.trim().toUpperCase();
    if (!clean) return;
    setSelectedSymbol(clean);
    setRecentSymbols((prev) => Array.from(new Set([clean, ...prev])).slice(0, 6));
  }

  function handleCustomAdd() {
    const raw = customInput.trim().toUpperCase();
    if (!raw) return;
    const sym = raw.endsWith('USDT') ? raw : `${raw}USDT`;
    if (!allSymbols.includes(sym)) {
      setAllSymbols((prev) => [sym, ...prev]);
    }
    handleSelectSymbol(sym);
    setCustomInput('');
  }

  // Active Symbol 24h & Current Bar metrics
  const activeTicker = tickers[selectedSymbol] || {
    symbol: selectedSymbol,
    lastPrice: candles[candles.length - 1]?.close || 0,
    priceChangePercent: 0,
    highPrice: 0,
    lowPrice: 0,
    volume: 0,
    quoteVolume: 0,
  };

  const currentPrice = candles[candles.length - 1]?.close || activeTicker.lastPrice || 0;
  const currentBar = candles[candles.length - 1] || null;

  // Compute Lookback Channel (20-bar High / Low) & Simulated Bracket Lines
  const { channelHigh, channelLow, priceLines, signalMarkers } = useMemo(() => {
    if (!candles.length) {
      return { channelHigh: 0, channelLow: 0, priceLines: [], signalMarkers: [] };
    }

    const lb = Math.min(20, candles.length);
    const recentBars = candles.slice(-lb);
    const high = Math.max(...recentBars.map((c) => c.high));
    const low = Math.min(...recentBars.map((c) => c.low));

    const lines: TradingLine[] = [];

    if (showChannel && high > 0 && low > 0) {
      lines.push({ title: '20-Bar High', price: high, color: '#38bdf8', style: 'dashed' });
      lines.push({ title: '20-Bar Low', price: low, color: '#a855f7', style: 'dashed' });
    }

    if (showRiskBracket && currentPrice > 0) {
      const riskUnit = Math.max(currentPrice * 0.005, currentPrice - low);
      const stop = Number((currentPrice - riskUnit).toFixed(currentPrice < 1 ? 6 : 2));
      const t1 = Number((currentPrice + 1.5 * riskUnit).toFixed(currentPrice < 1 ? 6 : 2));
      const t2 = Number((currentPrice + 2.5 * riskUnit).toFixed(currentPrice < 1 ? 6 : 2));

      lines.push({ title: 'Stop Loss (-1.0R)', price: stop, color: '#ef4444', style: 'dashed' });
      lines.push({ title: 'Target 1 (+1.5R)', price: t1, color: '#22c55e', style: 'solid' });
      lines.push({ title: 'Target 2 (+2.5R)', price: t2, color: '#06b6d4', style: 'solid' });
    }

    const markers: TradingMarker[] = [];
    if (showMarkers && candles.length >= 10) {
      // Find historical breakout instances to illustrate signals
      for (let i = 10; i < candles.length - 1; i += 25) {
        const bar = candles[i];
        const prevBar = candles[i - 1];
        if (bar.close > prevBar.high) {
          markers.push({
            time: bar.time,
            position: 'belowBar',
            shape: 'arrowUp',
            color: '#22c55e',
            text: 'BREAKOUT',
            price: bar.low,
          });
        }
      }
    }

    return { channelHigh: high, channelLow: low, priceLines: lines, signalMarkers: markers };
  }, [candles, showChannel, showRiskBracket, showMarkers, currentPrice]);

  // Filtered symbols based on user search query
  const filteredSymbols = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    if (!q) return allSymbols;
    return allSymbols.filter((s) => s.includes(q));
  }, [allSymbols, searchQuery]);

  return (
    <main style={{ padding: '24px', maxWidth: 1360, margin: '0 auto', color: '#f8fafc' }}>
      {/* ─── Hero Header ─── */}
      <section style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                Institutional Crypto Charting
              </h1>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Official TradingView Lightweight Charts
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: 14, margin: '6px 0 0 0' }}>
              Real-time WebSocket & historical multi-timeframe charts for 200+ Binance cryptocurrency markets. Real market data · zero financial risk.
            </p>
          </div>

          {/* Quick Action Navigation */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href={`/paper-trading?strategy_id=PRISM&symbol=${encodeURIComponent(selectedSymbol)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#22c55e',
                color: '#022c22',
                fontWeight: 700,
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                textDecoration: 'none',
                boxShadow: '0 0 15px rgba(34, 197, 94, 0.25)',
              }}
            >
              🚀 Trade on Live Paper →
            </Link>
            <Link
              href={`/strategy-builder?symbol=${encodeURIComponent(selectedSymbol)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                fontWeight: 700,
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              ⚙️ Strategy Builder
            </Link>
            <Link
              href={`/backtests`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#1e293b',
                color: '#cbd5e1',
                fontWeight: 600,
                fontSize: 13,
                padding: '8px 14px',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              📊 Backtests
            </Link>
          </div>
        </div>
      </section>

      {/* ─── 1. Featured Top 16 Cryptocurrency Grid ─── */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ★ Top 16 Featured Crypto Markets
            </span>
            <span style={{ color: '#64748b', fontSize: 12 }}>— 1-click instant live chart switch</span>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 8,
          }}
        >
          {FEATURED_16_SYMBOLS.map((sym) => {
            const isSelected = sym === selectedSymbol;
            const t = tickers[sym];
            const price = t?.lastPrice;
            const change = t?.priceChangePercent;
            const isPositive = (change || 0) >= 0;

            return (
              <button
                key={sym}
                type="button"
                onClick={() => handleSelectSymbol(sym)}
                style={{
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: isSelected ? '2px solid #38bdf8' : '1px solid #1e293b',
                  background: isSelected ? 'rgba(56, 189, 248, 0.16)' : '#0b1220',
                  color: isSelected ? '#38bdf8' : '#cbd5e1',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  boxShadow: isSelected ? '0 0 12px rgba(56, 189, 248, 0.25)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: isSelected ? 800 : 700, fontSize: 13 }}>{sym.replace('USDT', '')}</span>
                  {isSelected && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: '#22c55e',
                        boxShadow: '0 0 8px #22c55e',
                        display: 'inline-block',
                      }}
                    />
                  )}
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                  ${formatPrice(price)}
                </div>

                {change != null && (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isPositive ? '#4ade80' : '#f87171',
                    }}
                  >
                    {isPositive ? '+' : ''}{change.toFixed(2)}%
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ─── 2. Universal Search & Explorer for 200+ Remaining Crypto Symbols ─── */}
      <section
        style={{
          background: '#090d16',
          border: '1px solid #1e293b',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>🔍</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#cbd5e1' }}>Search All Markets:</span>
          </div>

          {/* Search Input */}
          <input
            type="text"
            placeholder="Type any of 200+ crypto (e.g. SUI, AAVE, PEPE, RENDER, INJ)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
            style={{
              background: '#0b1329',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '7px 12px',
              color: '#f8fafc',
              fontSize: 13,
              minWidth: 260,
              flex: 1,
              outline: 'none',
            }}
          />

          {/* Filtered Dropdown */}
          <select
            value={selectedSymbol}
            onChange={(e) => handleSelectSymbol(e.target.value)}
            style={{
              background: '#0b1329',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '7px 12px',
              color: '#f8fafc',
              fontSize: 13,
              minWidth: 200,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {filteredSymbols.slice(0, 150).map((sym) => {
              const p = tickers[sym]?.lastPrice;
              const ch = tickers[sym]?.priceChangePercent;
              return (
                <option key={sym} value={sym}>
                  {sym} {p ? `($${formatPrice(p)}${ch != null ? ` · ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%` : ''})` : ''}
                </option>
              );
            })}
          </select>
        </div>

        {/* Custom Symbol Loader */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            placeholder="e.g. TIA, SEI..."
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomAdd()}
            style={{
              background: '#0b1329',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '7px 10px',
              color: '#f8fafc',
              fontSize: 13,
              width: 120,
              textTransform: 'uppercase',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleCustomAdd}
            style={{
              background: '#38bdf8',
              color: '#082f49',
              fontWeight: 700,
              fontSize: 13,
              border: 'none',
              padding: '7px 14px',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            + Load Chart
          </button>
        </div>

        {/* Recently Viewed Pills */}
        {recentSymbols.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginTop: 4 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>Recently Viewed:</span>
            {recentSymbols.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSelectSymbol(s)}
                style={{
                  background: s === selectedSymbol ? 'rgba(56, 189, 248, 0.2)' : '#1e293b',
                  color: s === selectedSymbol ? '#38bdf8' : '#94a3b8',
                  border: s === selectedSymbol ? '1px solid #38bdf8' : '1px solid transparent',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ─── 3. Main Chart Card & Controls ─── */}
      <section
        style={{
          background: '#0b1220',
          border: '1px solid #1e293b',
          borderRadius: 12,
          padding: '20px',
          marginBottom: 20,
        }}
      >
        {/* Ticker & Real-Time Stats Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: '1px solid #1e293b',
          }}
        >
          {/* Left: Symbol & Live Price */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 26, fontWeight: 900, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                {selectedSymbol}
              </span>
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: priceFlash === 'up' ? '#22c55e' : priceFlash === 'down' ? '#ef4444' : '#f8fafc',
                  transition: 'color 0.2s ease',
                }}
              >
                ${formatPrice(currentPrice)}
              </span>

              {/* 24h Change Pill */}
              <span
                style={{
                  background: (activeTicker.priceChangePercent || 0) >= 0 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: (activeTicker.priceChangePercent || 0) >= 0 ? '#4ade80' : '#f87171',
                  border: (activeTicker.priceChangePercent || 0) >= 0 ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {(activeTicker.priceChangePercent || 0) >= 0 ? '▲ +' : '▼ '}
                {activeTicker.priceChangePercent?.toFixed(2)}%
              </span>
            </div>

            {/* Live Feed Status Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: connectionStatus === 'websocket' ? '#22c55e' : '#f59e0b',
                  boxShadow: connectionStatus === 'websocket' ? '0 0 8px #22c55e' : '0 0 8px #f59e0b',
                  display: 'inline-block',
                }}
              />
              <span style={{ color: connectionStatus === 'websocket' ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>
                {connectionStatus === 'websocket' ? 'LIVE WEBSOCKET STREAMING (Sub-second Binance Feed)' : 'LIVE POLLING (Binance Vision API)'}
              </span>
              {lastUpdateTime && (
                <span style={{ color: '#64748b' }}>· Updated {lastUpdateTime}</span>
              )}
            </div>
          </div>

          {/* Right: 24h Stats Strip & Bar OHLC */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
              gap: 14,
              background: '#070b14',
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #1e293b',
              fontSize: 12,
            }}
          >
            <div>
              <div style={{ color: '#64748b', fontSize: 11 }}>24h High</div>
              <div style={{ color: '#f8fafc', fontWeight: 700 }}>${formatPrice(activeTicker.highPrice)}</div>
            </div>
            <div>
              <div style={{ color: '#64748b', fontSize: 11 }}>24h Low</div>
              <div style={{ color: '#f8fafc', fontWeight: 700 }}>${formatPrice(activeTicker.lowPrice)}</div>
            </div>
            <div>
              <div style={{ color: '#64748b', fontSize: 11 }}>24h Volume</div>
              <div style={{ color: '#f8fafc', fontWeight: 700 }}>{formatVolume(activeTicker.volume)} {selectedSymbol.replace('USDT', '')}</div>
            </div>
            {currentBar && (
              <>
                <div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>Bar Open</div>
                  <div style={{ color: '#cbd5e1', fontWeight: 600 }}>${formatPrice(currentBar.open)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>Bar High</div>
                  <div style={{ color: '#4ade80', fontWeight: 600 }}>${formatPrice(currentBar.high)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>Bar Low</div>
                  <div style={{ color: '#f87171', fontWeight: 600 }}>${formatPrice(currentBar.low)}</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Chart Controls Bar: Timeframe & Technical Overlay Toggles */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 14,
          }}
        >
          {/* Timeframe Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#090d16', padding: '4px', borderRadius: 8, border: '1px solid #1e293b' }}>
            <span style={{ color: '#64748b', fontSize: 11, fontWeight: 700, padding: '0 6px' }}>TF:</span>
            {TIMEFRAMES.map((tf) => {
              const active = tf.value === selectedTimeframe;
              return (
                <button
                  key={tf.value}
                  type="button"
                  onClick={() => setSelectedTimeframe(tf.value)}
                  style={{
                    background: active ? '#38bdf8' : 'transparent',
                    color: active ? '#082f49' : '#94a3b8',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.1s ease',
                  }}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>

          {/* Candle Limit Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#090d16', padding: '4px', borderRadius: 8, border: '1px solid #1e293b' }}>
            <span style={{ color: '#64748b', fontSize: 11, fontWeight: 700, padding: '0 6px' }}>Depth:</span>
            {CANDLE_LIMITS.map((lim) => {
              const active = lim === selectedLimit;
              return (
                <button
                  key={lim}
                  type="button"
                  onClick={() => setSelectedLimit(lim)}
                  style={{
                    background: active ? '#1e293b' : 'transparent',
                    color: active ? '#f8fafc' : '#64748b',
                    border: active ? '1px solid #334155' : '1px solid transparent',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {lim}
                </button>
              );
            })}
          </div>

          {/* Technical Overlays Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#cbd5e1' }}>
              <input
                type="checkbox"
                checked={showChannel}
                onChange={(e) => setShowChannel(e.target.checked)}
                style={{ accentColor: '#38bdf8' }}
              />
              <span>20-Bar Channel</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#cbd5e1' }}>
              <input
                type="checkbox"
                checked={showRiskBracket}
                onChange={(e) => setShowRiskBracket(e.target.checked)}
                style={{ accentColor: '#22c55e' }}
              />
              <span>SL & TP Brackets</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#cbd5e1' }}>
              <input
                type="checkbox"
                checked={showMarkers}
                onChange={(e) => setShowMarkers(e.target.checked)}
                style={{ accentColor: '#a855f7' }}
              />
              <span>Breakout Signals</span>
            </label>

            {/* Height Toggle */}
            <button
              type="button"
              onClick={() => setChartHeight((prev) => (prev === 460 ? 620 : 460))}
              style={{
                background: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {chartHeight === 460 ? '⤢ Expand View' : '⤡ Standard View'}
            </button>
          </div>
        </div>

        {/* ─── Candlestick Chart Render ─── */}
        {loading && !candles.length ? (
          <div
            style={{
              height: chartHeight,
              border: '1px dashed #334155',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: '#070b14',
              color: '#94a3b8',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: '3px solid #334155',
                borderTopColor: '#38bdf8',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span style={{ fontSize: 14 }}>Connecting to Binance market stream & loading {selectedSymbol} candles...</span>
          </div>
        ) : errorMsg && !candles.length ? (
          <div
            style={{
              height: chartHeight,
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: 'rgba(239, 68, 68, 0.05)',
              color: '#f87171',
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700 }}>⚠️ {errorMsg}</span>
            <button
              type="button"
              onClick={() => setSelectedSymbol('BTCUSDT')}
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: 6,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Switch to BTCUSDT
            </button>
          </div>
        ) : (
          <TradingChart
            candles={candles}
            markers={signalMarkers}
            lines={priceLines}
            height={chartHeight}
          />
        )}

        {/* Overlay Legend */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 12,
            fontSize: 12,
            color: '#64748b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span>Legend:</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, background: '#22c55e', display: 'inline-block' }} /> Bullish Candle
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, background: '#ef4444', display: 'inline-block' }} /> Bearish Candle
            </span>
            {showChannel && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 2, background: '#38bdf8', display: 'inline-block' }} /> 20-Bar Channel
              </span>
            )}
            {showRiskBracket && (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 12, height: 2, background: '#22c55e', display: 'inline-block' }} /> Target 1 (+1.5R)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 12, height: 2, background: '#06b6d4', display: 'inline-block' }} /> Target 2 (+2.5R)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 12, height: 2, background: '#ef4444', display: 'inline-block' }} /> Stop Loss (-1.0R)
                </span>
              </>
            )}
          </div>
          <div>
            Showing {candles.length} candles ({selectedTimeframe}) · Binance Vision authentic market data
          </div>
        </div>
      </section>

      {/* ─── 4. Institutional 24h Markets Overview Table ─── */}
      <section
        style={{
          background: '#0b1220',
          border: '1px solid #1e293b',
          borderRadius: 12,
          padding: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Cryptocurrency Market Monitor</h2>
            <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
              Real-time prices, 24h performance, and instant chart deployment across active Binance crypto markets.
            </div>
          </div>
          <span style={{ color: '#38bdf8', fontSize: 12, fontWeight: 600 }}>
            {allSymbols.length} total markets available
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>#</th>
                <th style={{ padding: '10px 12px' }}>Market</th>
                <th style={{ padding: '10px 12px' }}>Live Price</th>
                <th style={{ padding: '10px 12px' }}>24h Change</th>
                <th style={{ padding: '10px 12px' }}>24h High</th>
                <th style={{ padding: '10px 12px' }}>24h Low</th>
                <th style={{ padding: '10px 12px' }}>24h Volume</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {/* Display top 16 + search matches */}
              {Array.from(new Set([...FEATURED_16_SYMBOLS, ...filteredSymbols])).slice(0, 30).map((sym, idx) => {
                const t = tickers[sym];
                const p = t?.lastPrice;
                const ch = t?.priceChangePercent;
                const isSelected = sym === selectedSymbol;
                const isPos = (ch || 0) >= 0;

                return (
                  <tr
                    key={sym}
                    style={{
                      borderBottom: '1px solid #141f36',
                      background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>{idx + 1}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: isSelected ? '#38bdf8' : '#f8fafc' }}>
                      {sym}
                      {FEATURED_16_SYMBOLS.includes(sym) && (
                        <span
                          style={{
                            marginLeft: 6,
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38bdf8',
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                          }}
                        >
                          TOP 16
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700 }}>${formatPrice(p)}</td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontWeight: 700,
                        color: isPos ? '#4ade80' : '#f87171',
                      }}
                    >
                      {ch != null ? `${isPos ? '+' : ''}${ch.toFixed(2)}%` : '---'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>${formatPrice(t?.highPrice)}</td>
                    <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>${formatPrice(t?.lowPrice)}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                      {formatVolume(t?.quoteVolume)} USDT
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectSymbol(sym);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          style={{
                            background: isSelected ? '#38bdf8' : '#1e293b',
                            color: isSelected ? '#082f49' : '#cbd5e1',
                            border: 'none',
                            borderRadius: 6,
                            padding: '5px 12px',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {isSelected ? 'Active' : 'View Chart'}
                        </button>
                        <Link
                          href={`/paper-trading?strategy_id=PRISM&symbol=${encodeURIComponent(sym)}`}
                          style={{
                            background: '#22c55e',
                            color: '#022c22',
                            borderRadius: 6,
                            padding: '5px 10px',
                            fontSize: 12,
                            fontWeight: 700,
                            textDecoration: 'none',
                            display: 'inline-block',
                          }}
                        >
                          Trade
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
