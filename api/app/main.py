"""SentinelGrid API: telemetry ingestion + dashboard queries."""
from __future__ import annotations

import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from psycopg.rows import dict_row

from . import config, db, logsetup, metrics, mqtt_ingest, queries, ratelimit
from .ingest import store_telemetry
from .schemas import IncidentAction, TelemetryPayload
from .serialize import epoch_ms, shape_device, shape_incident, shape_snapshot

logsetup.configure()
log = logging.getLogger("sentinelgrid.api")

# Incident status lifecycle (docs/DATA_MODEL.md).
TRANSITIONS: dict[str, tuple[set[str], str]] = {
    "acknowledge": ({"open"}, "acknowledged"),
    "investigate": ({"open", "acknowledged"}, "investigating"),
    "resolve": ({"open", "acknowledged", "investigating"}, "resolved"),
    "dismiss": ({"open", "acknowledged", "investigating"}, "dismissed"),
}

INCIDENT_STATUSES = {"open", "acknowledged", "investigating", "resolved", "dismissed"}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.open_pool_background()
    if config.mqtt_enabled():
        mqtt_ingest.start_background_ingest()
    yield
    mqtt_ingest.stop_background_ingest()
    db.close_pool()


app = FastAPI(
    title="SentinelGrid API",
    version="0.2.0",
    description="Local-first API for edge telemetry ingestion and climate-risk monitoring.",
    lifespan=lifespan,
)

# Local-first tool: the dashboard dev server runs on a different port, so the
# browser needs CORS headers to read the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_and_count(request: Request, call_next):
    if not ratelimit.allow(request.client.host if request.client else "unknown", request.url.path):
        response = Response(
            content='{"detail":"rate limit exceeded"}',
            status_code=429,
            media_type="application/json",
        )
    else:
        response = await call_next(request)
    route = request.scope.get("route")
    metrics.HTTP_REQUESTS.labels(
        method=request.method,
        path=route.path if route is not None else request.url.path,
        status=str(response.status_code),
    ).inc()
    return response


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Write endpoints require X-API-Key when SENTINELGRID_API_KEY is set."""
    expected = config.api_key()
    if expected is not None and x_api_key != expected:
        raise HTTPException(status_code=401, detail="invalid or missing API key")


def _pool_or_503():
    if not db.pool_ready():
        raise HTTPException(status_code=503, detail="database not ready")
    return db.get_pool()


def _build_snapshot(pool) -> dict[str, object]:
    device_rows = queries.fetch_all(pool, queries.DEVICES_WITH_LATEST_SQL)
    incident_rows = queries.fetch_all(
        pool, queries.INCIDENTS_SQL, {"status": None, "limit": 200}
    )
    return shape_snapshot(device_rows, incident_rows, now_ms=int(time.time() * 1000))


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "database": "ready" if db.pool_ready() else "connecting"}


@app.get("/metrics")
def prometheus_metrics() -> Response:
    body, content_type = metrics.render()
    return Response(content=body, media_type=content_type)


@app.post("/ingest/telemetry", status_code=202, dependencies=[Depends(require_api_key)])
def ingest_telemetry(payload: TelemetryPayload) -> dict[str, object]:
    pool = _pool_or_503()
    try:
        reading_id = store_telemetry(pool, payload)
    except psycopg.Error as exc:
        metrics.INGEST_FAILED.labels(source="http").inc()
        log.warning("http ingest failed: %s", exc)
        raise HTTPException(status_code=503, detail="database write failed") from exc
    metrics.INGEST_TOTAL.labels(source="http").inc()
    return {"status": "accepted", "readingId": reading_id}


@app.get("/devices")
def list_devices() -> list[dict[str, object]]:
    pool = _pool_or_503()
    rows = queries.fetch_all(pool, queries.DEVICES_WITH_LATEST_SQL)
    return [shape_device(row) for row in rows]


@app.get("/devices/{device_id}/telemetry")
def device_telemetry(
    device_id: str,
    since: datetime | None = None,
    limit: int = Query(default=500, ge=1, le=5000),
) -> dict[str, object]:
    pool = _pool_or_503()
    exists = queries.fetch_one(
        pool, "select 1 as ok from devices where device_id = %(id)s", {"id": device_id}
    )
    if exists is None:
        raise HTTPException(status_code=404, detail="unknown device")
    rows = queries.fetch_all(
        pool,
        queries.TELEMETRY_SERIES_SQL,
        {"device_id": device_id, "since": since, "limit": limit},
    )
    rows.reverse()  # chronological order for charting
    points = [
        {
            "t": epoch_ms(row["observed_at"]),
            "lat": row["reading_lat"],
            "lon": row["reading_lon"],
            "values": {
                "temperature_c": row["temperature_c"],
                "humidity_pct": row["humidity_pct"],
                "pm25_ugm3": row["pm25_ugm3"],
                "smoke_ppm": row["smoke_ppm"],
                "water_level_m": row["water_level_m"],
                "wind_speed_mps": row["wind_speed_mps"],
            },
            "batteryPct": row["battery_pct"],
            "rssiDbm": row["rssi_dbm"],
            "sequence": row["sequence"],
            "flags": list(row["quality_flags"] or []),
        }
        for row in rows
    ]
    return {"deviceId": device_id, "points": points}


@app.get("/incidents")
def list_incidents(
    status: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[dict[str, object]]:
    if status is not None and status not in INCIDENT_STATUSES:
        raise HTTPException(status_code=422, detail=f"invalid status: {status}")
    pool = _pool_or_503()
    rows = queries.fetch_all(pool, queries.INCIDENTS_SQL, {"status": status, "limit": limit})
    return [shape_incident(row) for row in rows]


@app.patch("/incidents/{incident_id}", dependencies=[Depends(require_api_key)])
def update_incident(incident_id: int, body: IncidentAction) -> dict[str, object]:
    pool = _pool_or_503()
    allowed_from, target = TRANSITIONS[body.action]
    with pool.connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select id, status from incidents where id = %(id)s for update",
                {"id": incident_id},
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="unknown incident")
            if row["status"] not in allowed_from:
                raise HTTPException(
                    status_code=409,
                    detail=f"cannot {body.action} incident in status {row['status']}",
                )
            cur.execute(
                """
                update incidents
                set status = %(target)s,
                    acknowledged_at = case
                      when %(target)s = 'acknowledged' then now()
                      else acknowledged_at
                    end,
                    closed_at = case
                      when %(target)s in ('resolved', 'dismissed') then now()
                      else closed_at
                    end
                where id = %(id)s
                """,
                {"target": target, "id": incident_id},
            )
    # Complete the MQTT contract: operator actions fan out as device commands.
    mqtt_ingest.publish_incident_command(incident_id, body.action, target)
    return {"id": incident_id, "status": target}


@app.get("/snapshot")
def snapshot() -> dict[str, object]:
    return _build_snapshot(_pool_or_503())


@app.get("/stream")
def stream() -> StreamingResponse:
    """Server-Sent Events: a `snapshot` event every ~2s (heartbeats between)."""
    interval = config.stream_interval_s()

    def event_source():
        yield ": sentinelgrid snapshot stream\n\n"
        while True:
            if db.pool_ready():
                try:
                    payload = json.dumps(_build_snapshot(db.get_pool()))
                    yield f"event: snapshot\ndata: {payload}\n\n"
                except Exception as exc:  # noqa: BLE001 - keep the stream alive
                    log.warning("stream snapshot failed: %s", exc)
                    yield ": snapshot unavailable\n\n"
            else:
                yield ": database not ready\n\n"
            time.sleep(interval)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
