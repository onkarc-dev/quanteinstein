"""Unified multi-asset market data service for Crypto (Binance) and Forex (Yahoo Finance)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.services.binance_historical import fetch_real_binance_csv, yesterday_utc
from app.services.forex_historical import (
    ALL_FOREX_PAIRS,
    FOREX_CROSS_PAIRS,
    FOREX_EXOTIC_PAIRS,
    FOREX_MAJOR_PAIRS,
    POPULAR_FOREX_PAIRS,
    fetch_live_forex_prices,
    fetch_real_forex_csv,
    fetch_recent_forex_candles,
    is_forex_symbol,
    normalize_forex_symbol,
)
from app.services.live_paper import POPULAR_SYMBOLS as POPULAR_CRYPTO_SYMBOLS
from app.services.live_paper import get_all_crypto_symbols, is_valid_crypto_symbol


def is_valid_market_symbol(symbol: str) -> bool:
    """Check if symbol is an authorized crypto pair or forex currency pair."""
    sym = str(symbol or "").strip().upper()
    if not sym:
        return False
    if is_forex_symbol(sym):
        return True
    return is_valid_crypto_symbol(sym)


def fetch_historical_market_csv(
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str | None = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Fetch/stream authentic market candles for either Crypto or Forex."""
    sym = str(symbol or "").strip().upper()
    if is_forex_symbol(sym):
        return fetch_real_forex_csv(sym, timeframe, start_date, end_date, force_refresh)
    return fetch_real_binance_csv(sym, timeframe, start_date, end_date, force_refresh)


def get_market_symbols_catalog() -> Dict[str, Any]:
    """Return categorized catalog of available crypto and forex pairs."""
    crypto = get_all_crypto_symbols()
    return {
        "all": list(dict.fromkeys(crypto + ALL_FOREX_PAIRS)),
        "crypto": crypto,
        "crypto_popular": list(POPULAR_CRYPTO_SYMBOLS),
        "forex": list(ALL_FOREX_PAIRS),
        "forex_majors": list(FOREX_MAJOR_PAIRS),
        "forex_crosses": list(FOREX_CROSS_PAIRS),
        "forex_exotics": list(FOREX_EXOTIC_PAIRS),
        "forex_popular": list(POPULAR_FOREX_PAIRS),
    }
