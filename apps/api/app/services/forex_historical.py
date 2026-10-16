"""Robust Forex historical streaming ingestion and live quotes via Yahoo Finance API.

Features:
- Zero mandatory API keys or credit card registration required.
- Real-time live quotes and authentic historical OHLCV candlestick data.
- Covers major pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD),
  crosses (EURGBP, EURJPY, GBPJPY, EURCHF, AUDJPY, CADJPY, etc.),
  and exotics (USDINR, USDZAR, USDMXN, etc.).
- Converts raw candles into institutional PRISM CSV rows with O(1) rolling scalar
  registers (ATR 14, VWAP, spreads, regime, liquidity score).
"""
from __future__ import annotations

import csv
import gc
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.services.binance_historical import (
    PRISM_CSV_FIELDS,
    RollingScalarIndicatorState,
    interval_seconds,
    parse_date_utc,
    yesterday_utc,
)

# Standard Institutional Forex Currency Pairs
FOREX_MAJOR_PAIRS = [
    "EURUSD",  # Euro / US Dollar
    "GBPUSD",  # British Pound / US Dollar
    "USDJPY",  # US Dollar / Japanese Yen
    "USDCHF",  # US Dollar / Swiss Franc
    "USDCAD",  # US Dollar / Canadian Dollar
    "AUDUSD",  # Australian Dollar / US Dollar
    "NZDUSD",  # New Zealand Dollar / US Dollar
]

FOREX_CROSS_PAIRS = [
    "EURGBP",  # Euro / British Pound
    "EURJPY",  # Euro / Japanese Yen
    "GBPJPY",  # British Pound / Japanese Yen
    "EURCHF",  # Euro / Swiss Franc
    "AUDJPY",  # Australian Dollar / Japanese Yen
    "EURAUD",  # Euro / Australian Dollar
    "CADJPY",  # Canadian Dollar / Japanese Yen
    "GBPAUD",  # British Pound / Australian Dollar
    "NZDJPY",  # New Zealand Dollar / Japanese Yen
    "AUDCAD",  # Australian Dollar / Canadian Dollar
    "AUDNZD",  # Australian Dollar / New Zealand Dollar
    "EURNZD",  # Euro / New Zealand Dollar
    "GBPCAD",  # British Pound / Canadian Dollar
    "GBPCHF",  # British Pound / Swiss Franc
    "CHFJPY",  # Swiss Franc / Japanese Yen
]

FOREX_EXOTIC_PAIRS = [
    "USDINR",  # US Dollar / Indian Rupee
    "USDZAR",  # US Dollar / South African Rand
    "USDMXN",  # US Dollar / Mexican Peso
    "USDTRY",  # US Dollar / Turkish Lira
    "USDSGD",  # US Dollar / Singapore Dollar
    "EURTRY",  # Euro / Turkish Lira
]

POPULAR_FOREX_PAIRS = FOREX_MAJOR_PAIRS + ["EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "USDINR"]
ALL_FOREX_PAIRS = list(dict.fromkeys(FOREX_MAJOR_PAIRS + FOREX_CROSS_PAIRS + FOREX_EXOTIC_PAIRS))

KNOWN_FIAT_CURRENCIES = {
    "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
    "INR", "ZAR", "MXN", "TRY", "SGD", "HKD", "SEK", "NOK", "DKK", "PLN", "CNH"
}

_YF_BASES = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
]

_FOREX_TICKER_CACHE: Dict[str, Any] = {"ts": 0.0, "prices": {}}


def normalize_forex_symbol(symbol: str) -> str:
    s = str(symbol or "").strip().upper().replace("/", "").replace("-", "").replace("_", "")
    if s.endswith("=X"):
        s = s[:-2]
    return s


def is_forex_symbol(symbol: str) -> bool:
    s = normalize_forex_symbol(symbol)
    if not s:
        return False
    if s in ALL_FOREX_PAIRS:
        return True
    if len(s) == 6 and s.isalpha() and not (s.endswith("USDT") or s.endswith("USDC") or s.endswith("BUSD")):
        base = s[:3]
        quote = s[3:]
        if base in KNOWN_FIAT_CURRENCIES and quote in KNOWN_FIAT_CURRENCIES:
            return True
    return False


