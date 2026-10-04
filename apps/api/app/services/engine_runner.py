"""PRISMFlow C++ engine runner with full error handling and job status tracking.

Improvements over MVP:
- subprocess timeout + detailed error classification
- graceful fallback when binary missing (returns demo data)
- structured error types
- job progress tracking
- works with both SQLite and PostgreSQL
"""
from __future__ import annotations

import csv
import json
import subprocess
import uuid
import sys
import concurrent.futures
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


def write_trade_log_csv(trades: list[dict[str, Any]], path: Path) -> None:
    fieldnames = [
        "trade_id", "symbol", "entry_time", "entry_price", "stop_loss",
        "target1", "target2", "exit_time", "exit_price", "exit_reason",
        "r_multiple", "setup_score_at_entry", "regime_at_entry", "holding_bars"
    ]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for t in trades:
            writer.writerow(t)


def compute_symbol_breakdown(
    trades: list[dict[str, Any]],
    expected_symbols: list[str] | None = None,
    fee_pct: float = 0.04,
    slippage_pct: float = 0.01,
    risk_pct: float = 1.0,
) -> dict[str, dict[str, Any]]:
    effective_risk = risk_pct if risk_pct > 0 else 1.0
    friction_per_trade = ((fee_pct * 2.0) + (slippage_pct * 2.0)) / effective_risk
    
    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for sym in (expected_symbols or []):
        by_symbol[str(sym).upper()] = []
    for t in trades:
        sym = str(t.get("symbol") or (expected_symbols[0] if expected_symbols else "UNKNOWN")).upper()
        by_symbol.setdefault(sym, []).append(t)
        
    breakdown = {}
    for sym, s_trades in by_symbol.items():
        rs = []
        for t in s_trades:
            raw = t.get("r_multiple", t.get("R_multiple", 0))
            try:
                rs.append(float(raw))
            except Exception:
                rs.append(0.0)
        n = len(rs)
        wins = [x for x in rs if x > 0.0001]
        losses = [x for x in rs if x < -0.0001]
        be = [x for x in rs if abs(x) <= 0.0001]
        gross_r = sum(rs)
        net_r = gross_r - (friction_per_trade * n)
        gross_win = sum(wins)
        gross_loss = abs(sum(losses))
        pf = round(gross_win / gross_loss, 3) if gross_loss > 0 else (None if gross_win == 0 else 999.0)
        
        peak = 0.0
        cur_eq = 0.0
        max_dd = 0.0
        for x in rs:
            cur_eq += x
            peak = max(peak, cur_eq)
            max_dd = max(max_dd, peak - cur_eq)
            
        breakdown[sym] = {
            "symbol": sym,
            "trades": n,
            "wins": len(wins),
            "losses": len(losses),
            "breakeven": len(be),
            "win_rate": round(len(wins) / n, 4) if n > 0 else 0.0,
            "gross_R": round(gross_r, 4),
            "net_R": round(net_r, 4),
            "profit_factor": pf,
            "max_drawdown_in_R": round(max_dd, 4),
            "avg_R": round(gross_r / n, 4) if n > 0 else 0.0,
            "best_R": round(max(rs), 4) if rs else 0.0,
            "worst_R": round(min(rs), 4) if rs else 0.0,
        }
    return breakdown


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
            row_sym = str(row.get("symbol") or symbol).upper()
            conn.execute(
                f"INSERT INTO trades(id,job_id,user_id,strategy_id,symbol,trade_json,r_multiple,created_at) VALUES({p},{p},{p},{p},{p},{p},{p},{p})",
                (str(uuid.uuid4()), job_id, job_payload["user_id"], job_payload["strategy_id"], row_sym, json.dumps(row), rv, now())
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


def _run_engine_sync_impl(
    job_payload: Dict[str, Any],
    output_dir: Path,
    job_id: str,
    user_id: str,
    strategy_id: str,
    mode: str,
    symbols: list[str],
    timeframe: str,
) -> Dict[str, Any]:
    # Phase 3 foundation: backtests use real Binance historical data for the
    # selected symbol/timeframe/date range instead of silently falling back to
    # sample/synthetic CSV. The user chooses start_date; end_date defaults to
    # yesterday UTC so the backtest never includes incomplete current-day data.
    symbol_for_data = (symbols or ["BTCUSDT"])[0]
    end_date = job_payload.get("end_date") or yesterday_utc()
    start_date = job_payload.get("start_date")
    market_paths: dict[str, str] = {}
    if mode == "backtest" and start_date:
        try:
            # Download/cache real Binance candles for every selected symbol in parallel so
            # the UI can truthfully show all selected markets without serial network latency.
            market_rows = {}
            primary_md = None
            syms_to_fetch = list(symbols or [symbol_for_data])

            def _fetch_single_symbol(sym: str):
                return sym, fetch_real_binance_csv(sym, timeframe, start_date, end_date)

            max_fetch_workers = min(len(syms_to_fetch), 16)
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_fetch_workers) as executor:
                fetched_items = list(executor.map(_fetch_single_symbol, syms_to_fetch))

            for sym, md_i in fetched_items:
                market_rows[sym] = md_i.get("rows")
                market_paths[sym] = md_i.get("path")
                if primary_md is None:
                    primary_md = md_i
            md = dict(primary_md or {})
            md["symbols"] = list(symbols or [symbol_for_data])
            md["rows_per_symbol"] = market_rows
            try:
                md["total_rows_all_symbols"] = sum(int(v or 0) for v in market_rows.values())
            except Exception:
                md["total_rows_all_symbols"] = None
            job_payload["input_data"] = md.get("path")
            job_payload["market_data"] = md
            job_payload["market_paths"] = market_paths
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

    multi_symbol = len(symbols) > 1 and bool(market_paths) and mode == "backtest"
    if multi_symbol:
        all_basket_trades: list[dict[str, Any]] = []
        combined_stdout = ""
        combined_stderr = ""
        any_success = False

        def _run_single_symbol(sym: str) -> tuple[str, bool, list[dict[str, Any]], str, str]:
            sym_input = market_paths.get(sym) or job_payload.get("input_data")
            sym_dir = output_dir / sym
            sym_dir.mkdir(parents=True, exist_ok=True)
            sym_payload = dict(job_payload)
            sym_payload["symbols"] = [sym]
            sym_payload["input_data"] = sym_input
            sym_cfg_path = write_config(sym_payload, f"{job_id}_{sym}", sym_dir)
            sym_cmd = [str(engine), "--config", str(sym_cfg_path)]
            try:
                sub_res = subprocess.run(
                    sym_cmd,
                    text=True,
                    capture_output=True,
                    cwd=str(settings.project_root),
                    timeout=ENGINE_TIMEOUT_SECONDS,
                )
                stdout_part = f"\n[{sym}]\n" + (sub_res.stdout[-1000:] if sub_res.stdout else "")
                stderr_part = f"\n[{sym}]\n" + (sub_res.stderr[-1000:] if sub_res.stderr else "")
                if sub_res.returncode == 0:
                    sym_trades = read_csv(sym_dir / "trade_log.csv")
                    for t in sym_trades:
                        t["symbol"] = sym
                    return sym, True, sym_trades, stdout_part, stderr_part
                return sym, False, [], stdout_part, stderr_part
            except Exception as exc:
                return sym, False, [], "", f"\n[{sym}] Error: {exc}"

        max_proc_workers = min(len(symbols), 8)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_proc_workers) as executor:
            proc_results = list(executor.map(_run_single_symbol, symbols))

        for sym, ok, sym_trades, stdout_part, stderr_part in proc_results:
            combined_stdout += stdout_part
            combined_stderr += stderr_part
            if ok:
                any_success = True
                all_basket_trades.extend(sym_trades)

        status = "completed" if any_success else "failed"
        stdout_tail = combined_stdout[-4000:]
        stderr_tail = combined_stderr[-4000:]
        error_category = None if any_success else "engine_nonzero_exit"

        if any_success:
            all_basket_trades.sort(key=lambda t: str(t.get("entry_time") or ""))
            for idx, t in enumerate(all_basket_trades, start=1):
                t["trade_id"] = idx

            write_trade_log_csv(all_basket_trades, output_dir / "trade_log.csv")

            fee_rate, slip_rate = _friction_params(job_payload)
            risk_pct = _risk_per_trade_pct(job_payload) or 1.0
            breakdown = compute_symbol_breakdown(all_basket_trades, symbols, fee_rate, slip_rate, risk_pct)

            rs = []
            for t in all_basket_trades:
                try:
                    rs.append(float(t.get("r_multiple") or 0))
                except Exception:
                    rs.append(0.0)
            wins = [x for x in rs if x > 0.0001]
            losses = [x for x in rs if x < -0.0001]
            gross_r = sum(rs)
            gross_win = sum(wins)
            gross_loss = abs(sum(losses))
            pf = round(gross_win / gross_loss, 3) if gross_loss > 0 else (None if gross_win == 0 else 999.0)

            peak = 0.0
            equity = 0.0
            max_dd = 0.0
            for x in rs:
                equity += x
                peak = max(peak, equity)
                max_dd = max(max_dd, peak - equity)

            total_bars = sum(int(v or 0) for v in (job_payload.get("market_data", {}).get("rows_per_symbol", {}).values()))
            combined_summary = {
                "bars_processed": total_bars,
                "total_trades": len(all_basket_trades),
                "wins": len(wins),
                "losses": len(losses),
                "win_rate": round(len(wins) / len(all_basket_trades), 4) if all_basket_trades else 0.0,
                "gross_R": round(gross_r, 4),
                "average_R": round(gross_r / len(all_basket_trades), 4) if all_basket_trades else 0.0,
                "profit_factor": pf,
                "max_drawdown_in_R": round(max_dd, 4),
                "symbols": symbols,
                "per_symbol_breakdown": breakdown,
            }
            combined_summary["performance_and_robustness"] = build_performance_and_robustness(
                all_basket_trades,
                start_time=job_payload.get("start_date"),
                end_time=job_payload.get("end_date"),
                bars_processed=total_bars,
                profit_factor=pf,
                risk_per_trade_pct=risk_pct,
                fee_pct=fee_rate,
                slippage_pct=slip_rate,
            )
            (output_dir / "backtest_summary.json").write_text(json.dumps(combined_summary, indent=2), encoding="utf-8")
    else:
        # Run the engine for single symbol
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
            trades = read_csv(output_dir / "trade_log.csv")
            for t in trades:
                t["symbol"] = symbols[0]
            write_trade_log_csv(trades, output_dir / "trade_log.csv")
            fee_rate, slip_rate = _friction_params(job_payload)
            risk_pct = _risk_per_trade_pct(job_payload) or 1.0
            summary = read_json(output_dir / "backtest_summary.json")
            summary["per_symbol_breakdown"] = compute_symbol_breakdown(trades, symbols, fee_rate, slip_rate, risk_pct)
            if "performance_and_robustness" not in summary:
                summary["performance_and_robustness"] = build_performance_and_robustness(
                    trades,
                    start_time=job_payload.get("start_date"),
                    end_time=job_payload.get("end_date"),
                    bars_processed=summary.get("bars_processed"),
                    profit_factor=summary.get("profit_factor"),
                    risk_per_trade_pct=risk_pct,
                    fee_pct=fee_rate,
                    slippage_pct=slip_rate,
                )
            (output_dir / "backtest_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

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
        summary = read_json(output_dir / "backtest_summary.json")
        response["summary"] = summary
        response["trades"] = trades
        response["trade_count"] = len(trades)
        response["trades_available"] = True
        response["per_symbol_breakdown"] = summary.get("per_symbol_breakdown", {})
        response["market_data"] = job_payload.get("market_data", {})
        response["symbols"] = symbols
        response["real_binance_data_used"] = bool(job_payload.get("real_binance_data_used"))
        response["synthetic_data_used"] = False
    else:
        response["error_category"] = error_category
        response["hint"] = _engine_error_hint(error_category)

    return response


def run_engine_sync(job_payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the C++ backtest engine synchronously with automatic error recovery and DB updates.
    """
    job_id = job_payload.get("job_id") or str(uuid.uuid4())
    user_id = job_payload.get("user_id", "demo_user")
    strategy_id = job_payload.get("strategy_id", "demo")
    mode = job_payload.get("mode", "backtest")
    symbols = job_payload.get("symbols", ["BTCUSDT"])
    timeframe = job_payload.get("timeframe", "1m")

    output_dir = create_job_folder(user_id, job_id)
    _start_job(job_id, user_id, strategy_id, mode, symbols, timeframe, output_dir)

    try:
        return _run_engine_sync_impl(
            job_payload=job_payload,
            output_dir=output_dir,
            job_id=job_id,
            user_id=user_id,
            strategy_id=strategy_id,
            mode=mode,
            symbols=symbols,
            timeframe=timeframe,
        )
    except Exception as exc:
        err_msg = f"Backtest execution error: {exc}"
        _update_job(job_id, status="failed", error_message=err_msg, completed_at=now())
        return {
            "job_id": job_id,
            "status": "failed",
            "error": err_msg,
            "error_category": "unhandled_engine_error",
            "output_dir": str(output_dir),
        }


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
