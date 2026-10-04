"""PRISMFlow C++ engine runner with full error handling and job status tracking.

Improvements over MVP:
- subprocess timeout + detailed error classification
- graceful fallback when binary missing (returns demo data)
- structured error types
- job progress tracking
- works with both SQLite and PostgreSQL
"""
from __future__ import annotations

import json
import subprocess
import uuid
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

from app.core.config import settings
from app.db import get_conn, now
from app.services.output_reader import read_csv, read_json
from app.services.coach import write_coach_report
from app.services.binance_historical import fetch_real_binance_csv, yesterday_utc
from app.services.performance_metrics import build_performance_and_robustness


STANDARD_OUTPUTS = [
    "trade_log.csv",
    "backtest_summary.json",
    "setup_validation_report.json",
    "entry_intent_log.csv",
    "setup_score_log.csv",
    "audit_log.json",
    "ledger.csv",
    "events.jsonl",
    "dashboard_snapshot.json",
    "quant_coach_report.json",
]

ENGINE_TIMEOUT_SECONDS = 180


class EngineError(RuntimeError):
    """Structured engine error with category."""
    def __init__(self, msg: str, category: str = "engine_error"):
        super().__init__(msg)
        self.category = category


def _p() -> str:
    return "%s" if settings.is_postgres() else "?"


def _risk_per_trade_pct(job_payload: Dict[str, Any]) -> float | None:
    config = job_payload.get("config") if isinstance(job_payload.get("config"), dict) else {}
    risk = config.get("risk") if isinstance(config.get("risk"), dict) else {}
    raw = risk.get("risk_per_trade_pct")
    try:
        value = float(raw)
        return value if value >= 0 else None
    except Exception:
        return None


def _friction_params(job_payload: Dict[str, Any]) -> tuple[float, float]:
    config = job_payload.get("config") if isinstance(job_payload.get("config"), dict) else {}
    strat = config.get("strategy") if isinstance(config.get("strategy"), dict) else config
    fric = strat.get("execution_friction") if isinstance(strat.get("execution_friction"), dict) else {}
    try:
        fee = float(fric.get("fee_pct", 0.04))
    except Exception:
        fee = 0.04
    try:
        slip = float(fric.get("slippage_pct", 0.01))
    except Exception:
        slip = 0.01
    return fee, slip


def create_job_folder(user_id: str, job_id: str) -> Path:
    out = settings.outputs_dir / user_id / job_id
    out.mkdir(parents=True, exist_ok=True)
    return out


def write_config(job_payload: Dict[str, Any], job_id: str, output_dir: Path) -> Path:
    payload = dict(job_payload)
    payload["job_id"] = job_id
    payload["output_dir"] = str(output_dir)
    payload["paths"] = {
        "input_data": payload.get("input_data", "data/sample_market_data.csv"),
        "output_dir": str(output_dir),
    }
    path = output_dir / "strategy_config.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def _classify_engine_error(returncode: int, stderr: str, stdout: str) -> str:
    """Return a human-readable category for engine failure."""
    s = (stderr + stdout).lower()
    if returncode == 127 or "not found" in s:
        return "binary_not_found"
    if "segfault" in s or "segmentation fault" in s:
        return "engine_crash_segfault"
    if "permission denied" in s:
        return "permission_denied"
    if "timeout" in s or returncode == -15:
        return "engine_timeout"
    if "no such file" in s or "cannot open" in s:
        return "input_data_missing"
    return "engine_nonzero_exit"


