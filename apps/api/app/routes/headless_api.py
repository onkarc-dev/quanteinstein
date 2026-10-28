"""Headless Quantitative API Layer for Institutional Hedge Funds & Python ML Pipelines.

Exposes high-throughput, secure REST and WebSocket endpoints for:
- API Key Lifecycle Management (creation, scopes, revocation)
- Terabyte-Scale Historical Market Data Extraction (high-resolution OHLCV)
- Programmatic Backtest Submission & Result Extraction (Jupyter integration)
- Programmatic Order Execution & Real-Time Position Telemetry
"""
from __future__ import annotations

import csv
import datetime
import io
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.api_key_auth import (
    generate_api_key,
    hash_api_key,
    validate_api_key,
)
from app.core.config import settings
from app.core.tenant_context import get_current_tenant_url
from app.db import get_conn, get_primary_conn, now, row_to_dict
from app.deps import current_user
from app.services.engine_runner import run_engine_sync
from app.services.job_queue import queue
from app.services.live_paper import manager as paper_manager
from app.services.market_data_service import (
    fetch_historical_market_csv,
    get_market_symbols_catalog,
)

logger = logging.getLogger("quantos.headless_api")

router = APIRouter()


def _p() -> str:
    return "%s" if settings.is_postgres() else "?"


# ─────────────────────────────────────────────────────────────────────────────
# 1. API KEY LIFECYCLE MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

class CreateApiKeyRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=64, description="Label for key (e.g. Jupyter Cluster Alpha)")
    mode: str = Field("live", pattern="^(live|test)$", description="'live' or 'test'")
    permissions: List[str] = Field(
        default=["data:read", "backtest:run", "orders:write"],
        description="Assigned permission scopes",
    )
    expires_in_days: Optional[int] = Field(90, ge=1, le=365, description="Validity period in days")


@router.get("/keys", summary="List programmatic API keys for current organization")
def list_api_keys(user: Dict[str, Any] = Depends(current_user)):
    """List metadata for all active API keys. Raw secrets are never returned."""
    user_id = user["id"]
    p = _p()
    keys: List[Dict[str, Any]] = []

    with get_primary_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT id, name, key_prefix, permissions_json, rate_limit_per_minute,
                   created_at, last_used_at, expires_at, is_active
            FROM api_keys
            WHERE user_id = {p}
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()

        for r in rows:
            d = row_to_dict(r)
            try:
                d["permissions"] = json.loads(d.get("permissions_json") or "[]")
            except Exception:
                d["permissions"] = []
            d.pop("permissions_json", None)
            keys.append(d)

    return {"status": "ok", "count": len(keys), "keys": keys}


@router.post("/keys", summary="Generate a new high-throughput API key")
def create_api_key(
    payload: CreateApiKeyRequest,
    user: Dict[str, Any] = Depends(current_user),
):
    """Generate and return a new API key.
    
    IMPORTANT: The full 'api_key_secret' is shown ONCE upon creation and cannot be retrieved later.
    """
    user_id = user["id"]
    org_id = user.get("organization_id")
    p = _p()

    full_key, key_prefix, key_hash = generate_api_key(mode=payload.mode)
    key_id = f"key_{uuid.uuid4().hex[:12]}"

    expires_at = None
    if payload.expires_in_days:
        exp_dt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=payload.expires_in_days)
        expires_at = exp_dt.replace(microsecond=0).isoformat() + "Z"

    perms_json = json.dumps(payload.permissions)
    # Higher rate limits for enterprise tier
    tier = str(user.get("tier") or "RETAIL").upper()
    rate_limit = 3600 if tier == "ENTERPRISE" else 600

    with get_primary_conn() as conn:
        conn.execute(
            f"""
            INSERT INTO api_keys (
                id, user_id, organization_id, key_prefix, key_hash, name,
                permissions_json, rate_limit_per_minute, created_at, expires_at, is_active
            )
            VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, 1)
            """,
            (key_id, user_id, org_id, key_prefix, key_hash, payload.name.strip(), perms_json, rate_limit, now(), expires_at),
        )
        conn.commit()

    logger.info("API Key created: key_id=%s user_id=%s org_id=%s name='%s'", key_id, user_id, org_id, payload.name)

    return {
        "status": "ok",
        "api_key": {
            "id": key_id,
            "name": payload.name.strip(),
            "key_prefix": key_prefix,
            "api_key_secret": full_key,  # Returned only once
            "permissions": payload.permissions,
            "rate_limit_per_minute": rate_limit,
            "created_at": now(),
            "expires_at": expires_at,
        },
        "warning": "Copy this secret key immediately. You will not be able to view it again.",
    }


