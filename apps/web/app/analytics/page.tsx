'use client';
import {useEffect,useMemo,useState} from 'react';
import {api} from '../../lib/api';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';

type Job={id:string; mode:string; status:string; created_at:string; timeframe?:string; symbols_json?:string; display_strategy_id?:string; user_strategy_id?:string; strategy_code?:string; strategy_id?:string};
const th:any={textAlign:'left', padding:'10px 8px', borderBottom:'1px solid #334155', color:'#94a3b8'};
const td:any={padding:'9px 8px', borderBottom:'1px solid #1e293b'};
function fmt(n:any,d=2){const x=Number(n??0); return Number.isFinite(x)?x.toFixed(d).replace(/\.00$/,''):'0'}
function parseSymbols(j:Job){try{return JSON.parse(j.symbols_json||'[]').join(', ')}catch{return '-'}}
function displayStrategy(j:Job){return j.display_strategy_id || j.user_strategy_id || j.strategy_code || j.strategy_id || 'STRATEGY'}

function bucket(values:number[]){
  if(!values.length)return [];
  const min=Math.floor(Math.min(...values)*2)/2;
  const max=Math.ceil(Math.max(...values)*2)/2;
  const out:Record<string,number>={};
  for(let b=min;b<=max;b+=0.5)out[b.toFixed(1)]=0;
  values.forEach(v=>{const key=(Math.floor(v/0.5)*0.5).toFixed(1); out[key]=(out[key]||0)+1;});
  return Object.entries(out).map(([r,count])=>({r,count, fill:Number(r)>=0?'#22c55e':'#ef4444'}));
}

