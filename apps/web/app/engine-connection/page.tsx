'use client';
import {useEffect,useState} from 'react';
import {api,formatApiError} from '../../lib/api';

export default function EngineConnection(){
  const [status,setStatus]=useState<any>(null);
  const [token,setToken]=useState<any>(null);
  const [msg,setMsg]=useState('');
  async function refresh(){try{setStatus(await api('/engine/status'));}catch(e){setMsg(formatApiError(e));}}
  async function connect(source='BTCUSDT'){try{setMsg(''); const r=await api('/engine/token',{method:'POST',body:JSON.stringify({mode:'paper',exchange:'binance',source})}); setToken(r); await refresh();}catch(e){setMsg(formatApiError(e));}}
  useEffect(()=>{refresh(); const t=window.setInterval(refresh,3000); return()=>window.clearInterval(t);},[]);
  const latency=status?.latency||{};
  const windowsCommand=token?.windows_command || 'build\\Release\\quantos-engine.exe --token <TOKEN> --mode paper --exchange binance --symbol BTCUSDT';
  const linuxCommand=token?.linux_command || './build/quantos-engine --token <TOKEN> --mode paper --exchange binance --symbol BTCUSDT';
  async function copyCommand(cmd?: string){ if(cmd && navigator?.clipboard) await navigator.clipboard.writeText(cmd); }
  return <>
    <div className="hero"><h1>Engine Connection</h1><p>Run market data, paper simulation, and low-latency work on your machine. Cloud stores only safe telemetry/results.</p></div>
    {msg&&<div className="card" style={{color:'#fca5a5'}}>{msg}</div>}
    <div className="card"><h2>Local Engine Bridge</h2><button onClick={()=>connect('BTCUSDT')}>Connect Local Engine</button>{' '}<button onClick={()=>connect('BTCUSDT')}>Connect BTC Live Feed</button>{' '}<button onClick={()=>connect('CUSTOM')}>Connect Custom Source</button>
      <div style={{marginTop:16}}><b>Windows:</b><pre style={{whiteSpace:'pre-wrap'}}>{windowsCommand}</pre><button onClick={()=>copyCommand(windowsCommand)}>Copy Windows command</button><div style={{marginTop:14}}><b>Linux/macOS/Docker:</b><pre style={{whiteSpace:'pre-wrap'}}>{linuxCommand}</pre><button onClick={()=>copyCommand(linuxCommand)}>Copy Linux command</button></div>{token&&<p style={{color:'#94a3b8'}}>Token expires at epoch {token.expires_at_epoch}. Do not paste exchange API keys into Quanteinstein cloud.</p>}</div>
    </div>
    <div className="card"><h2>Status</h2><div className="grid">
      <div><b>Connected/Disconnected</b><div className="metric">{status?.connected?'BTCUSDT connected':'Disconnected'}</div></div><div><b>Engine token status</b><div className="metric">{token?'Generated':'Not generated'}</div></div>
      <div><b>Exchange/source</b><div className="metric">{status?.exchange||'-'} / {status?.source||'-'}</div></div>
      <div><b>Mode</b><div className="metric">{status?.mode||'paper'}</div></div>
      <div><b>Last heartbeat</b><div className="metric">{status?.last_heartbeat||'-'}</div></div>
      <div><b>Engine version</b><div className="metric">{status?.engine_version||'-'}</div></div>
      <div><b>BTCUSDT latest</b><div className="metric">{status?.latest_price||'-'}</div></div><div><b>Paper session</b><div className="metric">{status?.connected?'local paper ready':'waiting for local engine'}</div></div><div><b>P&L / position / trades</b><div className="metric">{status?.payload?'synced':'-'}</div></div>
      <div><b>p50/p95/p99 internal latency</b><div className="metric">{latency.p50_us||0}/{latency.p95_us||0}/{latency.p99_us||0} us</div></div>
    </div>{!status?.connected&&<p className="muted">Run the command in C:\quanteinstein.</p>}<p style={{color:'#fbbf24'}}>Paper trading only. Real-money trading is disabled.</p></div>
  </>;
}
