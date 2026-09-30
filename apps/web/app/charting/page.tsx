'use client';
import TradingChart from '../../components/TradingChart';

const candles = [
  {time:'09:00', open:100, high:102, low:99, close:101, volume:1000},
  {time:'09:01', open:101, high:103, low:100, close:102, volume:1100},
  {time:'09:02', open:102, high:104, low:98, close:99, volume:1250},
  {time:'09:03', open:99, high:105, low:98, close:104, volume:1300},
  {time:'09:04', open:104, high:106, low:103, close:105, volume:1400},
];

export default function Charting(){
  return <><div className="hero"><h1>Charting</h1><p>Candles, buy/sell markers, stop-loss, target lines, and future backtest replay or paper-trading overlays use Quanteinstein paper/backtest data only.</p></div><div className="card"><TradingChart candles={candles} markers={[{time:'09:01',position:'belowBar',text:'BUY'},{time:'09:03',position:'aboveBar',text:'SELL'}]} lines={[{title:'Stop',price:98,color:'#ef4444',style:'dashed'},{title:'Target 1',price:105,color:'#22c55e'},{title:'Target 2',price:106,color:'#38bdf8'}]}/><p>Official TradingView Lightweight Charts is active. Canvas fallback is only used if lightweight-charts cannot load. Demo chart using sample Quanteinstein trade overlay data.</p></div></>;
}
