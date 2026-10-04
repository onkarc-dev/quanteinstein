import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
os.environ.setdefault("PRISMFLOW_SECRET_KEY", "unit-test-secret-key-with-enough-length")

from app.db import init_db
from app.services import live_paper
from app.services.live_paper import LivePaperManager, LivePaperSession


def setup_module(module):
    init_db()


def test_manual_execute_order_and_close_position(monkeypatch):
    monkeypatch.setattr(live_paper, "_fetch_market_prices", lambda max_age=2.0: {"BTCUSDT": 85000.0})
    manager = LivePaperManager()
    session = LivePaperSession(user_id="test-manual-exec", session_id="test-session-1", status="running", starting_balance=100000.0)
    session.symbol_states["BTCUSDT"] = {"symbol": "BTCUSDT", "last_price": 85000.0, "processed": 10}
    manager._sessions["test-manual-exec"] = session

    # 1. Manual Market BUY
    buy_res = manager.execute_order("test-manual-exec", "BTCUSDT", side="BUY")
    assert buy_res["ok"] is True
    assert buy_res["side"] == "BUY"
    assert buy_res["fill"] == 85000.0
    assert buy_res["qty"] > 0

    st = manager.status("test-manual-exec")
    positions = st["open_positions_detail"]
    assert len(positions) == 1
    assert positions[0]["symbol"] == "BTCUSDT"
    assert positions[0]["side"] == "BUY"
    assert positions[0]["entry_price"] == 85000.0
    assert positions[0]["stop"] < 85000.0
    assert positions[0]["target1"] > 85000.0

    # 2. Cannot open duplicate position on same symbol
    dup_res = manager.execute_order("test-manual-exec", "BTCUSDT", side="BUY")
    assert dup_res["ok"] is False

    # 3. Manual Close Position
    close_res = manager.close_position("test-manual-exec", "BTCUSDT", reason="MANUAL_CLOSE")
    assert close_res["ok"] is True
    assert "PAPER_SELL_FILL" in close_res["event"]

    st_after = manager.status("test-manual-exec")
    assert len(st_after["open_positions_detail"]) == 0
    assert len(st_after["events"]) >= 2
    assert st_after["events"][-1]["event_type"] == "PAPER_SELL_FILL"


def test_manual_execute_short_order_and_close(monkeypatch):
    monkeypatch.setattr(live_paper, "_fetch_market_prices", lambda max_age=2.0: {"ETHUSDT": 2700.0})
    manager = LivePaperManager()
    session = LivePaperSession(user_id="test-short-exec", session_id="test-session-2", status="running", starting_balance=100000.0)
    session.symbol_states["ETHUSDT"] = {"symbol": "ETHUSDT", "last_price": 2700.0, "processed": 10}
    manager._sessions["test-short-exec"] = session

    # 1. Manual Market SELL (Short)
    short_res = manager.execute_order("test-short-exec", "ETHUSDT", side="SELL")
    assert short_res["ok"] is True
    assert short_res["side"] == "SELL"
    assert short_res["fill"] == 2700.0

    st = manager.status("test-short-exec")
    positions = st["open_positions_detail"]
    assert len(positions) == 1
    assert positions[0]["symbol"] == "ETHUSDT"
    assert positions[0]["side"] == "SELL"
    # For a short, stop loss must be above entry and targets below entry
    assert positions[0]["stop"] > 2700.0
    assert positions[0]["target1"] < 2700.0
    assert positions[0]["target2"] < positions[0]["target1"]

    # 2. Close Short Position
    close_res = manager.close_position("test-short-exec", "ETHUSDT")
    assert close_res["ok"] is True
    assert "side=SELL" in close_res["event"]

    st_after = manager.status("test-short-exec")
    assert len(st_after["open_positions_detail"]) == 0
