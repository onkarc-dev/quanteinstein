'use client';

import {useEffect,useState} from 'react';
import {api, API_BASE, getToken} from '../../lib/api';
import TradingChart from '../../components/TradingChart';
import BacktestAnalytics from '../../components/BacktestAnalytics';
import { classifyTradeResultFromR } from '../../lib/tradeClassification';

const th:any={textAlign:'left', padding:'10px 8px', borderBottom:'1px solid #334155', color:'#94a3b8'};
const td:any={padding:'9px 8px', borderBottom:'1px solid #1e293b'};
function fmt(n:any,d=2){const x=Number(n??0); return Number.isFinite(x)?x.toFixed(d).replace(/\.00$/,''):'0'}
function metric(n:any,suffix='',d=2){if(n===null||n===undefined||n==='')return 'Not enough data'; const x=Number(n); return Number.isFinite(x)?`${x.toFixed(d).replace(/\.00$/,'')}${suffix}`:'Not enough data'}
function syms(j:any){try{return JSON.parse(j.symbols_json||'[]').join(', ')}catch{return '-'}}
function displayStrategy(j:any){return j.display_strategy_id || j.user_strategy_id || j.strategy_code || j.strategy_id || 'Strategy'}

function PerformanceRobustness({data}:{data:any}){
  const pr=data?.performance_and_robustness || {};
  const ra=pr.risk_adjusted || {}, ex=pr.expectancy || {}, risk=pr.risk || {}, tb=pr.trading_behavior || {}, robust=pr.robustness || {};
  const warnings=Array.isArray(pr.warnings)?pr.warnings:[];
  if(!data?.performance_and_robustness)return null;
  return <div style={{marginTop:16}}><h2>Performance & Robustness</h2><div className="grid" style={{marginTop:12}}>
    <div><b>Sharpe</b><div className="metric">{metric(ra.sharpe)}</div></div>
    <div><b>Sortino</b><div className="metric">{metric(ra.sortino)}</div></div>
    <div><b>Calmar</b><div className="metric">{metric(ra.calmar)}</div></div>
    <div><b>Omega</b><div className="metric">{metric(ra.omega)}</div></div>
    <div><b>Recovery Factor</b><div className="metric">{metric(ra.recovery_factor)}</div></div>
    <div><b>Expectancy R/trade</b><div className="metric">{metric(ex.expectancy_R_per_trade,'R')}</div></div>
    <div><b>Avg Winner / Loser</b><div className="metric">{metric(ex.average_winner_R,'R')} / {metric(ex.average_loser_R,'R')}</div></div>
    <div><b>Largest Winner / Loser</b><div className="metric">{metric(ex.largest_winner_R,'R')} / {metric(ex.largest_loser_R,'R')}</div></div>
    <div><b>Real Notional Turnover %</b><div className="metric">{tb.turnover_display || 'Not enough data'}</div></div>
    <div><b>Estimated Turnover Proxy %</b><div className="metric">{tb.turnover_proxy_display || 'Not enough data'}</div></div>
    <div><b>Trades/day</b><div className="metric">{metric(tb.trades_per_day)}</div></div>
    <div><b>Exposure %</b><div className="metric">{tb.exposure_display || 'Not enough data'}</div></div>
    <div><b>Max Wins/Losses</b><div className="metric">{risk.max_consecutive_wins ?? 0} / {risk.max_consecutive_losses ?? 0}</div></div>
    <div><b>Ulcer Index</b><div className="metric">{metric(risk.ulcer_index)}</div></div>
    <div><b>Overfitting Risk</b><div className="metric">{robust.overfitting_risk_label || 'Not enough data'} {robust.overfitting_risk_score ?? ''}</div></div>
  </div><p className="muted">Ratios require enough R-multiple dispersion. Real turnover needs notional and equity data. The proxy is a risk-based activity estimate, not real notional turnover.</p>{warnings.length>0&&<ul className="muted" style={{lineHeight:1.7}}>{warnings.map((w:string)=><li key={w}>{w}</li>)}</ul>}</div>
}

