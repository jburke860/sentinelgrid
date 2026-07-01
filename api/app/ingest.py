"""Shared telemetry ingestion logic for MQTT and HTTP paths."""
from __future__ import annotations

import json
import logging

from psycopg.types.json import Jsonb

from .schemas import TelemetryPayload

log = logging.getLogger("sentinelgrid.ingest")

_UPSERT_DEVICE_SQL = """
insert into devices (device_id, display_name, region, kind, firmware_version, status,
                     last_seen_at, location)
values (%(device_id)s, %(device_id)s, 'unknown', 'ridge', %(firmware)s, 'online',
        %(observed_at)s,
        st_setsrid(st_makepoint(%(lon)s, %(lat)s), 4326)::geography)
on conflict (device_id) do update
  set last_seen_at = greatest(coalesce(devices.last_seen_at, excluded.last_seen_at),
                              excluded.last_seen_at),
      status = 'online',
      firmware_version = excluded.firmware_version
"""

_INSERT_READING_SQL = """
insert into telemetry_readings (
  device_id, observed_at, location,
  temperature_c, humidity_pct, pm25_ugm3, smoke_ppm, water_level_m, wind_speed_mps,
  battery_pct, rssi_dbm, sequence, quality_flags, raw_payload
) values (
  %(device_id)s, %(observed_at)s,
  st_setsrid(st_makepoint(%(lon)s, %(lat)s), 4326)::geography,
  %(temperature_c)s, %(humidity_pct)s, %(pm25_ugm3)s, %(smoke_ppm)s,
  %(water_level_m)s, %(wind_speed_mps)s,
  %(battery_pct)s, %(rssi_dbm)s, %(sequence)s, %(flags)s, %(raw)s
)
returning id
"""


def store_telemetry(pool, payload: TelemetryPayload) -> int:
    """Upsert device state and insert a telemetry reading. Returns reading id."""
    raw = json.loads(payload.model_dump_json())
    params = {
        "device_id": payload.device_id,
        "observed_at": payload.timestamp,
        "lat": payload.location.lat,
        "lon": payload.location.lon,
        "firmware": payload.health.firmware_version,
        "temperature_c": payload.readings.temperature_c,
        "humidity_pct": payload.readings.humidity_pct,
        "pm25_ugm3": payload.readings.pm25_ugm3,
        "smoke_ppm": payload.readings.smoke_ppm,
        "water_level_m": payload.readings.water_level_m,
        "wind_speed_mps": payload.readings.wind_speed_mps,
        "battery_pct": payload.health.battery_pct,
        "rssi_dbm": round(payload.health.rssi_dbm),
        "sequence": payload.quality.sequence,
        "flags": payload.quality.flags,
        "raw": Jsonb(raw),
    }
    with pool.connection() as conn:
        conn.execute(_UPSERT_DEVICE_SQL, params)
        row = conn.execute(_INSERT_READING_SQL, params).fetchone()
        return int(row[0])
