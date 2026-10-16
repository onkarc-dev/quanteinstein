import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
os.environ.setdefault("PRISMFLOW_SECRET_KEY", "unit-test-secret-key-with-enough-length")

from app.services.market_data_service import (
    is_valid_market_symbol,
    get_market_symbols_catalog,
    fetch_historical_market_csv,
)
from app.services.forex_historical import (
    is_forex_symbol,
    ALL_FOREX_PAIRS,
    FOREX_MAJOR_PAIRS,
    FOREX_CROSS_PAIRS,
    FOREX_EXOTIC_PAIRS,
    fetch_live_forex_prices,
    fetch_recent_forex_candles,
)


def test_market_symbol_validation():
    # Forex validation
    assert is_forex_symbol("EURUSD") is True
    assert is_forex_symbol("GBPUSD") is True
    assert is_forex_symbol("USDJPY") is True
    assert is_forex_symbol("USDINR") is True
    assert is_forex_symbol("EUR/USD") is True

    # Crypto validation
    assert is_forex_symbol("BTCUSDT") is False
    assert is_valid_market_symbol("BTCUSDT") is True
    assert is_valid_market_symbol("EURUSD") is True
    assert is_valid_market_symbol("EUR/USD") is True


def test_market_symbols_catalog():
    catalog = get_market_symbols_catalog()
    assert "crypto" in catalog
    assert "forex" in catalog
    assert "forex_majors" in catalog
    assert "all" in catalog
    assert "EURUSD" in catalog["forex"]
    assert "BTCUSDT" in catalog["crypto_popular"]


def test_forex_live_prices_mocked(monkeypatch):
    import json
    class MockResp:
        def read(self):
            return json.dumps({
                "chart": {"result": [{"meta": {"regularMarketPrice": 1.0850}}]}
            }).encode("utf-8")
        def __enter__(self): return self
        def __exit__(self, *args): pass

    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=4: MockResp())
    prices = fetch_live_forex_prices(["EURUSD", "GBPUSD"], max_age=0.0)
    assert prices["EURUSD"] == 1.0850


def test_forex_historical_csv_generation(tmp_path, monkeypatch):
    import json
    class MockChartResp:
        def read(self):
            timestamps = [1700000000 + i * 3600 for i in range(15)]
            return json.dumps({
                "chart": {
                    "result": [{
                        "timestamp": timestamps,
                        "indicators": {
                            "quote": [{
                                "open": [1.0800 + i * 0.001 for i in range(15)],
                                "high": [1.0820 + i * 0.001 for i in range(15)],
                                "low": [1.0790 + i * 0.001 for i in range(15)],
                                "close": [1.0810 + i * 0.001 for i in range(15)],
                                "volume": [1000 + i * 10 for i in range(15)],
                            }]
                        }
                    }]
                }
            }).encode("utf-8")
        def __enter__(self): return self
        def __exit__(self, *args): pass

    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=12: MockChartResp())
    from app.core.config import settings
    monkeypatch.setattr(settings, "project_root", tmp_path)

    res = fetch_historical_market_csv("EURUSD", "1h", "2024-01-01", "2024-01-02", force_refresh=True)
    csv_path = Path(res["path"])
    assert csv_path.exists()

    with open(csv_path, "r", encoding="utf-8") as f:
        header = f.readline().strip().split(",")
        assert "timestamp" in header
        assert "close" in header
        assert "volume" in header
        assert "vwap" in header
        assert "atr_14" in header
        lines = f.readlines()
        assert len(lines) == 15
