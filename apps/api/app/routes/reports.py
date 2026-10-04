from fastapi import APIRouter, Depends, HTTPException
from pathlib import Path
from app.services.output_reader import read_csv, read_json, read_jsonl, output_manifest
from app.deps import current_user
from app.db import get_conn
from app.core.config import settings

router = APIRouter()


import json

def _p() -> str:
    return "%s" if settings.is_postgres() else "?"


def job_dir(user_id: str, job_id: str) -> Path:
    p = _p()
    with get_conn() as conn:
        r = conn.execute(f"SELECT output_dir FROM jobs WHERE id={p} AND user_id={p}", (job_id, user_id)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Job not found")
    out = r["output_dir"]
    if out and Path(out).exists():
        return Path(out)
    return settings.outputs_dir / user_id / job_id


@router.get("/{job_id}/outputs")
def outputs(job_id: str, user=Depends(current_user)):
    return output_manifest(str(job_dir(user["id"], job_id)))


@router.get("/{job_id}/trade-log")
def trade_log(job_id: str, user=Depends(current_user)):
    # 1. Try disk file
    path = job_dir(user["id"], job_id) / "trade_log.csv"
    if path.exists():
        t = read_csv(path)
        if t:
            return t
    # 2. Try DB trades table
    p = _p()
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT trade_json, symbol, r_multiple FROM trades WHERE job_id={p} AND user_id={p} ORDER BY created_at ASC",
            (job_id, user["id"])
        ).fetchall()
        if rows:
            trades = []
            for r in rows:
                try:
                    trades.append(json.loads(r["trade_json"]))
                except Exception:
                    trades.append({"symbol": r["symbol"], "r_multiple": r["r_multiple"]})
            return trades
    return []


@router.get("/{job_id}/summary")
def summary(job_id: str, user=Depends(current_user)):
    # 1. Try DB reports table
    p = _p()
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT summary_json FROM reports WHERE job_id={p} AND user_id={p}",
            (job_id, user["id"])
        ).fetchone()
        if row and row["summary_json"]:
            try:
                data = json.loads(row["summary_json"])
                if data:
                    return data
            except Exception:
                pass
    # 2. Try disk file
    path = job_dir(user["id"], job_id) / "backtest_summary.json"
    if path.exists():
        return read_json(path)
    return {}


@router.get("/{job_id}/audit")
def audit(job_id: str, user=Depends(current_user)):
    return read_json(job_dir(user["id"], job_id) / "audit_log.json")


@router.get("/{job_id}/events")
def events(job_id: str, user=Depends(current_user)):
    return read_jsonl(job_dir(user["id"], job_id) / "events.jsonl")


@router.get("/{job_id}/dashboard-snapshot")
def dashboard_snapshot(job_id: str, user=Depends(current_user)):
    return read_json(job_dir(user["id"], job_id) / "dashboard_snapshot.json")
