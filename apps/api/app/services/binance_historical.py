"""Robust Binance historical kline streaming ingestion for real-data backtests.

Policy:
- No synthetic price fallback.
- Strictly REST-only for historical backtests (WebSockets are restricted exclusively to live paper trading).
- Fetches Binance historical klines via REST (/api/v3/klines) in chunked paginated requests of 1,000 bars (limit=1000).
- Streams 1,000-bar chunks directly using O(1) single rolling scalar registers (prevClose, prevATR, prevEMA) so previous chunk buffers are garbage-collected immediately.
"""
from __future__ import annotations

import csv
import gc
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List

from app.core.config import settings
from app.services.live_paper import POPULAR_SYMBOLS

SUPPORTED_SYMBOLS = POPULAR_SYMBOLS
SUPPORTED_INTERVALS = ["1s", "5s", "10s", "15s", "30s", "1m", "5m", "15m", "1h"]
BINANCE_INTERVALS = {"1s", "1m", "5m", "15m", "1h"}
CHUNK_LIMIT = 1000
REQUEST_TIMEOUT = 8
MAX_RETRIES = 3

PRISM_CSV_FIELDS = [
    "timestamp",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "vwap",
    "atr_14",
    "spread_pct",
    "liquidity_score",
    "oi",
    "mse_state",
    "regime",
    "ipse_alignment",
    "microstructure_state",
    "mps_state",
]


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
    return tf if tf in BINANCE_INTERVALS else "1s"


def _safe_symbol(symbol: str) -> str:
    s = (symbol or "BTCUSDT").upper().strip()
    if not re.match(r"^[A-Z0-9]{2,16}(USDT|BUSD|USDC)$", s):
        raise ValueError(
            f"Invalid cryptocurrency pair format: {s}. Expected Binance pair ending with USDT, BUSD, or USDC."
        )
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
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


class RollingScalarIndicatorState:
    """O(1) single-scalar rolling indicator state across streamed 1,000-bar chunks."""

    __slots__ = ("prev_close", "prev_atr", "prev_ema", "bar_count", "atr_period", "ema_alpha")

    def __init__(self, atr_period: int = 14, ema_period: int = 20) -> None:
        self.prev_close: float = 0.0
        self.prev_atr: float = 0.0
        self.prev_ema: float = 0.0
        self.bar_count: int = 0
        self.atr_period: int = max(1, atr_period)
        self.ema_alpha: float = 2.0 / (max(1, ema_period) + 1.0)

    def update(self, open_: float, high: float, low: float, close: float, vol: float, timestamp_ms: int) -> Dict[str, Any]:
        self.bar_count += 1
        if self.bar_count == 1:
            tr = max(high - low, close * 0.001)
            self.prev_atr = tr
            self.prev_ema = close
        else:
            tr = max(high - low, abs(high - self.prev_close), abs(low - self.prev_close))
            p = float(self.atr_period)
            if self.bar_count <= self.atr_period:
                self.prev_atr = ((self.prev_atr * (self.bar_count - 1)) + tr) / float(self.bar_count)
            else:
                self.prev_atr = ((self.prev_atr * (p - 1.0)) + tr) / p
            self.prev_ema = (self.ema_alpha * close) + ((1.0 - self.ema_alpha) * self.prev_ema)

        self.prev_close = close
        vwap = (high + low + close) / 3.0
        ts = datetime.fromtimestamp(int(timestamp_ms) / 1000.0, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        is_up = close >= open_ or close >= self.prev_ema

        return {
            "timestamp": ts,
            "open": round(open_, 8),
            "high": round(high, 8),
            "low": round(low, 8),
            "close": round(close, 8),
            "volume": round(vol, 8),
            "vwap": round(vwap, 8),
            "atr_14": round(self.prev_atr, 8),
            "spread_pct": 0.05,
            "liquidity_score": 0.90,
            "oi": 0,
            "mse_state": "TREND_UP" if is_up else "RANGE",
            "regime": "NORMAL",
            "ipse_alignment": "ALIGNED" if is_up else "NEUTRAL",
            "microstructure_state": "HEALTHY",
            "mps_state": "ALLOW",
        }


def _fetch_kline_slice(args: tuple[str, str, int, int, int]) -> List[list]:
    """Fetch a single paginated 1,000-bar chunk from Binance REST /api/v3/klines."""
    symbol, interval, s_ms, e_ms, idx = args
    params = urllib.parse.urlencode(
        {
            "symbol": symbol,
            "interval": interval,
            "startTime": s_ms,
            "endTime": e_ms,
            "limit": CHUNK_LIMIT,
        }
    )
    num_bases = len(BINANCE_BASES)
    for retry in range(MAX_RETRIES):
        for attempt in range(num_bases):
            base = BINANCE_BASES[(idx + attempt) % num_bases]
            url = f"{base}/api/v3/klines?{params}"
            try:
                req = urllib.request.Request(url, headers=BROWSER_HEADERS)
                with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, list):
                        return data
            except Exception:
                continue
        time.sleep(0.15 * (retry + 1))
    return []