export default function Backtests(){
  const [jobs,setJobs]=useState<any[]>([]);
  const [selected,setSelected]=useState<any>(null);
  const [summary,setSummary]=useState<any>(null);
  const [trades,setTrades]=useState<any[]>([]);
  
  const [msg,setMsg]=useState('');
  const [uploadResult,setUploadResult]=useState<any>(null);


  async function uploadCsv(ev:any){
    const file=ev.target.files?.[0];
    if(!file)return;
    try{
      setMsg('Uploading CSV and running smoke backtest...');
      const form=new FormData(); form.append('file',file);
      const res=await fetch(`${API_BASE}/backtests/upload-csv`,{method:'POST',headers:{Authorization:`Bearer ${getToken()}`},body:form});
      const data=await res.json();
      if(!res.ok) throw new Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail||data));
      setUploadResult(data); setMsg('CSV upload backtest complete.');
    }catch(e:any){setMsg('CSV upload failed: '+e.message)}
  }

  async function refresh(){
    try{ setMsg('Loading jobs...'); const r: any = await api('/jobs/'); setJobs(Array.isArray(r)?r:(r.jobs||[])); setMsg(''); }
    catch(e:any){ setMsg('Jobs load failed: ' + e.message); }
  }
  useEffect(()=>{refresh()},[]);

  async function load(j:any){
    try{ setSelected(j); setSummary(null); setTrades([]);  setMsg('Loading reports...');
      const [s,t] = await Promise.all([api(`/reports/${j.id}/summary`), api(`/reports/${j.id}/trade-log`)]);
      setSummary(s); setTrades(Array.isArray(t) ? t : []); setMsg(''); }
    catch(e:any){ setMsg('Report load failed: ' + e.message); }
  }

  return <>
    <div className="hero"><h1>Backtest Results</h1></div>
    {msg && <div className="card">{msg}</div>}
    <div className="card"><h2>CSV Upload Backtest</h2><p>Required columns: timestamp, open, high, low, close, volume. Results are stored by the backend and can be exported from the returned JSON path.</p><input type="file" accept=".csv,text/csv" onChange={uploadCsv}/>{uploadResult&&<> <div className="grid" style={{marginTop:16}}><div><b>Rows</b><div className="metric">{uploadResult.rows}</div></div><div><b>Win Rate</b><div className="metric">{Number((uploadResult.win_rate||0)*100).toFixed(2)}%</div></div><div><b>Profit Factor</b><div className="metric">{fmt(uploadResult.profit_factor)}</div></div><div><b>Export</b><div style={{fontSize:12,overflowWrap:'anywhere'}}>{uploadResult.result_export_path}</div></div></div><PerformanceRobustness data={uploadResult}/><div style={{marginTop:16}}><TradingChart candles={[{time:uploadResult.first_timestamp,open:uploadResult.start_close,high:Math.max(uploadResult.start_close,uploadResult.end_close),low:Math.min(uploadResult.start_close,uploadResult.end_close),close:uploadResult.end_close}]} markers={[{time:uploadResult.first_timestamp,position:'belowBar',text:'CSV'}]} /></div></>}</div>
    <div className="card"><h2>Jobs</h2><button onClick={refresh}>Refresh Jobs</button><br/><br/><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={th}>Strategy ID</th><th style={th}>Symbol</th><th style={th}>Status</th><th style={th}>Mode</th><th style={th}>Timeframe</th><th style={th}>Created</th><th style={th}>Action</th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td style={td}>{displayStrategy(j)}</td><td style={td}>{syms(j)}</td><td style={td}>{j.status}</td><td style={td}>{j.mode}</td><td style={td}>{j.timeframe}</td><td style={td}>{j.created_at}</td><td style={td}><button onClick={()=>load(j)} disabled={j.status!=='completed'}>Open Report</button></td></tr>)}</tbody></table></div></div>
    {selected && <div className="card"><h2>Selected Job</h2><div className="grid"><div><b>Strategy ID</b><div className="metric">{displayStrategy(selected)}</div></div><div><b>Symbol</b><div className="metric">{syms(selected)}</div></div><div><b>Status</b><div className="metric">{selected.status}</div></div><div><b>Timeframe</b><div className="metric">{selected.timeframe}</div></div></div>{selected.error_message&&<p style={{color:'#f87171'}}>{selected.error_message}</p>}</div>}
    {summary && <div className="card"><h2>Summary</h2><div className="grid"><div><b>Total Trades</b><div className="metric">{summary.total_trades ?? 0}</div></div><div><b>Win Rate</b><div className="metric">{Number((summary.win_rate ?? 0) * 100).toFixed(2)}%</div></div><div><b>Gross R</b><div className="metric">{fmt(summary.gross_R)}R</div></div><div><b>Avg R</b><div className="metric">{fmt(summary.average_R)}R</div></div><div><b>Profit Factor</b><div className="metric">{fmt(summary.profit_factor)}</div></div><div><b>Max DD</b><div className="metric">{fmt(summary.max_drawdown_in_R)}R</div></div></div><PerformanceRobustness data={summary}/></div>}
    {trades.length > 0 && (
      <BacktestAnalytics
        trades={trades}
        summary={summary}
        strategyName={displayStrategy(selected)}
      />
    )}
  </>;
}
