"""PRISMFlow job queue abstraction.

Provides a unified interface with three backends:
1. InMemoryJobQueue  — synchronous local demo (zero deps, always works)
2. ThreadedJobQueue  — async background threads (local dev, no Redis needed)
3. RQJobQueue        — Redis Queue (production) — lazy import

The factory function `build_queue()` selects the best available backend
based on settings, and the `queue` singleton is the default instance used
by API routes.

All backends expose the same interface so routes never need changing.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"

# legacy alias kept for compatibility
QueueStatus = JobStatus


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class QueueJob:
    id: str
    kind: str
    payload: Dict[str, Any]
    status: JobStatus = JobStatus.queued
    result: Optional[Dict[str, Any]] = None
    error: str = ""
    created_at: str = field(default_factory=_now)
    started_at: str = ""
    completed_at: str = ""
    progress_pct: int = 0
    meta: Dict[str, Any] = field(default_factory=dict)


# ─── In-Memory Queue (synchronous — for unit tests and demo) ──────────────────

class InMemoryJobQueue:
    """Synchronous in-process queue. Thread-safe. Zero external deps."""

    def __init__(self):
        self._jobs: Dict[str, QueueJob] = {}
        self._lock = threading.Lock()

    def enqueue(self, kind: str, payload: Dict[str, Any]) -> QueueJob:
        job = QueueJob(id=str(uuid4()), kind=kind, payload=dict(payload))
        with self._lock:
            self._jobs[job.id] = job
        return job

    def run(self, job_id: str, fn: Callable[[Dict[str, Any]], Dict[str, Any]]) -> QueueJob:
        with self._lock:
            job = self._jobs[job_id]
            job.status = JobStatus.running
            job.started_at = _now()
        try:
            result = fn(job.payload)
            with self._lock:
                job.result = result
                job.status = JobStatus.completed
                job.completed_at = _now()
                job.progress_pct = 100
        except Exception as exc:
            with self._lock:
                job.error = str(exc)
                job.status = JobStatus.failed
                job.completed_at = _now()
        return job

    def get(self, job_id: str) -> Optional[QueueJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self, kind: str | None = None) -> List[QueueJob]:
        with self._lock:
            jobs = list(self._jobs.values())
        if kind:
            jobs = [j for j in jobs if j.kind == kind]
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.status == JobStatus.queued:
                job.status = JobStatus.cancelled
                job.completed_at = _now()
                return True
        return False

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            jobs = list(self._jobs.values())
        return {
            "backend": "in_memory",
            "total": len(jobs),
            "queued": sum(1 for j in jobs if j.status == JobStatus.queued),
            "running": sum(1 for j in jobs if j.status == JobStatus.running),
            "completed": sum(1 for j in jobs if j.status == JobStatus.completed),
            "failed": sum(1 for j in jobs if j.status == JobStatus.failed),
        }


# ─── Threaded Queue (async background — local dev without Redis) ──────────────

class ThreadedJobQueue(InMemoryJobQueue):
    """Runs jobs in background threads. Useful for local dev where you want
    non-blocking HTTP responses. Still in-process — no restart persistence."""

    def enqueue_and_run(
        self,
        kind: str,
        payload: Dict[str, Any],
        fn: Callable[[Dict[str, Any]], Dict[str, Any]],
    ) -> QueueJob:
        job = self.enqueue(kind, payload)
        t = threading.Thread(target=self.run, args=(job.id, fn), daemon=True)
        t.start()
        return job

    def stats(self) -> Dict[str, Any]:
        s = super().stats()
        s["backend"] = "threaded"
        return s


# ─── RQ Queue (production Redis backend) ─────────────────────────────────────

class RQJobQueue:
    """Thin wrapper around Redis Queue (rq). Requires: pip install rq redis."""

    def __init__(self, redis_url: str, queue_name: str = "prismflow"):
        try:
            from redis import Redis
            from rq import Queue as _RQ
            from rq import Retry as _Retry
            from rq.job import Job as _RQJob
        except ImportError:
            raise RuntimeError(
                "rq and redis packages are required for Redis-backed queue.\n"
                "Install with: pip install rq redis\n"
                "Or unset REDIS_URL to use the threaded fallback."
            )
        self._redis = Redis.from_url(redis_url)
        self._rq = _RQ(queue_name, connection=self._redis)
        self._Retry = _Retry
        self._RQJob = _RQJob

    def enqueue(self, kind: str, payload: Dict[str, Any]) -> QueueJob:
        if kind == "enterprise_db_provisioning":
            rq_job = self._rq.enqueue(
                "app.core.tenant_provisioner.provision_tenant_worker_sync",
                dict(payload),
                job_timeout=300,
                result_ttl=86400,
                failure_ttl=86400,
                retry=self._Retry(max=3, interval=[10, 30, 60]),
            )
            return QueueJob(
                id=rq_job.id,
                kind=kind,
                payload=dict(payload),
                status=JobStatus.queued,
                created_at=_now(),
                meta={"rq_job_id": rq_job.id},
            )
        elif kind != "backtest":
            raise ValueError(f"Unsupported RQ job kind: {kind}")

        rq_job = self._rq.enqueue(
            "app.services.engine_runner.run_engine_sync",
            dict(payload),
            job_timeout=240,
            result_ttl=86400,
            failure_ttl=86400,
            retry=self._Retry(max=1, interval=[30]),
        )
        return QueueJob(
            id=rq_job.id,
            kind=kind,
            payload=dict(payload),
            status=JobStatus.queued,
            created_at=_now(),
            meta={"rq_job_id": rq_job.id},
        )

    def get(self, job_id: str) -> Optional[QueueJob]:
        try:
            rq_job = self._RQJob.fetch(job_id, connection=self._redis)
        except Exception:
            return None

        status_raw = rq_job.get_status(refresh=True)
        status = {
            "queued": JobStatus.queued,
            "started": JobStatus.running,
            "deferred": JobStatus.queued,
            "scheduled": JobStatus.queued,
            "finished": JobStatus.completed,
            "failed": JobStatus.failed,
            "canceled": JobStatus.cancelled,
            "cancelled": JobStatus.cancelled,
            "stopped": JobStatus.failed,
        }.get(str(status_raw), JobStatus.queued)

        return QueueJob(
            id=rq_job.id,
            kind=(rq_job.meta or {}).get("kind", "backtest"),
            payload={},
            status=status,
            result=rq_job.result if isinstance(rq_job.result, dict) else None,
            error=str(rq_job.exc_info or ""),
            created_at=str(rq_job.created_at or ""),
            started_at=str(rq_job.started_at or ""),
            completed_at=str(rq_job.ended_at or ""),
            progress_pct=100 if status in {JobStatus.completed, JobStatus.failed, JobStatus.cancelled} else 0,
            meta={"rq_status": str(status_raw)},
        )

    def stats(self) -> Dict[str, Any]:
        try:
            return {
                "backend": "redis_rq",
                "queued": len(self._rq),
                "redis_connected": self._redis.ping(),
            }
        except Exception as e:
            return {"backend": "redis_rq", "error": str(e)}


# ─── Factory & Singleton ──────────────────────────────────────────────────────

def build_queue() -> InMemoryJobQueue:
    """Select best available queue backend."""
    from app.core.config import settings
    if settings.has_redis():
        try:
            q = RQJobQueue(settings.redis_url)
            q.stats()  # test connection
            return q  # type: ignore[return-value]
        except Exception:
            pass  # fall through to threaded
    return ThreadedJobQueue()


# Module-level singleton — used by API routes
queue = InMemoryJobQueue()  # replaced at startup by build_queue()
