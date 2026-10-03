import json, uuid, re
from fastapi import APIRouter, Depends, HTTPException
from app.schemas.prism import StrategyCreate
from app.deps import current_user
from app.db import get_conn, now
from app.core.config import settings

router = APIRouter()


def _p() -> str:
    return "%s" if settings.is_postgres() else "?"


def _clean_user_strategy_id(value: str | None, fallback: str) -> str:
    raw = (value or '').strip()
    if not raw:
        raw = fallback
    cleaned = re.sub(r'[^A-Za-z0-9_-]+', '_', raw).strip('_')
    return cleaned[:48] or fallback

@router.post("")
def create_strategy(strategy: StrategyCreate, user=Depends(current_user)):
    sid = str(uuid.uuid4())
    data = strategy.model_dump()
    data["user_strategy_id"] = _clean_user_strategy_id(data.get("user_strategy_id"), f"STRAT-{sid[:8]}")
    p = _p()
    with get_conn() as conn:
        existing = conn.execute(f"SELECT id, config_json FROM strategies WHERE user_id={p}", (user["id"],)).fetchall()
        for row in existing:
            try:
                cfg = json.loads(row["config_json"] if hasattr(row, "keys") else row[1])
            except Exception:
                cfg = {}
            if _clean_user_strategy_id(cfg.get("user_strategy_id") or cfg.get("strategy_id"), "") == data["user_strategy_id"]:
                existing_id = row["id"] if hasattr(row, "keys") else row[0]
                conn.execute(
                    f"UPDATE strategies SET name={p}, symbols_json={p}, timeframe={p}, config_json={p}, updated_at={p} WHERE id={p} AND user_id={p}",
                    (strategy.name, json.dumps(strategy.symbols), strategy.timeframe, json.dumps(data), now(), existing_id, user["id"])
                )
                conn.commit()
                return {"id": existing_id, "strategy_id": existing_id, "user_strategy_id": data.get("user_strategy_id"), "user_id": user["id"], **data}
        conn.execute(
            f"INSERT INTO strategies(id,user_id,name,symbols_json,timeframe,config_json,created_at,updated_at) VALUES({p},{p},{p},{p},{p},{p},{p},{p})",
            (sid, user["id"], strategy.name, json.dumps(strategy.symbols), strategy.timeframe, json.dumps(data), now(), now())
        )
        conn.commit()
    return {"id": sid, "strategy_id": sid, "user_strategy_id": data.get("user_strategy_id"), "user_id": user["id"], **data}

@router.get("")
def list_strategies(user=Depends(current_user)):
    p = _p()
    with get_conn() as conn:
        rows = conn.execute(f"SELECT * FROM strategies WHERE user_id={p} ORDER BY created_at DESC", (user["id"],)).fetchall()
    out=[]
    for r in rows:
        d=dict(r)
        d["symbols"] = json.loads(d.pop("symbols_json"))
        d["config"] = json.loads(d.pop("config_json"))
        d["user_strategy_id"] = d["config"].get("user_strategy_id") or d["config"].get("strategy_id") or d["id"]
        out.append(d)
    return out

@router.get("/{strategy_id}")
def get_strategy(strategy_id: str, user=Depends(current_user)):
    p = _p()
    with get_conn() as conn:
        r = conn.execute(f"SELECT * FROM strategies WHERE id={p} AND user_id={p}", (strategy_id, user["id"])).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Strategy not found")
    d=dict(r); d["symbols"]=json.loads(d.pop("symbols_json")); d["config"]=json.loads(d.pop("config_json")); d["user_strategy_id"] = d["config"].get("user_strategy_id") or d["config"].get("strategy_id") or d["id"]; return d
