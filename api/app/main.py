"""SentinelGrid API: telemetry ingestion + dashboard queries."""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime

import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row

from . import config, db, mqtt_ingest, queries
from .ingest import store_telemetry
from .schemas import IncidentAction, TelemetryPayload
from .serialize import epoch_ms, shape_device, shape_incident, shape_snapshot

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
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


def _pool_or_503():
    if not db.pool_ready():
        raise HTTPException(status_code=503, detail="database not ready")
    return db.get_pool()


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "database": "ready" if db.pool_ready() else "connecting"}


@app.post("/ingest/telemetry", status_code=202)
def ingest_telemetry(payload: TelemetryPayload) -> dict[str, object]:
    pool = _pool_or_503()
    try:
        reading_id = store_telemetry(pool, payload)
    except psycopg.Error as exc:
        log.warning("http ingest failed: %s", exc)
        raise HTTPException(status_code=503, detail="database write failed") from exc
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


@app.patch("/incidents/{incident_id}")
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
    return {"id": incident_id, "status": target}


@app.get("/snapshot")
def snapshot() -> dict[str, object]:
    pool = _pool_or_503()
    device_rows = queries.fetch_all(pool, queries.DEVICES_WITH_LATEST_SQL)
    incident_rows = queries.fetch_all(
        pool, queries.INCIDENTS_SQL, {"status": None, "limit": 200}
    )
    return shape_snapshot(device_rows, incident_rows, now_ms=int(time.time() * 1000))
