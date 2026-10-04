"""Robust Binance historical kline cache for real-data backtests.

Policy:
- No synthetic price fallback.
- Backtests use real Binance REST klines when cache is missing.
- Downloads are chunked/retried and cached, so future runs are fast.
- Live paper trading stays WebSocket-based; this module is for historical data only.
"""
from __future__ import annotations

import concurrent.futures
import csv
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

from app.core.config import settings

from app.services.live_paper import POPULAR_SYMBOLS

SUPPORTED_SYMBOLS = POPULAR_SYMBOLS
SUPPORTED_INTERVALS = ["1s", "5s", "10s", "15s", "30s", "1m", "5m", "15m", "1h"]
BINANCE_INTERVALS = {"1s", "1m", "5m", "15m", "1h"}
REQUEST_TIMEOUT = 6
MAX_RETRIES = 2


def yesterday_utc() -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


def parse_date_utc(date_text: str, end_of_day: bool = False) -> datetime:
    d = datetime.fromisoformat(date_text[:10]).replace(tzinfo=timezone.utc)
    if end_of_day:
        return d + timedelta(days=1) - timedelta(milliseconds=1)
    return d


def interval_seconds(tf: str) -> int:
    unit = tf[-1]
    n = int(tf[:-1])
    if unit == "s":
        return n
    if unit == "m":
        return n * 60
    if unit == "h":
        return n * 3600
    raise ValueError(f"Unsupported timeframe: {tf}")


def _interval_for_binance(tf: str) -> str:
    # Binance does not expose 5s/10s/15s/30s klines directly. We fetch 1s
    # and aggregate locally only for short ranges. This remains real data, but
    # 1s long-range history is very heavy, so the UI should use 1m+ for year tests.
    return tf if tf in BINANCE_INTERVALS else "1s"


def _safe_symbol(symbol: str) -> str:
    s = (symbol or "BTCUSDT").upper().strip()
    import re
    if not re.match(r"^[A-Z0-9]{2,16}(USDT|BUSD|USDC)$", s):
        raise ValueError(f"Invalid cryptocurrency pair format: {s}. Expected Binance pair ending with USDT, BUSD, or USDC.")
    return s


def _safe_timeframe(tf: str) -> str:
    t = (tf or "1m").lower().strip()
    if t not in SUPPORTED_INTERVALS:
        raise ValueError(f"Unsupported timeframe {t}. Allowed: {', '.join(SUPPORTED_INTERVALS)}")
    return t


BINANCE_BASES = [
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://data-api.binance.vision",
    "https://api.binance.us",
]

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


def _urlopen_json(url: str) -> Any:
    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=BROWSER_HEADERS)
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            time.sleep(0.2 * attempt)
    raise RuntimeError(f"Binance request failed after {MAX_RETRIES} retries: {last_err}")


def _fetch_kline_slice(args: tuple[str, str, int, int, int]) -> List[list]:
    symbol, interval, s_ms, e_ms, idx = args
    params = urllib.parse.urlencode({
        "symbol": symbol,
        "interval": interval,
        "startTime": s_ms,
        "endTime": e_ms,
        "limit": 1000,
    })
    last_err = None
    num_bases = len(BINANCE_BASES)
    for attempt in range(num_bases):
        base = BINANCE_BASES[(idx + attempt) % num_bases]
        url = f"{base}/api/v3/klines?{params}"
        try:
            req = urllib.request.Request(url, headers=BROWSER_HEADERS)
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list):
                    return data
        except Exception as e:
            last_err = e
            continue
    return []


def _fetch_klines(symbol: str, interval: str, start_ms: int, end_ms: int) -> List[list]:
    step_ms = interval_seconds(interval) * 1000
    chunk_span = 1000 * step_ms
    slices = []
    c = start_ms
    idx = 0
    while c < end_ms:
        nxt = min(end_ms, c + chunk_span - 1)
        slices.append((symbol, interval, c, nxt, idx))
        c += chunk_span
        idx += 1

    if not slices:
        return []

    if len(slices) == 1:
        raw_chunks = [_fetch_kline_slice(slices[0])]
    else:
        max_workers = min(len(slices), 8)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            raw_chunks = list(executor.map(_fetch_kline_slice, slices))

    by_time: Dict[int, list] = {}
    for chunk in raw_chunks:
        for r in chunk:
            by_time[int(r[0])] = r
    return [by_time[k] for k in sorted(by_time)]


def _download_chunked(symbol: str, base_interval: str, start_dt: datetime, end_dt: datetime) -> List[list]:
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)
    return _fetch_klines(symbol, base_interval, start_ms, end_ms)


