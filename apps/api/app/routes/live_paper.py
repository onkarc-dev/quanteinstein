import time
from pathlib import Path
from fastapi import APIRouter, Depends, Body, HTTPException

from app.core.config import settings
from app.deps import current_user
from app.services.data_manager import validate_market_csv
from app.services.live_paper import manager, validate_live_start_request
from app.services import live_paper_perf as _live_paper_perf

_live_paper_perf.install_live_paper_wallet_throttle(manager)

router = APIRouter()

_STATUS_CACHE: dict[str, tuple[float, dict]] = {}
_RUNNING_STATUS_TTL_SECONDS = 1.0
_IDLE_STATUS_TTL_SECONDS = 5.0


def _cached_status(user_id: str) -> dict:
    now_ts = time.time()
    cached = _STATUS_CACHE.get(user_id)
    if cached:
        cached_ts, cached_status = cached
        ttl = _RUNNING_STATUS_TTL_SECONDS if cached_status.get('status') in {'running', 'starting'} else _IDLE_STATUS_TTL_SECONDS
        if now_ts - cached_ts < ttl:
            return cached_status
    status = manager.status(user_id)
    _STATUS_CACHE[user_id] = (now_ts, status)
    return status


def _invalidate_status_cache(user_id: str) -> None:
    _STATUS_CACHE.pop(user_id, None)


def _safe_data_path(input_data: str) -> Path:
    p = Path(input_data)
    if not p.is_absolute():
        resolved = (settings.project_root / p).resolve()
    else:
        resolved = p.resolve()
    allowed_dirs = [
        (settings.project_root / "data").resolve(),
        settings.outputs_dir.resolve(),
    ]
    if not any(resolved == d or d in resolved.parents for d in allowed_dirs):
        raise HTTPException(
            status_code=403,
            detail="Access denied: file path must be within authorized data or outputs directories.",
        )
    return resolved


@router.post('/start')
def start_live_paper(payload: dict = Body(default={}), user=Depends(current_user)):
    payload = payload or {}
    user_id = str(user['id'])
    strategy_id = str(payload.get('strategy_id') or '')
    symbols = payload.get('symbols') or []
    if isinstance(symbols, str):
        symbols = [symbols]
    guard = validate_live_start_request(user_id, strategy_id=strategy_id, symbols=symbols)
    if not guard.get("ok"):
        raise HTTPException(status_code=int(guard.get("status_code") or 422), detail=guard["message"])
    _invalidate_status_cache(user_id)
    result = manager.start(user_id, strategy_id=strategy_id, symbols=symbols)
    _STATUS_CACHE[user_id] = (time.time(), result)
    return result


@router.post('/stop')
def stop_live_paper(user=Depends(current_user)):
    user_id = str(user['id'])
    _invalidate_status_cache(user_id)
    result = manager.stop(user_id)
    _STATUS_CACHE[user_id] = (time.time(), result)
    return result


@router.get('/status')
def status_live_paper(user=Depends(current_user)):
    return _cached_status(str(user['id']))


@router.get('/trades')
def trades_live_paper(user=Depends(current_user)):
    status = _cached_status(str(user['id']))
    return {
        'status': status.get('status', 'idle'),
        'session_id': status.get('session_id', ''),
        'events': status.get('events', []),
    }


@router.get('/wallet')
def wallet_live_paper(user=Depends(current_user)):
    status = _cached_status(str(user['id']))
    return status.get('wallet') or {
        'user_id': str(user['id']),
        'starting_balance': 100000.0,
        'current_balance': 100000.0,
        'account_equity': 100000.0,
        'cash_balance': 100000.0,
        'realized_pnl': 0.0,
        'unrealized_pnl': 0.0,
        'locked_until': '',
    }


@router.get('/candles')
def get_live_candles(symbol: str = "BTCUSDT", interval: str = "1m", limit: int = 100):
    from app.services.live_paper import fetch_recent_candles, SUPPORTED_SYMBOLS
    sym = symbol.strip().upper()
    if sym not in SUPPORTED_SYMBOLS:
        sym = "BTCUSDT"
    candles = fetch_recent_candles(sym, interval=interval, limit=limit)
    return {"symbol": sym, "interval": interval, "candles": candles}


@router.get('/replay')
def replay(input_data: str = 'data/sample_market_data.csv', max_rows: int = 250, user=Depends(current_user)):
    p = _safe_data_path(input_data)
    validation = validate_market_csv(p)
    return {
        'mode': 'csv-replay-validation-only',
        'input_data': str(p),
        'max_rows': max(30, min(max_rows, 5000)),
        'validation': validation,
        'message': 'CSV replay engine is not available in the live paper service container.',
    }


@router.get('/validate-data')
def validate_data(input_data: str = 'data/sample_market_data.csv', user=Depends(current_user)):
    p = _safe_data_path(input_data)
    return validate_market_csv(p)