def _update_job(job_id: str, **kwargs):
    """Update job record with keyword arguments."""
    if not kwargs:
        return
    p = _p()
    cols = ", ".join(f"{k}={p}" for k in kwargs)
    vals = list(kwargs.values()) + [job_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE jobs SET {cols} WHERE id={p}", vals)
        conn.commit()


def _start_job(job_id: str, user_id: str, strategy_id: str, mode: str, symbols: list[str], timeframe: str, output_dir: Path) -> None:
    """Transition an existing queued job to running, or insert a running row for legacy callers."""
    p = _p()
    with get_conn() as conn:
        row = conn.execute(f"SELECT id FROM jobs WHERE id={p}", (job_id,)).fetchone()
        if row:
            conn.execute(
                f"UPDATE jobs SET status={p}, output_dir={p}, started_at={p}, stdout={p}, stderr={p}, error_message={p} WHERE id={p}",
                ("running", str(output_dir), now(), None, None, None, job_id),
            )
        else:
            conn.execute(
                f"INSERT INTO jobs(id,user_id,strategy_id,mode,status,symbols_json,timeframe,output_dir,created_at,started_at) VALUES({p},{p},{p},{p},{p},{p},{p},{p},{p},{p})",
                (job_id, user_id, strategy_id, mode, "running", json.dumps(symbols), timeframe, str(output_dir), now(), now()),
            )
        conn.commit()


def _fail_job_before_start(job_id: str, user_id: str, strategy_id: str, mode: str, symbols: list[str], timeframe: str, output_dir: Path, error_message: str) -> None:
    """Mark an existing queued job failed, or insert a failed row for legacy callers."""
    p = _p()
    with get_conn() as conn:
        row = conn.execute(f"SELECT id FROM jobs WHERE id={p}", (job_id,)).fetchone()
        if row:
            conn.execute(
                f"UPDATE jobs SET status={p}, output_dir={p}, started_at={p}, completed_at={p}, error_message={p} WHERE id={p}",
                ("failed", str(output_dir), now(), now(), error_message, job_id),
            )
        else:
            conn.execute(
                f"INSERT INTO jobs(id,user_id,strategy_id,mode,status,symbols_json,timeframe,output_dir,created_at,started_at,completed_at,error_message) VALUES({p},{p},{p},{p},{p},{p},{p},{p},{p},{p},{p},{p})",
                (job_id, user_id, strategy_id, mode, "failed", json.dumps(symbols), timeframe, str(output_dir), now(), now(), now(), error_message),
            )
        conn.commit()


def insert_outputs(job_payload: Dict[str, Any], job_id: str, output_dir: Path):
    """Parse C++ output files and persist into database."""
    symbol = (job_payload.get("symbols") or ["BTCUSDT"])[0]
    trades = read_csv(output_dir / "trade_log.csv")
    summary = read_json(output_dir / "backtest_summary.json")
    if "performance_and_robustness" not in summary:
        fee_rate, slip_rate = _friction_params(job_payload)
        summary["performance_and_robustness"] = build_performance_and_robustness(
            trades,
            start_time=job_payload.get("start_date"),
            end_time=job_payload.get("end_date"),
            bars_processed=summary.get("bars_processed"),
            profit_factor=summary.get("profit_factor"),
            risk_per_trade_pct=_risk_per_trade_pct(job_payload),
            fee_pct=fee_rate,
            slippage_pct=slip_rate,
        )
        (output_dir / "backtest_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    validation = read_json(output_dir / "setup_validation_report.json")
    snapshot = read_json(output_dir / "dashboard_snapshot.json")
    p = _p()

    with get_conn() as conn:
        conn.execute(f"DELETE FROM trades WHERE job_id={p}", (job_id,))
        for row in trades:
            r = row.get("r_multiple") or row.get("R_multiple") or 0
            try:
                rv = float(r)
            except Exception:
                rv = 0.0
            conn.execute(
                f"INSERT INTO trades(id,job_id,user_id,strategy_id,symbol,trade_json,r_multiple,created_at) VALUES({p},{p},{p},{p},{p},{p},{p},{p})",
                (str(uuid.uuid4()), job_id, job_payload["user_id"], job_payload["strategy_id"], symbol, json.dumps(row), rv, now())
            )
        report_id = str(uuid.uuid4())
        report_values = (report_id, job_id, job_payload["user_id"], json.dumps(summary), json.dumps(validation), json.dumps(snapshot), now())
        if settings.is_postgres():
            conn.execute(
                """
                INSERT INTO reports(id,job_id,user_id,summary_json,validation_json,dashboard_snapshot_json,created_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(id) DO UPDATE SET
                    job_id=EXCLUDED.job_id,
                    user_id=EXCLUDED.user_id,
                    summary_json=EXCLUDED.summary_json,
                    validation_json=EXCLUDED.validation_json,
                    dashboard_snapshot_json=EXCLUDED.dashboard_snapshot_json,
                    created_at=EXCLUDED.created_at
                """,
                report_values
            )
        else:
            conn.execute(
                "INSERT OR REPLACE INTO reports(id,job_id,user_id,summary_json,validation_json,dashboard_snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)",
                report_values
            )
        conn.commit()


def run_engine_sync(job_payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the C++ backtest engine synchronously.

    If the binary doesn't exist, returns a structured error with clear instructions
    rather than an opaque 500. The API can still return 200 with status=failed
    so the frontend shows a useful message.
    """
    job_id = job_payload.get("job_id") or str(uuid.uuid4())
    user_id = job_payload.get("user_id", "demo_user")
    strategy_id = job_payload.get("strategy_id", "demo")
    mode = job_payload.get("mode", "backtest")
    symbols = job_payload.get("symbols", ["BTCUSDT"])
    timeframe = job_payload.get("timeframe", "1m")

    output_dir = create_job_folder(user_id, job_id)

    # Phase 3 foundation: backtests use real Binance historical data for the
    # selected symbol/timeframe/date range instead of silently falling back to
    # sample/synthetic CSV. The user chooses start_date; end_date defaults to
    # yesterday UTC so the backtest never includes incomplete current-day data.
    symbol_for_data = (symbols or ["BTCUSDT"])[0]
    end_date = job_payload.get("end_date") or yesterday_utc()
    start_date = job_payload.get("start_date")
    if mode == "backtest" and start_date:
        try:
            # Download/cache real Binance candles for every selected symbol so
            # the UI can truthfully show all selected markets. The current C++
            # research backtest engine consumes the primary CSV path, while the
            # market-data manifest records every selected symbol and row count.
            market_rows = {}
            primary_md = None
            for sym in (symbols or [symbol_for_data]):
                md_i = fetch_real_binance_csv(sym, timeframe, start_date, end_date)
                market_rows[sym] = md_i.get("rows")
                if primary_md is None:
                    primary_md = md_i
            md = dict(primary_md or {})
            md["symbols"] = list(symbols or [symbol_for_data])
            md["rows_per_symbol"] = market_rows
            try:
                md["total_rows_all_symbols"] = sum(int(v or 0) for v in market_rows.values())
            except Exception:
                md["total_rows_all_symbols"] = None
            job_payload["input_data"] = md["path"]
            job_payload["market_data"] = md
            job_payload["real_binance_data_used"] = True
            job_payload["end_date"] = end_date
        except Exception as e:
            # Keep this explicit. Do not silently generate synthetic/sample data.
            job_payload["real_binance_data_used"] = False
            job_payload["market_data_error"] = str(e)

    config_path = write_config(job_payload, job_id, output_dir)

    if mode == "backtest" and job_payload.get("market_data_error"):
        # Create or update a failed job record so the frontend can show the exact data error.
        error_message = "Real Binance data fetch failed: " + job_payload.get("market_data_error", "unknown")
        _fail_job_before_start(job_id, user_id, strategy_id, mode, symbols, timeframe, output_dir, error_message)
        return {
            "job_id": job_id,
            "status": "failed",
            "output_dir": str(output_dir),
            "error": error_message,
            "error_category": "market_data_fetch_failed",
            "synthetic_data_used": False,
        }

    _start_job(job_id, user_id, strategy_id, mode, symbols, timeframe, output_dir)

    engine = settings.engine_binary

    if not engine.exists():
        msg = (
            f"C++ engine binary not found at: {engine}\n"
            "To build: cd <project_root> && cmake -S . -B build && cmake --build build\n"
            "See BUILD_AND_RUN.md for full instructions.\n"
            "For demo purposes, the system works without the binary using golden output data."
        )
        _update_job(job_id, status="failed", error_message=msg, completed_at=now())
        return {
            "job_id": job_id,
            "status": "failed",
            "error": msg,
            "error_category": "binary_not_found",
            "output_dir": str(output_dir),
            "hint": "Run cmake to build the C++ engine, or use the demo output at outputs/demo_user/demo_job/",
        }

    # Run the engine
    cmd = [str(engine), "--config", str(config_path)]
    try:
        result = subprocess.run(
            cmd,
            text=True,
            capture_output=True,
            cwd=str(settings.project_root),
            timeout=ENGINE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        _update_job(job_id, status="failed", error_message=f"Engine timed out after {ENGINE_TIMEOUT_SECONDS}s", completed_at=now())
        return {"job_id": job_id, "status": "failed", "error_category": "engine_timeout", "output_dir": str(output_dir)}
    except FileNotFoundError as e:
        msg = f"Engine binary not executable: {e}"
        _update_job(job_id, status="failed", error_message=msg, completed_at=now())
        return {"job_id": job_id, "status": "failed", "error": msg, "error_category": "binary_not_found"}
    except Exception as e:
        msg = f"Unexpected subprocess error: {e}"
        _update_job(job_id, status="failed", error_message=msg, completed_at=now())
        return {"job_id": job_id, "status": "failed", "error": msg, "error_category": "subprocess_error"}

    status = "completed" if result.returncode == 0 else "failed"
    stderr_tail = result.stderr[-4000:] if result.stderr else ""
    stdout_tail = result.stdout[-4000:] if result.stdout else ""
    error_category = None

    if status == "failed":
        error_category = _classify_engine_error(result.returncode, result.stderr, result.stdout)

    if status == "completed":
        try:
            write_coach_report(output_dir)
            insert_outputs(job_payload, job_id, output_dir)
        except Exception as e:
            # Don't fail the job if post-processing has issues
            stderr_tail += f"\n[post_process_warning] {e}"

    _update_job(
        job_id,
        status=status,
        stdout=stdout_tail,
        stderr=stderr_tail,
        error_message=f"[{error_category}] {stderr_tail}" if status == "failed" else None,
        completed_at=now(),
    )

    response = {
        "job_id": job_id,
        "status": status,
        "output_dir": str(output_dir),
        "stdout": stdout_tail,
        "stderr": stderr_tail,
        "files": STANDARD_OUTPUTS,
    }
    if status == "completed":
        trades = read_csv(output_dir / "trade_log.csv")
        response["summary"] = read_json(output_dir / "backtest_summary.json")
        if "performance_and_robustness" not in response["summary"]:
            fee_rate, slip_rate = _friction_params(job_payload)
            response["summary"]["performance_and_robustness"] = build_performance_and_robustness(
                trades,
                start_time=job_payload.get("start_date"),
                end_time=job_payload.get("end_date"),
                bars_processed=response["summary"].get("bars_processed"),
                profit_factor=response["summary"].get("profit_factor"),
                risk_per_trade_pct=_risk_per_trade_pct(job_payload),
                fee_pct=fee_rate,
                slippage_pct=slip_rate,
            )
        response["trade_count"] = len(trades)
        response["trades_available"] = True
        response["market_data"] = job_payload.get("market_data", {})
        response["symbols"] = symbols
        response["real_binance_data_used"] = bool(job_payload.get("real_binance_data_used"))
        response["synthetic_data_used"] = False
    else:
        response["error_category"] = error_category
        response["hint"] = _engine_error_hint(error_category)

    return response


def _engine_error_hint(category: Optional[str]) -> str:
    hints = {
        "binary_not_found": "Build with: cmake -S . -B build && cmake --build build",
        "engine_crash_segfault": "Check C++ engine logs; possible memory issue with input data format",
        "permission_denied": "chmod +x the engine binary",
        "engine_timeout": f"Engine exceeded {ENGINE_TIMEOUT_SECONDS}s; reduce data size or check for infinite loops",
        "input_data_missing": "Ensure input_data path points to a valid CSV",
        "engine_nonzero_exit": "Check stderr for detailed engine error output",
    }
    return hints.get(category or "", "Check engine binary and input data")
