from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.deps import current_user
from app.core.order_router import order_router

router = APIRouter(prefix="/api/v1/execution", tags=["Institutional Execution"])


class ExecutionModeRequest(BaseModel):
    mode: str = Field(..., description="'SIMULATED' or 'LIVE_FIX'")


class PrimeBrokerSelectRequest(BaseModel):
    broker_id: str = Field(..., description="ID of Prime Broker (e.g. 'GS_GSET', 'B2C2_PRIME')")


class FixOrderRequest(BaseModel):
    symbol: str = Field("BTCUSDT", description="Trading asset symbol")
    side: str = Field("BUY", description="'BUY', 'SELL', or 'SHORT_SELL'")
    qty: Optional[float] = Field(None, description="Order quantity")
    order_type: str = Field("MARKET", description="'MARKET', 'LIMIT', 'ICEBERG', 'TWAP', or 'VWAP'")
    limit_price: Optional[float] = Field(None, description="Limit price if LIMIT order")
    reason: str = Field("MANUAL_ORDER", description="Execution rationale or strategy tag")
    mode: Optional[str] = Field(None, description="Optional override: 'SIMULATED', 'PAPER', or 'LIVE'")
    borrow_locate_id: Optional[str] = Field(None, description="SEC Reg SHO Rule 203(b)(1) Borrow Locate ID for short sales")
    asset_class: str = Field("EQUITY", description="'EQUITY', 'FUTURES', 'OPTIONS', 'FX', or 'CRYPTO'")
    display_qty: Optional[float] = Field(None, description="Iceberg visible peak quantity")
    algo_duration_sec: Optional[int] = Field(None, description="TWAP algorithm duration in seconds")
    algo_participation_rate: Optional[float] = Field(None, description="VWAP target participation rate (e.g. 0.15 for 15% ADV)")
    futures_roll_code: Optional[str] = Field(None, description="Futures roll contract schedule (e.g. 'ESZ26')")
    strike_price: Optional[float] = Field(None, description="Options strike price")
    put_or_call: Optional[int] = Field(None, description="0=None, 1=Call, 2=Put")
    option_expiry_date: Optional[int] = Field(None, description="Options expiration YYYYMMDD")


class FixCancelReplaceRequest(BaseModel):
    orig_cl_ord_id: str = Field(..., description="Original Client Order ID to replace")
    symbol: str = Field("BTCUSDT", description="Trading asset symbol")
    side: str = Field("BUY", description="'BUY' or 'SELL'")
    new_qty: float = Field(..., description="New order quantity")
    new_price: float = Field(..., description="New limit price")


@router.get("/status")
async def get_execution_status(user=Depends(current_user)):
    """
    Returns the current execution routing state, active Prime Broker, and live trading permissions.
    """
    return order_router.get_execution_status(user)


@router.post("/mode")
async def set_execution_mode(payload: ExecutionModeRequest, user=Depends(current_user)):
    """
    Toggles execution mode between 'SIMULATED' (Paper Simulator) and 'LIVE_FIX' (Prime Broker DMA).
    Restricted to Enterprise Tier users.
    """
    return order_router.set_execution_mode(user, payload.mode)


@router.post("/prime-broker")
async def select_prime_broker(payload: PrimeBrokerSelectRequest, user=Depends(current_user)):
    """
    Selects active Institutional Prime Broker for FIX 4.4 order routing.
    Restricted to Enterprise Tier users.
    """
    return order_router.update_prime_broker(user, payload.broker_id)


@router.post("/order")
async def execute_order(payload: FixOrderRequest, user=Depends(current_user)):
    """
    Unified high-concurrency asynchronous order submission endpoint.
    Protected by token-bucket rate limiting, SEC Reg SHO locate verification, and zero-copy C++ IPC.
    """
    return await order_router.route_order_async(
        user=user,
        symbol=payload.symbol,
        side=payload.side,
        qty=payload.qty,
        order_type=payload.order_type,
        limit_price=payload.limit_price,
        reason=payload.reason,
        mode=payload.mode,
        borrow_locate_id=payload.borrow_locate_id,
        asset_class=payload.asset_class,
        display_qty=payload.display_qty,
        algo_duration_sec=payload.algo_duration_sec,
        algo_participation_rate=payload.algo_participation_rate,
        futures_roll_code=payload.futures_roll_code,
        strike_price=payload.strike_price,
        put_or_call=payload.put_or_call,
        option_expiry_date=payload.option_expiry_date,
    )


@router.post("/cancel-replace")
async def cancel_replace_order(payload: FixCancelReplaceRequest, user=Depends(current_user)):
    """
    Tag 35=G: Order Cancel / Replace Request.
    Restricted strictly to Enterprise Tier users.
    """
    return order_router.cancel_replace_order(
        user=user,
        orig_cl_ord_id=payload.orig_cl_ord_id,
        symbol=payload.symbol,
        side=payload.side,
        new_qty=payload.new_qty,
        new_price=payload.new_price,
    )


@router.get("/audit-trail")
async def get_fix_audit_trail(limit: int = 50, user=Depends(current_user)):
    """
    Retrieves immutable FIX protocol audit trail logs for regulatory and SOC 2 compliance.
    """
    return {
        "ok": True,
        "audit_logs": order_router.get_audit_trail(user, limit=limit),
    }
