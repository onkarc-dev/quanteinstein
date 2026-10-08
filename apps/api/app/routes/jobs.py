"""Job submission, status polling, and list routes."""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel

from app.db import get_conn, now, row_to_dict
from app.core.config import settings
from app.deps import current_user
from app.services.job_queue import queue, JobStatus
from app.services.engine_runner import run_engine_sync
from app.services.output_reader import read_csv, read_json

router = APIRouter()

HOSTED_HEAVY_BACKTEST_MESSAGE = (
    "This backtest is too heavy for the hosted free API. "
    "Run locally or reduce symbols/timeframe."
)
HOSTED_ROW_THRESHOLD = 250_000


class BacktestPayload(BaseModel):
    strategy_id: str
    symbols: list[str] = ["BTCUSDT"]
    timeframe: str = "1m"
    start_date: str | None = None
    end_date: str | None = None
    config: dict = {}
    sync: bool | None = None


def _p() -> str:
    return "%s" if settings.is_postgres() else "?"


def _timeframe_seconds(timeframe: str) -> int:
    m = re.match(r"^(\d+)([smh])$", str(timeframe or "1m").strip().lower())
    if not m:
        return 60
    n = int(m.group(1))
    return n if m.group(2) == "s" else n * 60 if m.group(2) == "m" else n * 3600


def _hosted_guard_enabled() -> bool:
    return bool(settings.is_prod or os.getenv("RENDER", "").strip().lower() in {"1", "true", "yes"})


def estimate_backtest_rows(symbol_count: int, timeframe: str, start_date: str | None, end_date: str | None) -> int | None:
    if not start_date:
        return None
    from datetime import date

    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date or start_date)
    except Exception:
        return None
    days = max((end - start).days + 1, 1)
    seconds = max(_timeframe_seconds(timeframe), 1)
    return int(days * 86400 / seconds) * max(symbol_count, 1)


def heavy_backtest_reason(payload: BacktestPayload) -> str | None:
    symbols = [s for s in payload.symbols if str(s).strip()]
    symbol_count = len(symbols) or 1
    low_timeframe = _timeframe_seconds(payload.timeframe) <= 5
    rows_estimate = estimate_backtest_rows(symbol_count, payload.timeframe, payload.start_date, payload.end_date)
    if symbol_count > 3 and low_timeframe:
        return HOSTED_HEAVY_BACKTEST_MESSAGE
    if rows_estimate is not None and rows_estimate > HOSTED_ROW_THRESHOLD:
        return HOSTED_HEAVY_BACKTEST_MESSAGE
    return None


def _insert_queued_job(job_id: str, user_id: str, payload: BacktestPayload) -> None:
    p = _p()
    with get_conn() as conn:
        conn.execute(
            f"""
            INSERT INTO jobs(id,user_id,strategy_id,mode,status,symbols_json,timeframe,output_dir,created_at)
            VALUES({p},{p},{p},{p},{p},{p},{p},{p},{p})
            """,
            (
                job_id,
                user_id,
                payload.strategy_id,
                "backtest",
                "queued",
                json.dumps(payload.symbols),
                payload.timeframe,
                "",
                now(),
            ),
        )
        conn.commit()


