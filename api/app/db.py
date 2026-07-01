"""Small psycopg3 connection pool with resilient startup.

The pool is created lazily and opened in the background with retry/backoff
so the API process starts cleanly even when PostgreSQL is not up yet.
"""
from __future__ import annotations

import logging
import threading
import time

from psycopg_pool import ConnectionPool

from . import config

log = logging.getLogger("sentinelgrid.db")

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()
_pool_ready = threading.Event()


def get_pool() -> ConnectionPool:
    """Return the process-wide pool, creating it (unopened) on first use."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool(
                conninfo=config.database_url(),
                min_size=1,
                max_size=4,
                open=False,
                name="sentinelgrid-api",
            )
        return _pool


def open_pool_background() -> None:
    """Open the pool in a daemon thread, retrying with backoff."""

    def _open() -> None:
        pool = get_pool()
        delay = 1.0
        while True:
            try:
                pool.open(wait=True, timeout=10.0)
                with pool.connection() as conn:
                    conn.execute("select 1")
                _pool_ready.set()
                log.info("database pool ready")
                return
            except Exception as exc:  # noqa: BLE001 - keep retrying on any failure
                log.warning("database not ready (%s); retrying in %.0fs", exc, delay)
                time.sleep(delay)
                delay = min(delay * 2, 30.0)

    threading.Thread(target=_open, name="db-pool-open", daemon=True).start()


def pool_ready() -> bool:
    return _pool_ready.is_set()


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.close()
            except Exception:  # noqa: BLE001
                pass
            _pool = None
            _pool_ready.clear()
