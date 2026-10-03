"""PRISMFlow FastAPI application entry point."""
from __future__ import annotations

import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db import init_db
from app.routes import auth, strategies, jobs, reports, analytics, coach, journal, live_paper, engine, ai, backtests
from app.routes.system import router as system_router
from app.services.job_queue import build_queue
import app.services.job_queue as jq_module

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(settings.log_file, encoding="utf-8")],
)
logger = logging.getLogger("quantos.api")
_request_count = 0
_error_count = 0
_rate_limit_hits: dict[str, list[float]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    # Initialize database schema once on startup
    init_db()
    # Wire up best available job queue
    jq_module.queue = build_queue()
    logger.info("DB backend: %s", settings.db_backend)
    logger.info("Queue: %s", jq_module.queue.stats()['backend'])
    logger.info("Safe mode: paper/backtest only, no real-money execution")
    yield
    # Shutdown hooks (none needed currently)


app = FastAPI(
    title="QuantOS API",
    version="3.0.0",
    description=(
        "QuantOS — Personal Quant Research Paper Trading Platform. "
        "Paper/backtest analytics only. Not financial advice. No real-money execution."
    ),
    lifespan=lifespan,
)

# CORS — explicitly permit production frontend domain, local dev, and dynamic origin reflection
allowed_origins = [o for o in settings.cors_origins if o != "*"]
for def_origin in ("https://www.quanteinstein.com", "https://quanteinstein.com", "http://localhost:3000", "http://127.0.0.1:3000"):
    if def_origin not in allowed_origins:
        allowed_origins.append(def_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request timing middleware ────────────────────────────────────────────────
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    global _request_count, _error_count
    if settings.enforce_https:
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        if proto != "https" and request.url.hostname not in {"127.0.0.1", "localhost"}:
            raise HTTPException(status_code=403, detail="HTTPS is required")
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and settings.is_prod:
        client_host = forwarded.split(",")[0].strip()
    else:
        client_host = request.client.host if request.client else "unknown"
    now_ts = time.time()
    if settings.rate_limit_per_minute > 0 and not request.url.path.startswith("/health"):
        if len(_rate_limit_hits) > 10000:
            stale_keys = [k for k, v in _rate_limit_hits.items() if not v or (now_ts - v[-1] > 60)]
            for k in stale_keys:
                _rate_limit_hits.pop(k, None)
        recent = [t for t in _rate_limit_hits.get(client_host, []) if now_ts - t < 60]
        if len(recent) >= settings.rate_limit_per_minute:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        recent.append(now_ts)
        _rate_limit_hits[client_host] = recent
    start = time.perf_counter()
    _request_count += 1
    try:
        response: Response = await call_next(request)
    except Exception:
        _error_count += 1
        logger.exception("Unhandled request error path=%s", request.url.path)
        raise
    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
    if response.status_code >= 500:
        _error_count += 1
    response.headers["X-Process-Time-Ms"] = str(elapsed_ms)
    response.headers["X-QuantOS-Safe-Mode"] = "paper-backtest-only"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.enforce_https:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    logger.info("%s %s status=%s elapsed_ms=%s", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


# ─── Top-level health (no auth required) ────────────────────────────────────
@app.get("/metrics", tags=["system"], summary="Prometheus-compatible minimal metrics")
def metrics():
    body = (
        f"quantos_api_requests_total {_request_count}\n"
        f"quantos_api_errors_total {_error_count}\n"
        f"quantos_safe_mode 1\n"
    )
    return Response(content=body, media_type="text/plain")


@app.get("/health", tags=["system"], summary="API liveness probe")
def health():
    return {
        "status": "ok",
        "product": "QuantOS",
        "version": "3.0.0",
        "safe_mode": True,
        "real_money_enabled": False,
        "disclaimer": "Paper/backtest analytics only. Not financial advice.",
    }


@app.get("/version", tags=["system"], summary="API version")
def version():
    return {"product": "QuantOS", "version": app.version, "safe_mode": True, "real_money_enabled": False}


# ─── Routers ──────────────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(strategies.router, prefix="/strategies", tags=["strategies"])
app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
app.include_router(coach.router, prefix="/coach", tags=["quant-coach"])
app.include_router(journal.router, prefix="/journal", tags=["journal-behavior"])
app.include_router(system_router, prefix="/system", tags=["system"])
app.include_router(live_paper.router, prefix="/live-paper", tags=["live-paper"])
app.include_router(engine.router, prefix="/engine", tags=["local-engine"])
app.include_router(ai.router, prefix="/ai", tags=["ai"])
app.include_router(backtests.router, prefix="/backtests", tags=["backtests"])