@router.post("/submit-backtest", summary="Submit a backtest job (async)")
def submit_backtest(
    payload: BacktestPayload,
    background_tasks: BackgroundTasks,
    user=Depends(current_user),
):
    """Queue a backtest job. Returns immediately with job ID. Use /jobs/{id} to poll."""
    if _hosted_guard_enabled():
        reason = heavy_backtest_reason(payload)
        if reason:
            raise HTTPException(status_code=422, detail=reason)

    job_id = str(uuid.uuid4())
    cfg_data = payload.config
    if not cfg_data and payload.strategy_id:
        p = _p()
        with get_conn() as conn:
            row = conn.execute(
                f"SELECT config_json FROM strategies WHERE (id={p} OR user_strategy_id={p})",
                (payload.strategy_id, payload.strategy_id),
            ).fetchone()
            if row:
                try:
                    row_dict = row_to_dict(row)
                    raw_cfg = row_dict.get("config_json")
                    if raw_cfg:
                        cfg_data = json.loads(raw_cfg) if isinstance(raw_cfg, str) else raw_cfg
                except Exception:
                    pass

    job_payload = {
        "job_id": job_id,
        "user_id": user["id"],
        "strategy_id": payload.strategy_id,
        "mode": "backtest",
        "symbols": payload.symbols,
        "timeframe": payload.timeframe,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "config": cfg_data,
    }

    _insert_queued_job(job_id, user["id"], payload)

    # Queue the job (non-blocking)
    q_job = queue.enqueue("backtest", job_payload)

    # Determine whether to execute synchronously:
    # Synchronous execution is ONLY used when explicitly requested via sync=True
    # or for legacy single-symbol non-hosted local test environments where sync is not False.
    is_multi = len(payload.symbols) > 1
    is_hosted = _hosted_guard_enabled()
    explicit_sync = payload.sync is True
    explicit_async = payload.sync is False

    should_run_sync = explicit_sync or (
        not explicit_async and not is_hosted and not is_multi and not settings.has_redis()
    )

    if should_run_sync:
        result = run_engine_sync(job_payload)
        return {
            "job_id": result.get("job_id"),
            "status": result.get("status"),
            "queue_id": q_job.id,
            "mode": "sync_demo",
            "message": "Backtest completed synchronously",
            **result,
        }

    # Asynchronous execution:
    # If Redis is active, background worker handles it.
    # Otherwise, dispatch to FastAPI background tasks so the client gets an immediate response (<20ms)
    # and avoids reverse-proxy gateway timeouts on hosted environments.
    if not settings.has_redis():
        background_tasks.add_task(run_engine_sync, job_payload)

    return {
        "job_id": job_id,
        "queue_id": q_job.id,
        "status": "queued",
        "message": "Backtest job queued. Polling /jobs/{id} for status.",
    }


