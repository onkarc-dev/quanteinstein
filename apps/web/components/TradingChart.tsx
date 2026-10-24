'use client';

import {useEffect, useRef} from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { visibleChartCandle } from '../lib/liveChartCandles';

export type TradingCandle = { time: string | number; open: number; high: number; low: number; close: number; volume?: number };
export type TradingMarker = { time: string | number; position?: 'aboveBar' | 'belowBar' | 'atPriceMiddle'; color?: string; shape?: 'arrowUp' | 'arrowDown' | 'circle'; text?: string; price?: number };
export type TradingLine = { title: string; price: number; color?: string; style?: 'solid' | 'dashed'; lineWidth?: 1 | 2; axisLabelVisible?: boolean };

function fallbackCandles(): TradingCandle[] {
  return [
    {time: '09:00', open: 100, high: 102, low: 99, close: 101},
    {time: '09:01', open: 101, high: 103, low: 100, close: 102},
    {time: '09:02', open: 102, high: 104, low: 98, close: 99},
    {time: '09:03', open: 99, high: 105, low: 98, close: 104},
    {time: '09:04', open: 104, high: 106, low: 103, close: 105},
  ];
}

function toChartTime(value: string | number, index: number): Time {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return (value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)) as UTCTimestamp;
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000) as UTCTimestamp;
  return (1_700_000_000 + index * 60) as UTCTimestamp;
}

function buildChartData(candles: TradingCandle[]): {
  data: CandlestickData<Time>[];
  timeByInput: Map<string, Time>;
} {
  const timeByInput = new Map<string, Time>();
  const data = candles.map((candle, index) => {
    const time = toChartTime(candle.time, index);
    timeByInput.set(String(candle.time), time);
    const visual = visibleChartCandle(candle);
    return {
      time,
      open: visual.open,
      high: visual.high,
      low: visual.low,
      close: visual.close,
    };
  });
  return {data, timeByInput};
}

export default function TradingChart({
  candles,
  markers = [],
  lines = [],
  height = 320,
  symbol,
}: {
  candles: TradingCandle[];
  markers?: TradingMarker[];
  lines?: TradingLine[];
  height?: number;
  symbol?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const markerApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastSymbolRef = useRef<string | undefined>(undefined);
  const hasFittedRef = useRef<boolean>(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: {type: ColorType.Solid, color: '#0f172a'},
        textColor: '#cbd5e1',
      },
      grid: {
        vertLines: {color: '#1e293b'},
        horzLines: {color: '#1e293b'},
      },
      rightPriceScale: {borderColor: '#334155'},
      timeScale: {borderColor: '#334155', timeVisible: true, secondsVisible: true},
      crosshair: {
        vertLine: {color: '#64748b'},
        horzLine: {color: '#64748b'},
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    hasFittedRef.current = false;

    const resizeObserver = new ResizeObserver(entries => {
      const width = Math.floor(entries[0]?.contentRect.width || container.clientWidth);
      if (width > 0) chart.applyOptions({width, height});
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markerApiRef.current = null;
      priceLinesRef.current = [];
      hasFittedRef.current = false;
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    if (symbol !== lastSymbolRef.current) {
      lastSymbolRef.current = symbol;
      hasFittedRef.current = false;
    }

    const sourceCandles = candles.length ? candles : fallbackCandles();
    const {data, timeByInput} = buildChartData(sourceCandles);
    candleSeries.setData(data);

    const chartMarkers: SeriesMarker<Time>[] = markers.map(marker => {
      const fallbackTime = data[data.length - 1]?.time || toChartTime(marker.time, 0);
      const base = {
        time: timeByInput.get(String(marker.time)) || fallbackTime,
        color: marker.color || (marker.position === 'aboveBar' ? '#ef4444' : '#22c55e'),
        shape: marker.shape || (marker.position === 'aboveBar' ? 'arrowDown' : 'arrowUp'),
        text: marker.text || '',
      };
      if (marker.price != null && Number.isFinite(marker.price)) {
        return {
          ...base,
          position: 'atPriceMiddle' as const,
          price: marker.price,
        };
      }
      return {
        ...base,
        position: (marker.position === 'aboveBar' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
      };
    });
    if (!markerApiRef.current) {
      markerApiRef.current = createSeriesMarkers(candleSeries, chartMarkers);
    } else {
      markerApiRef.current.setMarkers(chartMarkers);
    }

    priceLinesRef.current.forEach(priceLine => candleSeries.removePriceLine(priceLine));
    priceLinesRef.current = [];
    lines.forEach(line => {
      const priceLine = candleSeries.createPriceLine({
        price: line.price,
        color: line.color || '#38bdf8',
        lineWidth: (line.lineWidth ?? 1) as 1 | 2,
        lineStyle: line.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: line.axisLabelVisible !== false,
        title: line.title,
      });
      priceLinesRef.current.push(priceLine);
    });

    if (!hasFittedRef.current && data.length > 0) {
      chart.timeScale().fitContent();
      hasFittedRef.current = true;
    }
  }, [candles, markers, lines, symbol]);

  return (
    <div
      ref={containerRef}
      style={{width: '100%', height, background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b', overflow: 'hidden'}}
      aria-label="Trading chart"
    />
  );
}