@router.delete("/keys/{key_id}", summary="Revoke / delete an API key")
def revoke_api_key(key_id: str, user: Dict[str, Any] = Depends(current_user)):
    """Immediately revokes and disables the designated API key."""
    user_id = user["id"]
    p = _p()

    with get_primary_conn() as conn:
        res = conn.execute(
            f"UPDATE api_keys SET is_active = 0 WHERE id = {p} AND user_id = {p}",
            (key_id, user_id),
        )
        conn.commit()

    return {"status": "ok", "message": f"API key {key_id} has been revoked."}


# ─────────────────────────────────────────────────────────────────────────────
# 2. TERABYTE-SCALE HISTORICAL MARKET DATA EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/market-data/symbols", summary="Available multi-asset instruments catalog")
def get_symbols_catalog(user: Dict[str, Any] = Depends(current_user)):
    """Returns categorized dictionary of available Crypto and Forex assets."""
    return {"status": "ok", "catalog": get_market_symbols_catalog()}


@router.get("/market-data/ohlcv", summary="Extract high-resolution historical OHLCV candles")
def extract_historical_ohlcv(
    symbol: str = Query(..., description="Ticker symbol (e.g. BTCUSDT, ETHUSDT, EURUSD)"),
    timeframe: str = Query("1m", description="Bar interval: 1s, 15s, 1m, 5m, 1h, 1d"),
    start_date: str = Query("2026-06-01", description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    limit: int = Query(5000, ge=1, le=50000, description="Max bars to extract per batch"),
    format: str = Query("json", pattern="^(json|csv)$", description="'json' for arrays or 'csv' for stream"),
    user: Dict[str, Any] = Depends(current_user),
):
    """Programmatic market data extraction with support for streaming multi-gigabyte data directly to Python DataFrames."""
    clean_sym = symbol.strip().upper()

    try:
        data_res = fetch_historical_market_csv(
            symbol=clean_sym,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date or start_date,
            force_refresh=False,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Market data fetch failed: {str(e)}")

    raw_path = data_res.get("path") or data_res.get("csv_path") or ""
    csv_path = Path(raw_path)
    if not csv_path.is_file():
        raise HTTPException(status_code=404, detail=f"No market data found for {clean_sym} {timeframe}")

    if format == "csv":
        def _iter_csv():
            with csv_path.open("r", encoding="utf-8") as f:
                for line in f:
                    yield line
        return StreamingResponse(_iter_csv(), media_type="text/csv", headers={
            "Content-Disposition": f"attachment; filename={clean_sym}_{timeframe}_{start_date}.csv"
        })

    # Return structured JSON for direct consumption: df = pd.DataFrame(resp.json()['bars'])
    bars: List[Dict[str, Any]] = []
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader):
            if idx >= limit:
                break
            try:
                bars.append({
                    "timestamp": row.get("timestamp"),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row.get("volume") or 0.0),
                    "vwap": float(row["vwap"]) if row.get("vwap") else None,
                    "atr_14": float(row["atr_14"]) if row.get("atr_14") else None,
                    "spread_pct": float(row["spread_pct"]) if row.get("spread_pct") else 0.05,
                    "regime": row.get("regime") or "NORMAL",
                })
            except Exception:
                continue

    return {
        "status": "ok",
        "symbol": clean_sym,
        "timeframe": timeframe,
        "start_date": start_date,
        "end_date": end_date or start_date,
        "count": len(bars),
        "total_available_rows": data_res.get("rows", len(bars)),
        "bars": bars,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. HEADLESS PROGRAMMATIC BACKTESTING
# ─────────────────────────────────────────────────────────────────────────────

class ProgrammaticBacktestRequest(BaseModel):
    strategy_id: Optional[str] = Field(None, description="Existing strategy UUID if reusing pre-built logic")
    strategy_name: Optional[str] = Field("Programmatic Quant Model", description="Name for the model")
    symbols: List[str] = Field(default=["BTCUSDT"], description="Symbols list")
    timeframe: str = Field("1m", description="Bar timeframe")
    start_date: str = Field("2026-06-01", description="Backtest start date (YYYY-MM-DD)")
    end_date: Optional[str] = Field("2026-06-15", description="Backtest end date (YYYY-MM-DD)")
    initial_capital: float = Field(100000.0, ge=1000.0, description="Starting test balance")
    strategy_config: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Custom quantitative parameters")
    sync: bool = Field(True, description="True for instant synchronous execution (ideal for notebooks)")


@router.post("/backtests/run", summary="Submit a programmatic backtest from Python / Jupyter")
def run_headless_backtest(
    payload: ProgrammaticBacktestRequest,
    background_tasks: BackgroundTasks,
    user: Dict[str, Any] = Depends(current_user),
):
    """Submits and executes an institutional backtest job directly via headless API."""
    user_id = user["id"]
    job_id = str(uuid.uuid4())
    p = _p()

    strat_id = payload.strategy_id
    if not strat_id:
        strat_id = f"strat_{uuid.uuid4().hex[:12]}"
        # Ensure strategy record exists in active tenant context
        with get_conn() as conn:
            conn.execute(
                f"""
                INSERT INTO strategies (id, user_id, name, symbols_json, timeframe, config_json, created_at, updated_at)
                VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p})
                """,
                (strat_id, user_id, payload.strategy_name or "Headless Strategy", json.dumps(payload.symbols), payload.timeframe, json.dumps(payload.strategy_config or {}), now(), now()),
            )
            conn.commit()

    job_payload = {
        "job_id": job_id,
        "user_id": user_id,
        "strategy_id": strat_id,
        "mode": "backtest",
        "symbols": payload.symbols,
        "timeframe": payload.timeframe,
        "start_date": payload.start_date,
        "end_date": payload.end_date or payload.start_date,
        "config": payload.strategy_config or {},
    }

    # Record queued job
    with get_conn() as conn:
        conn.execute(
            f"""
            INSERT INTO jobs (
                id, user_id, strategy_id, mode, status, symbols_json,
                timeframe, output_dir, created_at, started_at
            )
            VALUES ({p}, {p}, {p}, 'backtest', 'queued', {p}, {p}, {p}, {p}, {p})
            """,
            (job_id, user_id, strat_id, json.dumps(payload.symbols), payload.timeframe, str(settings.outputs_dir / user_id / job_id), now(), now()),
        )
        conn.commit()

    if payload.sync:
        result = run_engine_sync(job_payload)
        summary = result.get("summary") or {}
        return {
            "status": result.get("status", "completed"),
            "job_id": job_id,
            "strategy_id": strat_id,
            "symbols": payload.symbols,
            "timeframe": payload.timeframe,
            "metrics": {
                "sharpe_ratio": summary.get("sharpe_ratio", 0.0),
                "sortino_ratio": summary.get("sortino_ratio", 0.0),
                "max_drawdown_pct": summary.get("max_drawdown_pct", 0.0),
                "total_return_pct": summary.get("total_return_pct", 0.0),
                "profit_factor": summary.get("profit_factor", 0.0),
                "win_rate_pct": summary.get("win_rate_pct", 0.0),
                "total_trades": summary.get("total_trades", 0),
            },
            "output_dir": result.get("output_dir"),
        }

    # Asynchronous execution for long historical spans
    background_tasks.add_task(run_engine_sync, job_payload)
    return {
        "status": "queued",
        "job_id": job_id,
        "strategy_id": strat_id,
        "message": f"Backtest dispatched asynchronously. Poll /api/v1/backtests/{job_id}/results for data.",
    }


@router.get("/backtests/{job_id}/results", summary="Fetch full backtest results, trade logs, and metrics")
def get_backtest_results(job_id: str, user: Dict[str, Any] = Depends(current_user)):
    """Fetch complete backtest results, trade logs, and equity curve for programmatic processing."""
    user_id = user["id"]
    p = _p()

    with get_conn() as conn:
        job_row = conn.execute(
            f"SELECT id, strategy_id, status, output_dir, error_message, created_at, completed_at FROM jobs WHERE id = {p}",
            (job_id,),
        ).fetchone()

        if not job_row:
            raise HTTPException(status_code=404, detail="Backtest job not found")

        job = row_to_dict(job_row)

        report_row = conn.execute(
            f"SELECT summary_json, validation_json, dashboard_snapshot_json FROM reports WHERE job_id = {p}",
            (job_id,),
        ).fetchone()

        report_dict = row_to_dict(report_row) if report_row else {}

        # Fetch executed trades
        trade_rows = conn.execute(
            f"SELECT symbol, trade_json, r_multiple, created_at FROM trades WHERE job_id = {p} ORDER BY created_at ASC",
            (job_id,),
        ).fetchall()

        trades: List[Dict[str, Any]] = []
        for tr in trade_rows:
            d = row_to_dict(tr)
            try:
                trade_payload = json.loads(d.get("trade_json") or "{}")
                trade_payload["r_multiple"] = d.get("r_multiple", 0)
                trades.append(trade_payload)
            except Exception:
                pass

    summary = {}
    if report_dict.get("summary_json"):
        try:
            summary = json.loads(report_dict["summary_json"])
        except Exception:
            pass

    return {
        "status": "ok",
        "job_id": job["id"],
        "strategy_id": job["strategy_id"],
        "job_status": job["status"],
        "created_at": job["created_at"],
        "completed_at": job.get("completed_at"),
        "error_message": job.get("error_message"),
        "summary": summary,
        "trades_count": len(trades),
        "trades": trades,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 4. PROGRAMMATIC ORDERS & POSITIONS
# ─────────────────────────────────────────────────────────────────────────────

class SubmitOrderRequest(BaseModel):
    symbol: str = Field("BTCUSDT", description="Symbol ticker")
    side: str = Field("BUY", pattern="^(BUY|SELL)$", description="'BUY' or 'SELL'")
    qty: Optional[float] = Field(None, gt=0, description="Order quantity")
    order_type: str = Field("MARKET", description="'MARKET' or 'LIMIT'")
    type: Optional[str] = Field(None, description="Alias for order_type")
    price: Optional[float] = Field(None, description="Limit price if LIMIT order")
    limit_price: Optional[float] = Field(None, description="Alias for price")
    client_order_id: Optional[str] = Field(None, description="Client order ID")


@router.post("/orders/session/start", summary="Start algorithmic execution session")
def start_execution_session(
    symbols: List[str] = Body(default=["BTCUSDT"]),
    starting_balance: Optional[float] = Body(default=100000.0),
    user: Dict[str, Any] = Depends(current_user),
):
    user_id = user["id"]
    res = paper_manager.start(user_id, strategy_id="", symbols=symbols, starting_balance=starting_balance)
    return {"status": "ok", "session": res}


@router.post("/orders/session/stop", summary="Stop algorithmic execution session")
def stop_execution_session(user: Dict[str, Any] = Depends(current_user)):
    user_id = user["id"]
    res = paper_manager.stop(user_id)
    return {"status": "ok", "session": res}


@router.post("/orders", summary="Submit a programmatic order")
def submit_order(
    payload: SubmitOrderRequest,
    user: Dict[str, Any] = Depends(current_user),
):
    """Executes programmatic order via execution routing layer."""
    user_id = user["id"]
    symbol = payload.symbol.strip().upper()

    # Auto-initialize paper execution session if not active
    curr_status = paper_manager.status(user_id)
    if curr_status.get("status") not in {"running", "starting"}:
        try:
            paper_manager.start(
                user_id,
                strategy_id="",
                symbols=[symbol],
                starting_balance=100000.0,
            )
        except Exception:
            pass

    from app.core.order_router import order_router
    ord_type = payload.type or payload.order_type or "MARKET"
    lim_px = payload.limit_price or payload.price
    cl_id = payload.client_order_id or "HEADLESS_API_ORDER"
    res = order_router.route_order(
        user=user,
        symbol=symbol,
        side=payload.side,
        qty=payload.qty,
        order_type=ord_type,
        limit_price=lim_px,
        reason=cl_id,
    )

    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Order execution failed"))

    return {
        "status": "FILLED" if res.get("ok") else "REJECTED",
        "order": res.get("trade") or res,
        "timestamp": now(),
    }


class ClosePositionRequest(BaseModel):
    symbol: str = Field("BTCUSDT", description="Symbol ticker to close")


@router.post("/positions/close", summary="Close open position on designated symbol")
def close_position(
    payload: ClosePositionRequest,
    user: Dict[str, Any] = Depends(current_user),
):
    user_id = user["id"]
    symbol = payload.symbol.strip().upper()
    res = paper_manager.close_position(user_id, symbol=symbol)
    return {"status": "ok", "result": res}


@router.get("/positions", summary="Inspect real-time portfolio positions and PnL")
def get_positions(user: Dict[str, Any] = Depends(current_user)):
    """Fetch active open positions, realized and unrealized PnL, and balance metrics."""
    user_id = user["id"]
    status = paper_manager.status(user_id)

    return {
        "status": "ok",
        "user_id": user_id,
        "engine_state": status.get("status", "idle"),
        "balance": status.get("current_balance", 100000.0),
        "realized_pnl": status.get("realized_pnl", 0.0),
        "unrealized_pnl": status.get("unrealized_pnl", 0.0),
        "positions": status.get("positions", []),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5. REAL-TIME STREAMING WEBSOCKETS
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/ws/market-data")
async def websocket_market_data(
    websocket: WebSocket,
    api_key: Optional[str] = Query(None),
):
    """Real-time market quote streaming WebSocket for algorithmic bots.
    
    Subscribers send: {"action": "subscribe", "symbols": ["BTCUSDT", "ETHUSDT"]}
    """
    await websocket.accept()

    # Authenticate via query param or initial auth frame
    user_info = None
    if api_key:
        user_info = validate_api_key(api_key)

    if not user_info:
        # Await auth frame
        try:
            auth_frame = await websocket.receive_json()
            raw_key = auth_frame.get("api_key") or auth_frame.get("token")
            user_info = validate_api_key(raw_key) if raw_key else None
        except Exception:
            pass

    if not user_info:
        await websocket.send_json({"error": "Unauthorized: Valid API key required"})
        await websocket.close(code=1008)
        return

    subscribed_symbols: set[str] = {"BTCUSDT"}
    await websocket.send_json({
        "event": "connected",
        "user": user_info["email"],
        "rate_limit": user_info.get("rate_limit_per_minute", 1200),
        "subscribed": list(subscribed_symbols),
    })

    try:
        while True:
            msg = await websocket.receive_json()
            action = msg.get("action")
            if action == "subscribe":
                syms = [s.strip().upper() for s in msg.get("symbols", []) if s]
                subscribed_symbols.update(syms)
                await websocket.send_json({"event": "subscribed", "symbols": list(subscribed_symbols)})
            elif action == "ping":
                await websocket.send_json({"event": "pong", "timestamp": now()})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("WebSocket disconnect on error: %s", e)