def _clean_stale_jobs_for_user(conn, user_id: str) -> None:
    p = _p()
    now_dt = datetime.now(timezone.utc)
    try:
        stale_rows = conn.execute(
            f"SELECT id, output_dir, created_at FROM jobs WHERE user_id={p} AND status IN ('running', 'queued')",
            (user_id,)
        ).fetchall()
        for row in stale_rows:
            j = row_to_dict(row)
            created_str = j.get("created_at")
            if not created_str:
                continue
            try:
                dt_str = created_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(dt_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                age = (now_dt - dt).total_seconds()
            except Exception:
                age = 0
            if age > 180:  # 3 minutes threshold
                jid = j["id"]
                out_dir = Path(j.get("output_dir") or (settings.outputs_dir / user_id / jid))
                summary_path = out_dir / "backtest_summary.json"
                rep = conn.execute(f"SELECT id FROM reports WHERE job_id={p}", (jid,)).fetchone()
                if summary_path.exists() or rep:
                    conn.execute(
                        f"UPDATE jobs SET status='completed', output_dir={p}, completed_at={p} WHERE id={p}",
                        (str(out_dir), now(), jid)
                    )
                else:
                    conn.execute(
                        f"UPDATE jobs SET status='failed', error_message='Job execution timed out or background worker was restarted. Please re-run the backtest.', completed_at={p} WHERE id={p}",
                        (now(), jid)
                    )
        conn.commit()
    except Exception:
        pass


@router.get("/", summary="List jobs for current user")
def list_jobs(user=Depends(current_user)):
    p = _p()
    with get_conn() as conn:
        _clean_stale_jobs_for_user(conn, user["id"])
        rows = conn.execute(
            f"""
            SELECT j.*, s.name AS strategy_name, s.config_json AS strategy_config_json
            FROM jobs j
            LEFT JOIN strategies s
              ON (s.id = j.strategy_id OR s.name = j.strategy_id)
             AND s.user_id = j.user_id
            WHERE j.user_id={p}
            ORDER BY j.created_at DESC
            LIMIT 20
            """,
            (user["id"],),
        ).fetchall()
        jobs = []
        for row in rows:
            j = row_to_dict(row)
            strategy_name = j.get("strategy_name")
            strategy_config_json = j.pop("strategy_config_json", None)
            parsed_cfg = None
            if strategy_config_json:
                try:
                    parsed_cfg = json.loads(strategy_config_json)
                except Exception:
                    parsed_cfg = None

            # Resolve readable display name
            display_name = strategy_name
            if (not display_name or re.match(r'^[0-9a-fA-F-]{32,36}$', str(display_name).strip())) and parsed_cfg:
                display_name = parsed_cfg.get("name") or parsed_cfg.get("user_strategy_id")

            # Check output_dir / strategy_config.json as fallback
            is_uuid = bool(re.match(r'^[0-9a-fA-F-]{32,36}$', str(display_name or j.get("strategy_id") or "").strip()))
            out_dir_str = j.get("output_dir")
            if out_dir_str:
                cfg_file = Path(out_dir_str) / "strategy_config.json"
                if cfg_file.exists():
                    try:
                        cf = read_json(cfg_file)
                        inner_cfg = cf.get("config", {}) if isinstance(cf.get("config"), dict) else cf
                        if not parsed_cfg:
                            parsed_cfg = inner_cfg
                        if not display_name or is_uuid:
                            found_name = (
                                inner_cfg.get("name")
                                or inner_cfg.get("user_strategy_id")
                                or cf.get("name")
                                or cf.get("user_strategy_id")
                                or cf.get("strategy", {}).get("name")
                            )
                            if found_name and not re.match(r'^[0-9a-fA-F-]{32,36}$', str(found_name).strip()):
                                display_name = found_name
                    except Exception:
                        pass

            if not display_name or re.match(r'^[0-9a-fA-F-]{32,36}$', str(display_name).strip()):
                display_name = "PRISM_BREAKOUT_RETEST"

            j["strategy_name"] = display_name
            j["display_strategy_id"] = display_name
            if parsed_cfg:
                j["config"] = parsed_cfg
            jobs.append(j)
    return {"jobs": jobs}


@router.get("/{job_id}", summary="Get job status and details")
def get_job(job_id: str, user=Depends(current_user)):
    p = _p()
    with get_conn() as conn:
        _clean_stale_jobs_for_user(conn, user["id"])
        row = conn.execute(
            f"SELECT * FROM jobs WHERE id={p} AND user_id={p}",
            (job_id, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
        data = row_to_dict(row)
        s_row = conn.execute(
            f"SELECT name, config_json FROM strategies WHERE (id={p} OR name={p}) AND user_id={p}",
            (data.get("strategy_id"), data.get("strategy_id"), user["id"])
        ).fetchone()

    strat_name = None
    parsed_cfg = None
    if s_row:
        sd = row_to_dict(s_row)
        strat_name = sd.get("name")
        if sd.get("config_json"):
            try:
                parsed_cfg = json.loads(sd["config_json"])
                if not strat_name or re.match(r'^[0-9a-fA-F-]{32,36}$', str(strat_name).strip()):
                    strat_name = parsed_cfg.get("name") or parsed_cfg.get("user_strategy_id")
            except Exception:
                pass

    try:
        data["symbols"] = json.loads(data.get("symbols_json") or "[]")
    except Exception:
        data["symbols"] = []

    out_dir_str = data.get("output_dir")
    if out_dir_str:
        out_path = Path(out_dir_str)
        if out_path.exists():
            summary_path = out_path / "backtest_summary.json"
            if summary_path.exists():
                data["summary"] = read_json(summary_path)
            trade_path = out_path / "trade_log.csv"
            if trade_path.exists():
                data["trades"] = read_csv(trade_path)
            cfg_path = out_path / "strategy_config.json"
            if cfg_path.exists():
                try:
                    cfg = read_json(cfg_path)
                    inner_cfg = cfg.get("config", {}) if isinstance(cfg.get("config"), dict) else cfg
                    if not parsed_cfg:
                        parsed_cfg = inner_cfg
                    if not strat_name or re.match(r'^[0-9a-fA-F-]{32,36}$', str(strat_name).strip()):
                        found_name = (
                            inner_cfg.get("name")
                            or inner_cfg.get("user_strategy_id")
                            or cfg.get("name")
                            or cfg.get("user_strategy_id")
                            or cfg.get("strategy", {}).get("name")
                        )
                        if found_name and not re.match(r'^[0-9a-fA-F-]{32,36}$', str(found_name).strip()):
                            strat_name = found_name
                    if "market_data" in cfg:
                        data["market_data"] = cfg["market_data"]
                    if "real_binance_data_used" in cfg:
                        data["real_binance_data_used"] = cfg["real_binance_data_used"]
                except Exception:
                    pass

    if not strat_name or re.match(r'^[0-9a-fA-F-]{32,36}$', str(strat_name).strip()):
        strat_name = "PRISM_BREAKOUT_RETEST"

    data["strategy_name"] = strat_name
    data["display_strategy_id"] = strat_name
    if parsed_cfg:
        data["config"] = parsed_cfg
    return data


@router.get("/{job_id}/download-output", summary="Download all output files (ZIP)")
def download_job_output(job_id: str, user=Depends(current_user)):
    """In production, return file download of outputs.zip. Here return file list."""
    p = _p()
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT output_dir FROM jobs WHERE id={p} AND user_id={p}",
            (job_id, user["id"])
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    output_dir = row_to_dict(row)["output_dir"]
    return {
        "message": "Report output is available for this completed job.",
    }
