"""In-memory per-client-IP sliding-window rate limiter.

Good enough for a single-process deployment; swap for Redis if the API is
ever scaled horizontally. /health is exempt so probes never get throttled.
"""
from __future__ import annotations

import threading
import time
from collections import deque

from . import config

EXEMPT_PATHS = {"/health"}

_WINDOW_S = 60.0
_hits: dict[str, deque[float]] = {}
_lock = threading.Lock()


def allow(client_ip: str, path: str) -> bool:
    limit = config.rate_limit_per_min()
    if limit <= 0 or path in EXEMPT_PATHS:
        return True
    now = time.monotonic()
    with _lock:
        window = _hits.setdefault(client_ip, deque())
        cutoff = now - _WINDOW_S
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True


def reset() -> None:
    """Clear all counters (tests)."""
    with _lock:
        _hits.clear()