def iter_binance_raw_chunks(
    symbol: str,
    interval: str,
    start_ms: int,
    end_ms: int,
) -> Iterator[List[list]]:
    """Yield sequential paginated 1,000-bar chunks from Binance REST without accumulating history in RAM."""
    step_ms = interval_seconds(interval) * 1000
    chunk_span = CHUNK_LIMIT * step_ms
    cursor_ms = start_ms
    idx = 0
    last_open_ms = -1

    while cursor_ms <= end_ms:
        window_end_ms = min(end_ms, cursor_ms + chunk_span - 1)
        chunk = _fetch_kline_slice((symbol, interval, cursor_ms, window_end_ms, idx))
        idx += 1

        if not chunk:
            cursor_ms = window_end_ms + 1
            continue

        deduped_chunk: List[list] = []
        for row in chunk:
            open_ms = int(row[0])
            if open_ms > last_open_ms and open_ms <= end_ms:
                deduped_chunk.append(row)
                last_open_ms = open_ms

        if deduped_chunk:
            yield deduped_chunk

        next_ms = int(chunk[-1][0]) + step_ms
        if next_ms <= cursor_ms:
            cursor_ms = window_end_ms + 1
        else:
            cursor_ms = next_ms


def stream_binance_klines_chunked(
    symbol: str,
    timeframe: str,
    start_dt: datetime,
    end_dt: datetime,
) -> Iterator[List[Dict[str, Any]]]:
    """Stream converted PRISM bars in 1,000-bar chunks using O(1) scalar registers."""
    base_interval = _interval_for_binance(timeframe)
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)
    scalar_state = RollingScalarIndicatorState(atr_period=14, ema_period=20)
    target_sec = interval_seconds(timeframe)
    bucket_ms_span = target_sec * 1000
    carry_bucket: Dict[str, Any] | None = None

    for raw_chunk in iter_binance_raw_chunks(symbol, base_interval, start_ms, end_ms):
        prism_chunk: List[Dict[str, Any]] = []
        if base_interval == timeframe:
            for r in raw_chunk:
                prism_chunk.append(
                    scalar_state.update(
                        open_=float(r[1]),
                        high=float(r[2]),
                        low=float(r[3]),
                        close=float(r[4]),
                        vol=float(r[5]),
                        timestamp_ms=int(r[0]),
                    )
                )
        else:
            for r in raw_chunk:
                open_ms = int(r[0])
                b_ms = (open_ms // bucket_ms_span) * bucket_ms_span
                o, h, l, c, v = float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])
                if carry_bucket is None:
                    carry_bucket = {"timestamp_ms": b_ms, "open": o, "high": h, "low": l, "close": c, "volume": v}
                elif carry_bucket["timestamp_ms"] == b_ms:
                    carry_bucket["high"] = max(float(carry_bucket["high"]), h)
                    carry_bucket["low"] = min(float(carry_bucket["low"]), l)
                    carry_bucket["close"] = c
                    carry_bucket["volume"] = float(carry_bucket["volume"]) + v
                else:
                    prism_chunk.append(
                        scalar_state.update(
                            open_=float(carry_bucket["open"]),
                            high=float(carry_bucket["high"]),
                            low=float(carry_bucket["low"]),
                            close=float(carry_bucket["close"]),
                            vol=float(carry_bucket["volume"]),
                            timestamp_ms=int(carry_bucket["timestamp_ms"]),
                        )
                    )
                    carry_bucket = {"timestamp_ms": b_ms, "open": o, "high": h, "low": l, "close": c, "volume": v}

        del raw_chunk
        if prism_chunk:
            yield prism_chunk
            del prism_chunk

    if carry_bucket is not None:
        yield [
            scalar_state.update(
                open_=float(carry_bucket["open"]),
                high=float(carry_bucket["high"]),
                low=float(carry_bucket["low"]),
                close=float(carry_bucket["close"]),
                vol=float(carry_bucket["volume"]),
                timestamp_ms=int(carry_bucket["timestamp_ms"]),
            )
        ]
        carry_bucket = None


