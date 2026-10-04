import json, uuid, re
from typing import List, Dict, Any
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


def _clean_base_name(name: str | None, fallback: str = "Strategy") -> str:
    raw = (name or "").strip()
    if not raw:
        return fallback
    cleaned = re.sub(r'\s*\(\d+\)$', '', raw).strip()
    return cleaned or fallback


def _disambiguate_strategy_name(base_name: str, existing_names: List[str]) -> str:
    clean_base = _clean_base_name(base_name)
    pattern = re.compile(rf'^{re.escape(clean_base)}(?:\s*\((\d+)\))?$', re.IGNORECASE)
    indices = []
    for name in existing_names:
        m = pattern.match((name or "").strip())
        if m:
            idx = int(m.group(1)) if m.group(1) is not None else 0
            indices.append(idx)
    if not indices:
        return clean_base
    next_idx = max(indices) + 1
    return f"{clean_base} ({next_idx})"


@router.post("")
def create_strategy(strategy: StrategyCreate, user=Depends(current_user)):
    sid = str(uuid.uuid4())
    data = strategy.model_dump()
    explicit_uid = (strategy.user_strategy_id or data.get("user_strategy_id") or "").strip()
    user_strat_id = _clean_user_strategy_id(explicit_uid, f"STRAT-{sid[:8]}")
    data["user_strategy_id"] = user_strat_id

    raw_name = (strategy.name or user_strat_id or "Strategy").strip()
    clean_base = _clean_base_name(raw_name)
    p = _p()
    with get_conn() as conn:
        existing = conn.execute(
            f"SELECT id, name, config_json, created_at FROM strategies WHERE user_id={p} ORDER BY created_at ASC",
            (user["id"],)
        ).fetchall()

        match_id = None
        existing_names = []
        for r in existing:
            row_id = r["id"] if hasattr(r, "keys") else r[0]
            row_name = r["name"] if hasattr(r, "keys") else r[1]
            existing_names.append(row_name)
            try:
                cfg = json.loads(r["config_json"] if hasattr(r, "keys") else r[2])
            except Exception:
                cfg = {}
            if explicit_uid and _clean_user_strategy_id(cfg.get("user_strategy_id") or cfg.get("strategy_id"), "") == user_strat_id:
                match_id = row_id

        if match_id and explicit_uid:
            conn.execute(
                f"UPDATE strategies SET name={p}, symbols_json={p}, timeframe={p}, config_json={p}, updated_at={p} WHERE id={p} AND user_id={p}",
                (strategy.name, json.dumps(strategy.symbols), strategy.timeframe, json.dumps(data), now(), match_id, user["id"])
            )
            conn.commit()
            return {
                "id": match_id,
                "strategy_id": match_id,
                "name": strategy.name,
                "display_name": strategy.name,
                "user_strategy_id": user_strat_id,
                "user_id": user["id"],
                **data,
            }

        resolved_name = _disambiguate_strategy_name(clean_base, existing_names)
        data["name"] = resolved_name
        data["display_name"] = resolved_name
        if not explicit_uid:
            user_strat_id = _clean_user_strategy_id(resolved_name, f"STRAT-{sid[:8]}")
            data["user_strategy_id"] = user_strat_id

        conn.execute(
            f"INSERT INTO strategies(id,user_id,name,symbols_json,timeframe,config_json,created_at,updated_at) VALUES({p},{p},{p},{p},{p},{p},{p},{p})",
            (sid, user["id"], resolved_name, json.dumps(strategy.symbols), strategy.timeframe, json.dumps(data), now(), now())
        )
        conn.commit()

    return {
        "id": sid,
        "strategy_id": sid,
        "name": resolved_name,
        "display_name": resolved_name,
        "user_strategy_id": user_strat_id,
        "user_id": user["id"],
        **data,
    }


@router.get("")
def list_strategies(user=Depends(current_user)):
    p = _p()
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM strategies WHERE user_id={p} ORDER BY created_at ASC",
            (user["id"],)
        ).fetchall()
        tested_rows = conn.execute(
            f"SELECT DISTINCT strategy_id FROM jobs WHERE user_id={p}",
            (user["id"],)
        ).fetchall()
        tested_ids = {
            (r[0] if isinstance(r, (list, tuple)) else r["strategy_id"])
            for r in tested_rows
        }

    name_counts: Dict[str, int] = {}
    items = []
    for r in rows:
        d = dict(r)
        d["symbols"] = json.loads(d.pop("symbols_json"))
        d["config"] = json.loads(d.pop("config_json"))
        raw_name = d.get("name") or d["config"].get("name") or d["config"].get("user_strategy_id") or "Strategy"
        clean_base = _clean_base_name(raw_name)
        count = name_counts.get(clean_base, 0)
        display_name = clean_base if count == 0 else f"{clean_base} ({count})"
        name_counts[clean_base] = count + 1

        d["display_name"] = display_name
        d["name"] = display_name
        d["user_strategy_id"] = d["config"].get("user_strategy_id") or d["config"].get("strategy_id") or d["id"]
        d["has_backtest"] = d["id"] in tested_ids or d.get("user_strategy_id") in tested_ids
        items.append(d)

    items.reverse()
    return items


@router.get("/{strategy_id}")
def get_strategy(strategy_id: str, user=Depends(current_user)):
    p = _p()
    with get_conn() as conn:
        r = conn.execute(f"SELECT * FROM strategies WHERE id={p} AND user_id={p}", (strategy_id, user["id"])).fetchone()
        if not r:
            rows = conn.execute(f"SELECT * FROM strategies WHERE user_id={p} ORDER BY created_at DESC", (user["id"],)).fetchall()
            for row in rows:
                rd = dict(row)
                try:
                    cfg = json.loads(rd.get("config_json") or "{}")
                    if cfg.get("user_strategy_id") == strategy_id or rd.get("name") == strategy_id or rd.get("id", "").startswith(strategy_id):
                        r = row
                        break
                except Exception:
                    pass
    if not r:
        raise HTTPException(status_code=404, detail="Strategy not found")
    d = dict(r)
    d["symbols"] = json.loads(d.pop("symbols_json"))
    d["config"] = json.loads(d.pop("config_json"))
    d["user_strategy_id"] = d["config"].get("user_strategy_id") or d["config"].get("strategy_id") or d["id"]
    d["display_name"] = d.get("name") or d["user_strategy_id"]
    return d