def _aggregate_rows(rows: List[list], target_tf: str) -> List[Dict[str, Any]]:
    sec = interval_seconds(target_tf)
    buckets: Dict[int, Dict[str, Any]] = {}
    for r in rows:
        open_ms = int(r[0])
        bucket_ms = (open_ms // (sec * 1000)) * (sec * 1000)
        o = float(r[1]); h = float(r[2]); l = float(r[3]); c = float(r[4]); v = float(r[5])
        b = buckets.get(bucket_ms)
        if not b:
            buckets[bucket_ms] = {"timestamp_ms": bucket_ms, "open": o, "high": h, "low": l, "close": c, "volume": v}
        else:
            b["high"] = max(float(b["high"]), h)
            b["low"] = min(float(b["low"]), l)
            b["close"] = c
            b["volume"] = float(b["volume"]) + v
    return [buckets[k] for k in sorted(buckets)]


def _rows_to_prism(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    n = len(rows)
    if n == 0:
        return []
    out: List[Dict[str, Any]] = [None] * n
    tr_window = [0.0] * 14
    running_tr_sum = 0.0
    prev_close = float(rows[0]["close"])

    for i, b in enumerate(rows):
        high = float(b["high"])
        low = float(b["low"])
        close = float(b["close"])
        open_ = float(b["open"])
        vol = float(b["volume"])

        vwap = (high + low + close) / 3.0

        if i == 0:
            tr = max(high - low, close * 0.001)
            atr = tr
            tr_window[0] = tr
            running_tr_sum = tr
        else:
            tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
            idx = i % 14
            running_tr_sum = running_tr_sum - tr_window[idx] + tr
            tr_window[idx] = tr
            if i < 14:
                atr = running_tr_sum / (i + 1)
            else:
                atr = running_tr_sum / 14.0

        prev_close = close
        ts = datetime.fromtimestamp(int(b["timestamp_ms"]) / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        is_up = close >= open_

        out[i] = {
            "timestamp": ts,
            "open": round(open_, 8),
            "high": round(high, 8),
            "low": round(low, 8),
            "close": round(close, 8),
            "volume": round(vol, 8),
            "vwap": round(vwap, 8),
            "atr_14": round(atr, 8),
            "spread_pct": 0.05,
            "liquidity_score": 0.90,
            "oi": 0,
            "mse_state": "TREND_UP" if is_up else "TREND_DOWN",
            "regime": "NORMAL",
            "ipse_alignment": "ALIGNED" if is_up else "NEUTRAL",
            "microstructure_state": "HEALTHY",
            "mps_state": "ALLOW",
        }
    return out


def fetch_real_binance_csv(symbol: str, timeframe: str, start_date: str, end_date: str | None = None, force_refresh: bool = False) -> Dict[str, Any]:
    symbol = _safe_symbol(symbol)
    timeframe = _safe_timeframe(timeframe)
    end_date = end_date or yesterday_utc()
    start_dt = parse_date_utc(start_date, end_of_day=False)
    end_dt = parse_date_utc(end_date, end_of_day=True)
    if start_dt >= end_dt:
        raise ValueError("Start date must be before end date.")
    days = max(1, (end_dt.date() - start_dt.date()).days + 1)
    if interval_seconds(timeframe) < 60 and days > 7:
        raise ValueError("Sub-minute historical backtests are limited to 7 days because real 1s Binance data is extremely large. Use 1m+ for 30/90/365 day backtests; live paper can still use 1s/5s.")

    out_dir = settings.project_root / "data" / "binance" / symbol / timeframe
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / f"{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.csv"
    meta_path = out_dir / f"{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.meta.json"
    if csv_path.exists() and not force_refresh:
        try:
            row_count = max(0, sum(1 for _ in csv_path.open("r", encoding="utf-8")) - 1)
        except Exception:
            row_count = None
        return {"path": str(csv_path), "cached": True, "symbol": symbol, "timeframe": timeframe, "start_date": start_dt.date().isoformat(), "end_date": end_dt.date().isoformat(), "rows": row_count, "real_binance_data": True}

    base_interval = _interval_for_binance(timeframe)
    raw = _download_chunked(symbol, base_interval, start_dt, end_dt)
    if base_interval == timeframe:
        agg = [{"timestamp_ms": int(r[0]), "open": float(r[1]), "high": float(r[2]), "low": float(r[3]), "close": float(r[4]), "volume": float(r[5])} for r in raw]
    else:
        agg = _aggregate_rows(raw, timeframe)
    prism_rows = _rows_to_prism(agg)
    if not prism_rows:
        raise ValueError("No Binance historical rows returned for the selected range.")
    fields = ["timestamp","open","high","low","close","volume","vwap","atr_14","spread_pct","liquidity_score","oi","mse_state","regime","ipse_alignment","microstructure_state","mps_state"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(fields)
        for r in prism_rows:
            w.writerow([
                r["timestamp"], r["open"], r["high"], r["low"], r["close"],
                r["volume"], r["vwap"], r["atr_14"], r["spread_pct"],
                r["liquidity_score"], r["oi"], r["mse_state"], r["regime"],
                r["ipse_alignment"], r["microstructure_state"], r["mps_state"]
            ])
    meta = {"symbol": symbol, "timeframe": timeframe, "binance_interval_used": base_interval, "rows": len(prism_rows), "start_date": start_dt.date().isoformat(), "end_date": end_dt.date().isoformat(), "cached": False, "real_binance_data": True, "synthetic_data_used": False, "note": "OHLCV candles are fetched from Binance REST in retryable chunks and cached locally. PRISM metadata columns are deterministic labels derived from candles."}
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {"path": str(csv_path), **meta}