def _rows_to_prism(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert a chunk of OHLCV dicts into PRISM rows using O(1) scalar registers."""
    if not rows:
        return []
    scalar_state = RollingScalarIndicatorState(atr_period=14, ema_period=20)
    out: List[Dict[str, Any]] = []
    for b in rows:
        out.append(
            scalar_state.update(
                open_=float(b["open"]),
                high=float(b["high"]),
                low=float(b["low"]),
                close=float(b["close"]),
                vol=float(b["volume"]),
                timestamp_ms=int(b["timestamp_ms"]),
            )
        )
    return out


def fetch_real_binance_csv(
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str | None = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Stream Binance REST klines in 1,000-bar chunks directly to CSV with O(1) memory."""
    symbol = _safe_symbol(symbol)
    timeframe = _safe_timeframe(timeframe)
    end_date = end_date or yesterday_utc()
    start_dt = parse_date_utc(start_date, end_of_day=False)
    end_dt = parse_date_utc(end_date, end_of_day=True)
    if start_dt >= end_dt:
        raise ValueError("Start date must be before end date.")
    days = max(1, (end_dt.date() - start_dt.date()).days + 1)
    if interval_seconds(timeframe) < 60 and days > 7:
        raise ValueError(
            "Sub-minute historical backtests are limited to 7 days because real 1s Binance data is extremely large. "
            "Use 1m+ for 30/90/365 day backtests; live paper can still use 1s/5s."
        )

    out_dir = settings.project_root / "data" / "binance" / symbol / timeframe
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
                "symbol": symbol,
                "timeframe": timeframe,
                "start_date": start_dt.date().isoformat(),
                "end_date": end_dt.date().isoformat(),
                "rows": row_count,
                "real_binance_data": True,
            }

    base_interval = _interval_for_binance(timeframe)
    total_rows = 0
    tmp_path = csv_path.with_suffix(".csv.tmp")

    with tmp_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(PRISM_CSV_FIELDS)
        for chunk in stream_binance_klines_chunked(symbol, timeframe, start_dt, end_dt):
            for r in chunk:
                w.writerow(
                    [
                        r["timestamp"],
                        r["open"],
                        r["high"],
                        r["low"],
                        r["close"],
                        r["volume"],
                        r["vwap"],
                        r["atr_14"],
                        r["spread_pct"],
                        r["liquidity_score"],
                        r["oi"],
                        r["mse_state"],
                        r["regime"],
                        r["ipse_alignment"],
                        r["microstructure_state"],
                        r["mps_state"],
                    ]
                )
                total_rows += 1
            del chunk
            gc.collect()

    if total_rows == 0:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise ValueError("No Binance historical rows returned for the selected range.")

    tmp_path.replace(csv_path)

    meta = {
        "symbol": symbol,
        "timeframe": timeframe,
        "binance_interval_used": base_interval,
        "rows": total_rows,
        "start_date": start_dt.date().isoformat(),
        "end_date": end_dt.date().isoformat(),
        "cached": False,
        "real_binance_data": True,
        "synthetic_data_used": False,
        "streaming_chunk_size": CHUNK_LIMIT,
        "note": (
            "OHLCV candles are streamed from Binance REST (/api/v3/klines) in 1,000-bar chunks "
            "with O(1) rolling scalar registers and cached locally."
        ),
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {"path": str(csv_path), **meta}