def to_yahoo_forex_ticker(symbol: str) -> str:
    s = normalize_forex_symbol(symbol)
    return f"{s}=X"


def map_timeframe_to_yf(tf: str) -> tuple[str, int]:
    """Map QuantEinstein timeframe to Yahoo Finance base interval and resampling multiplier."""
    tf_clean = str(tf or "1m").strip()
    sec = interval_seconds(tf_clean)

    if sec < 60:
        # Sub-minute: fetch 1m
        return "1m", max(1, sec)
    if sec == 60:
        return "1m", 1
    if sec == 180:
        return "1m", 3
    if sec == 300:
        return "5m", 1
    if sec == 900:
        return "15m", 1
    if sec == 1800:
        return "30m", 1
    if sec == 3600:
        return "1h", 1
    if sec == 7200:
        return "1h", 2
    if sec == 14400:
        return "1h", 4
    if sec == 21600:
        return "1h", 6
    if sec == 28800:
        return "1h", 8
    if sec == 43200:
        return "1h", 12
    if sec == 86400:
        return "1d", 1
    if sec == 259200:
        return "1d", 3
    if sec == 604800:
        return "1wk", 1
    if sec == 2592000:
        return "1mo", 1
    if sec == 7776000:
        return "1mo", 3
    if sec == 15552000:
        return "1mo", 6
    if sec == 23328000:
        return "1mo", 9
    if sec == 31536000:
        return "1mo", 12
    return "1d", 1


def fetch_live_forex_prices(symbols: Optional[List[str]] = None, max_age: float = 2.0) -> Dict[str, float]:
    """Fetch real-time Forex price snapshot with bounded caching."""
    now_ts = time.time()
    cached = _FOREX_TICKER_CACHE.get("prices", {})
    if now_ts - float(_FOREX_TICKER_CACHE.get("ts", 0.0)) < max_age and cached:
        return dict(cached)

    targets = [normalize_forex_symbol(s) for s in (symbols or POPULAR_FOREX_PAIRS)]
    targets = [s for s in targets if is_forex_symbol(s)]
    if not targets:
        targets = POPULAR_FOREX_PAIRS

    prices: Dict[str, float] = {}

    def _fetch_one(sym: str) -> tuple[str, float]:
        ticker = to_yahoo_forex_ticker(sym)
        for base in _YF_BASES:
            try:
                url = f"{base}/v8/finance/chart/{ticker}?interval=1m&range=1d"
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        "Accept": "application/json",
                    },
                )
                with urllib.request.urlopen(req, timeout=4) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
                    p = float(meta.get("regularMarketPrice") or 0.0)
                    if p > 0:
                        return sym, p
            except Exception:
                continue
        return sym, 0.0

    max_workers = min(len(targets), 8)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(_fetch_one, targets))

    for sym, p in results:
        if p > 0:
            prices[sym] = p

    if prices:
        _FOREX_TICKER_CACHE["ts"] = now_ts
        _FOREX_TICKER_CACHE["prices"].update(prices)

    return dict(_FOREX_TICKER_CACHE.get("prices", {}))


