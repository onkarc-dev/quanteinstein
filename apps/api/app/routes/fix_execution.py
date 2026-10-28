from typing import Optional
from fastapi import APIRouter, Depends, Body, HTTPException
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
    side: str = Field("BUY", description="'BUY' or 'SELL'")
    qty: Optional[float] = Field(None, description="Order quantity")
    order_type: str = Field("MARKET", description="'MARKET' or 'LIMIT'")
    limit_price: Optional[float] = Field(None, description="Limit price if LIMIT order")
    reason: str = Field("MANUAL_ORDER", description="Execution rationale or strategy tag")
    mode: Optional[str] = Field(None, description="Optional override: 'SIMULATED', 'PAPER', or 'LIVE'")


@router.get("/status")
def get_execution_status(user=Depends(current_user)):
    """
    Returns the current execution routing state, active Prime Broker, and live trading permissions.
    """
    return order_router.get_execution_status(user)


@router.post("/mode")
def set_execution_mode(payload: ExecutionModeRequest, user=Depends(current_user)):
    """
    Toggles execution mode between 'SIMULATED' (Paper Simulator) and 'LIVE_FIX' (Prime Broker DMA).
    Restricted to Enterprise Tier users.
    """
    return order_router.set_execution_mode(user, payload.mode)


@router.post("/prime-broker")
def select_prime_broker(payload: PrimeBrokerSelectRequest, user=Depends(current_user)):
    """
    Selects active Institutional Prime Broker for FIX 4.4 order routing.
    Restricted to Enterprise Tier users.
    """
    return order_router.update_prime_broker(user, payload.broker_id)


@router.post("/order")
def execute_order(payload: FixOrderRequest, user=Depends(current_user)):
    """
    Unified high-concurrency order submission endpoint.
    Routes to simulator for retail accounts, or directly to prime broker FIX for authorized enterprise accounts.
    """
    return order_router.route_order(
        user=user,
        symbol=payload.symbol,
        side=payload.side,
        qty=payload.qty,
        order_type=payload.order_type,
        limit_price=payload.limit_price,
        reason=payload.reason,
        mode=payload.mode,
    )


@router.get("/audit-trail")
def get_fix_audit_trail(limit: int = 50, user=Depends(current_user)):
    """
    Retrieves immutable FIX protocol audit trail logs for regulatory and SOC 2 compliance.
    """
    return {
        "ok": True,
        "audit_logs": order_router.get_audit_trail(user, limit=limit),
    }