const chartBox:any={width:'100%',height:280};
const tooltip:any={background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0'};

export default function Analytics(){
  const [jobs,setJobs]=useState<Job[]>([]),[data,setData]=useState<any>(null),[curve,setCurve]=useState<any[]>([]),[msg,setMsg]=useState('');
  useEffect(()=>{api('/jobs/').then((r:any)=>setJobs(Array.isArray(r)?r:(r.jobs||[]))).catch(e=>setMsg('Cannot reach Quanteinstein API. Start the backend and refresh. '+e.message))},[]);
  async function load(id:string){
    if(!id) return; setMsg('Loading analytics...');
    try{ const [r,c]=await Promise.all([api(`/analytics/${id}/r-multiples`), api(`/analytics/${id}/equity-curve`)]); setData(r); setCurve(Array.isArray(c)?c:[]); setMsg(''); }
    catch(e:any){setMsg('Analytics load failed: '+e.message)}
  }
  const selected=useMemo(()=>jobs.find(j=>j.id===data?.job_id),[jobs,data]);
  const values:number[]=Array.isArray(data?.values)?data.values.map((v:any)=>Number(v)).filter((v:number)=>Number.isFinite(v)):[];
  let peak=0;
  const equity=curve.map((r,i)=>{
    const eq=Number(r.equity_R||0);
    peak=Math.max(peak,eq);
    return {trade:i+1, trade_id:r.trade_id, equity_R:eq, drawdown_R:eq-peak};
  });
  const hist=bucket(values);
  const winLoss=[
    {name:'Wins',value:Number(data?.wins||0),fill:'#22c55e'},
    {name:'Losses',value:Number(data?.losses||0),fill:'#ef4444'},
    {name:'Breakeven',value:Math.max(0,values.length-Number(data?.wins||0)-Number(data?.losses||0)),fill:'#94a3b8'},
  ].filter(x=>x.value>0);
  const hasTrades=values.length>0;
  return <>
    <div className="hero"><h1>R-Multiple Analytics</h1><p className="muted">Professional visual report for completed Quanteinstein backtests and paper sessions.</p></div>
    {msg && <div className="card" style={{borderColor:'#7f1d1d', color:msg.startsWith('Cannot')?'#f87171':'#cbd5e1'}}>{msg}</div>}
    <div className="card"><label>Select Job<select onChange={e=>load(e.target.value)} defaultValue=""><option value="">Choose completed job...</option>{jobs.filter(j=>j.status==='completed').map(j=><option key={j.id} value={j.id}>{displayStrategy(j)} - {j.mode} - {parseSymbols(j)} - {j.timeframe||''}</option>)}</select></label></div>
    {data&&<>
      <div className="grid">
        <div className="card"><h3>Gross R</h3><div className="metric">{fmt(data.gross_R)}R</div></div>
        <div className="card"><h3>Avg R</h3><div className="metric">{fmt(data.avg_R,3)}R</div></div>
        <div className="card"><h3>Wins / Losses</h3><div className="metric">{data.wins}/{data.losses}</div></div>
        <div className="card"><h3>Total Trades</h3><div className="metric">{values.length}</div></div>
      </div>
      {selected&&<p className="muted">Selected: {displayStrategy(selected)} - {parseSymbols(selected)} - {selected.timeframe||'timeframe unknown'}</p>}
      {!hasTrades&&<div className="card"><h2>No trade analytics yet</h2><p className="muted">This completed job has no trade R-multiple data, so Quanteinstein cannot draw equity, drawdown, distribution, or win/loss charts honestly.</p></div>}
      {hasTrades&&<>
        <div className="grid">
          <div className="card"><h2>Equity Curve in R</h2><div style={chartBox}><ResponsiveContainer><AreaChart data={equity}><CartesianGrid stroke="#1e293b"/><XAxis dataKey="trade" stroke="#94a3b8"/><YAxis stroke="#94a3b8"/><Tooltip contentStyle={tooltip}/><Area type="monotone" dataKey="equity_R" stroke="#38bdf8" fill="#0ea5e955"/></AreaChart></ResponsiveContainer></div></div>
          <div className="card"><h2>Drawdown Curve in R</h2><div style={chartBox}><ResponsiveContainer><AreaChart data={equity}><CartesianGrid stroke="#1e293b"/><XAxis dataKey="trade" stroke="#94a3b8"/><YAxis stroke="#94a3b8"/><Tooltip contentStyle={tooltip}/><Area type="monotone" dataKey="drawdown_R" stroke="#f97316" fill="#f9731655"/></AreaChart></ResponsiveContainer></div></div>
          <div className="card"><h2>R-Multiple Distribution</h2><div style={chartBox}><ResponsiveContainer><BarChart data={hist}><CartesianGrid stroke="#1e293b"/><XAxis dataKey="r" stroke="#94a3b8"/><YAxis stroke="#94a3b8"/><Tooltip contentStyle={tooltip}/><Bar dataKey="count">{hist.map((h,i)=><Cell key={i} fill={h.fill}/>)}</Bar></BarChart></ResponsiveContainer></div></div>
          <div className="card"><h2>Wins vs Losses</h2><div style={chartBox}><ResponsiveContainer><PieChart><Tooltip contentStyle={tooltip}/><Pie data={winLoss} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} label>{winLoss.map((x,i)=><Cell key={i} fill={x.fill}/>)}</Pie></PieChart></ResponsiveContainer></div></div>
        </div>
        <div className="card"><h2>Equity Table</h2><p className="muted">Running equity in R after each trade.</p><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={th}>Trade #</th><th style={th}>Trade ID</th><th style={th}>Equity R</th><th style={th}>Drawdown R</th><th style={th}>Status</th></tr></thead><tbody>{equity.map((r,i)=><tr key={i}><td style={td}>{i+1}</td><td style={td}>{r.trade_id||'-'}</td><td style={td}>{fmt(r.equity_R,3)}R</td><td style={td}>{fmt(r.drawdown_R,3)}R</td><td style={td}>{Number(r.equity_R)>=0?'Positive':'Negative'}</td></tr>)}</tbody></table></div></div>
      </>}
    </>}
  </>
}