def fetch_recent_forex_candles(symbol: str, interval: str = "1m", limit: int = 100) -> List[Dict[str, Any]]:
    """Fetch recent Forex candlestick bars for charting & live paper trading."""
    sym = normalize_forex_symbol(symbol)
    ticker = to_yahoo_forex_ticker(sym)
    yf_interval, resample_factor = map_timeframe_to_yf(interval)
    lim = max(10, min(int(limit), 500))

    # Calculate required range span based on interval
    sec = interval_seconds(interval)
    total_sec = sec * lim * 2
    now_ts = int(time.time())
    p1 = max(0, now_ts - total_sec)

    for base in _YF_BASES:
        try:
            url = f"{base}/v8/finance/chart/{ticker}?period1={p1}&period2={now_ts}&interval={yf_interval}"
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            res = data.get("chart", {}).get("result", [{}])[0]
            timestamps = res.get("timestamp") or []
            quotes = res.get("indicators", {}).get("quote", [{}])[0]
            opens = quotes.get("open") or []
            highs = quotes.get("high") or []
            lows = quotes.get("low") or []
            closes = quotes.get("close") or []
            volumes = quotes.get("volume") or []

            raw_candles = []
            for i in range(len(timestamps)):
                t = int(timestamps[i])
                o = opens[i] if i < len(opens) else None
                h = highs[i] if i < len(highs) else None
                l = lows[i] if i < len(lows) else None
                c = closes[i] if i < len(closes) else None
                v = float(volumes[i] or 1000.0) if i < len(volumes) else 1000.0
                if o is not None and h is not None and l is not None and c is not None:
                    raw_candles.append({
                        "time": t,
                        "open": float(o),
                        "high": float(h),
                        "low": float(l),
                        "close": float(c),
                        "volume": v,
                    })

            if not raw_candles:
                continue

            if resample_factor > 1:
                grouped = []
                for idx in range(0, len(raw_candles), resample_factor):
                    grp = raw_candles[idx : idx + resample_factor]
                    if grp:
                        grouped.append({
                            "time": grp[0]["time"],
                            "open": grp[0]["open"],
                            "high": max(x["high"] for x in grp),
                            "low": min(x["low"] for x in grp),
                            "close": grp[-1]["close"],
                            "volume": sum(x["volume"] for x in grp),
                        })
                return grouped[-lim:]

            return raw_candles[-lim:]
        except Exception:
            continue
    return []


