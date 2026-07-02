"""Prometheus metrics for the API process.

Counters are incremented at the ingest/HTTP layers; the scoring-lag gauge is
refreshed on each /metrics scrape (cheap query, guarded by pool readiness).
"""
from __future__ import annotations

import logging

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    generate_latest,
)

from . import db

log = logging.getLogger("sentinelgrid.metrics")

INGEST_TOTAL = Counter(
    "sentinelgrid_ingest_total",
    "Telemetry payloads accepted (HTTP + MQTT).",
    ["source"],
)
INGEST_FAILED = Counter(
    "sentinelgrid_ingest_failed_total",
    "Telemetry payloads that failed validation or storage.",
    ["source"],
)
HTTP_REQUESTS = Counter(
    "sentinelgrid_http_requests_total",
    "HTTP requests served.",
    ["method", "path", "status"],
)
SCORING_LAG_S = Gauge(
    "sentinelgrid_scoring_lag_seconds",
    "Age of the oldest unscored telemetry reading (0 when fully scored).",
)

_SCORING_LAG_SQL = """
select coalesce(extract(epoch from (now() - min(tr.ingested_at))), 0) as lag_s
from telemetry_readings tr
left join anomaly_scores a on a.reading_id = tr.id
where a.id is null
"""


def _refresh_scoring_lag() -> None:
    if not db.pool_ready():
        return
    try:
        with db.get_pool().connection() as conn:
            row = conn.execute(_SCORING_LAG_SQL).fetchone()
            SCORING_LAG_S.set(float(row[0]))
    except Exception as exc:  # noqa: BLE001 - metrics must never break scrapes
        log.debug("scoring-lag refresh failed: %s", exc)


def render() -> tuple[bytes, str]:
    """Return (body, content_type) for the /metrics endpoint."""
    _refresh_scoring_lag()
    return generate_latest(), CONTENT_TYPE_LATEST