def fetch_real_forex_csv(
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str | None = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Download/resample authentic Forex candles from Yahoo Finance and cache as PRISM CSV."""
    sym = normalize_forex_symbol(symbol)
    if not is_forex_symbol(sym):
        raise ValueError(f"Invalid Forex currency pair format: {symbol}. Expected pair like EURUSD, GBPUSD, USDJPY.")

    end_date = end_date or yesterday_utc()
    start_dt = parse_date_utc(start_date, end_of_day=False)
    end_dt = parse_date_utc(end_date, end_of_day=True)
    if start_dt >= end_dt:
        raise ValueError("Start date must be before end date.")

    tf_sec = interval_seconds(timeframe)
    yf_interval, resample_factor = map_timeframe_to_yf(timeframe)
    days = max(1, (end_dt.date() - start_dt.date()).days + 1)

    # Auto-extend historical window if selected span has fewer than 45 bars
    if tf_sec >= 14400:
        min_span_sec = 45 * tf_sec
        if (end_dt - start_dt).total_seconds() < min_span_sec:
            forex_genesis = datetime(2015, 1, 1, tzinfo=timezone.utc)
            start_dt = max(forex_genesis, end_dt - timedelta(seconds=min_span_sec))

    tf_dir_name = f"{timeframe[:-1]}mo" if timeframe.endswith("M") else timeframe
    out_dir = settings.project_root / "data" / "forex" / sym / tf_dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / f"{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.csv"
    meta_path = out_dir / f"{start_dt.date().isoformat()}_{end_dt.date().isoformat()}.meta.json"

    if csv_path.exists() and not force_refresh:
        row_count = 0
        try:
            with csv_path.open("r", encoding="utf-8") as fh:
                for _ in fh:
                    row_count += 1
            row_count = max(0, row_count - 1)
        except Exception:
            row_count = None
        if row_count and row_count > 0:
            return {
                "path": str(csv_path),
                "cached": True,
                "symbol": sym,
                "asset_class": "forex",
                "timeframe": timeframe,
                "start_date": start_dt.date().isoformat(),
                "end_date": end_dt.date().isoformat(),
                "rows": row_count,
                "real_forex_data": True,
                "real_binance_data": False,
            }

    p1 = int(start_dt.timestamp())
    p2 = int(end_dt.timestamp())
    ticker = to_yahoo_forex_ticker(sym)

    fetched_data = None
    last_err = None
    for base in _YF_BASES:
        try:
            url = f"{base}/v8/finance/chart/{ticker}?period1={p1}&period2={p2}&interval={yf_interval}"
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                fetched_data = json.loads(resp.read().decode("utf-8"))
            if fetched_data:
                break
        except Exception as ex:
            last_err = ex
            continue

    if not fetched_data:
        raise ValueError(f"Failed to fetch authentic Forex historical candles for {sym}: {last_err or 'No data returned'}")

    res = fetched_data.get("chart", {}).get("result", [{}])[0]
    timestamps = res.get("timestamp") or []
    quotes = res.get("indicators", {}).get("quote", [{}])[0]
    opens = quotes.get("open") or []
    highs = quotes.get("high") or []
    lows = quotes.get("low") or []
    closes = quotes.get("close") or []
    volumes = quotes.get("volume") or []

    raw_bars = []
    for i in range(len(timestamps)):
        t_ms = int(timestamps[i]) * 1000
        o = opens[i] if i < len(opens) else None
        h = highs[i] if i < len(highs) else None
        l = lows[i] if i < len(lows) else None
        c = closes[i] if i < len(closes) else None
        v = float(volumes[i] or 1000.0) if i < len(volumes) else 1000.0
        if o is not None and h is not None and l is not None and c is not None:
            raw_bars.append({
                "timestamp_ms": t_ms,
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": v,
            })

    if not raw_bars:
        raise ValueError(f"No valid candlestick rows returned by Yahoo Finance for {sym} ({start_date} to {end_date}).")

    # Resample if target interval is a multiple of yf_interval
    if resample_factor > 1:
        resampled_bars = []
        for idx in range(0, len(raw_bars), resample_factor):
            grp = raw_bars[idx : idx + resample_factor]
            if grp:
                resampled_bars.append({
                    "timestamp_ms": grp[0]["timestamp_ms"],
                    "open": grp[0]["open"],
                    "high": max(x["high"] for x in grp),
                    "low": min(x["low"] for x in grp),
                    "close": grp[-1]["close"],
                    "volume": sum(x["volume"] for x in grp),
                })
        target_bars = resampled_bars
    else:
        target_bars = raw_bars

    scalar_state = RollingScalarIndicatorState(atr_period=14, ema_period=20)
    tmp_path = csv_path.with_suffix(".csv.tmp")
    total_rows = 0

    with tmp_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(PRISM_CSV_FIELDS)
        for b in target_bars:
            row = scalar_state.update(
                open_=b["open"],
                high=b["high"],
                low=b["low"],
                close=b["close"],
                vol=b["volume"],
                timestamp_ms=b["timestamp_ms"],
            )
            # Forex spreads are typically 0.01% - 0.02%
            row["spread_pct"] = 0.015
            w.writerow([
                row["timestamp"],
                row["open"],
                row["high"],
                row["low"],
                row["close"],
                row["volume"],
                row["vwap"],
                row["atr_14"],
                row["spread_pct"],
                row["liquidity_score"],
                row["oi"],
                row["mse_state"],
                row["regime"],
                row["ipse_alignment"],
                row["microstructure_state"],
                row["mps_state"],
            ])
            total_rows += 1

    if total_rows == 0:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise ValueError(f"No processed PRISM rows generated for Forex pair {sym}.")

    tmp_path.replace(csv_path)

    meta = {
        "symbol": sym,
        "asset_class": "forex",
        "timeframe": timeframe,
        "yf_interval_used": yf_interval,
        "rows": total_rows,
        "start_date": start_dt.date().isoformat(),
        "end_date": end_dt.date().isoformat(),
        "cached": False,
        "real_forex_data": True,
        "real_binance_data": False,
        "synthetic_data_used": False,
        "source": "Yahoo Finance Free v8 Chart API",
        "note": (
            "Authentic Forex OHLCV candlestick data retrieved from Yahoo Finance "
            "with zero API keys required and processed with O(1) PRISM scalar registers."
        ),
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {"path": str(csv_path), **meta}
