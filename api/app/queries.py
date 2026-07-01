"""Raw SQL queries for the API endpoints."""
from __future__ import annotations

from typing import Any

from psycopg.rows import dict_row

DEVICES_WITH_LATEST_SQL = """
select
  d.device_id,
  d.display_name,
  d.region,
  d.kind,
  st_y(d.location::geometry) as device_lat,
  st_x(d.location::geometry) as device_lon,
  d.firmware_version,
  d.status,
  d.last_seen_at,
  r.id as reading_id,
  r.observed_at,
  st_y(r.location::geometry) as reading_lat,
  st_x(r.location::geometry) as reading_lon,
  r.temperature_c, r.humidity_pct, r.pm25_ugm3, r.smoke_ppm,
  r.water_level_m, r.wind_speed_mps,
  r.battery_pct, r.rssi_dbm, r.sequence, r.quality_flags,
  s.risk_score, s.risk_level
from devices d
left join lateral (
  select *
  from telemetry_readings tr
  where tr.device_id = d.device_id
  order by tr.observed_at desc, tr.id desc
  limit 1
) r on true
left join lateral (
  select a.risk_score, a.risk_level
  from anomaly_scores a
  where a.device_id = d.device_id
  order by a.scored_at desc, a.id desc
  limit 1
) s on true
order by d.device_id
"""

INCIDENTS_SQL = """
select
  i.id,
  i.incident_key,
  i.status,
  i.severity,
  i.hazard,
  i.title,
  i.summary,
  i.opened_at,
  i.acknowledged_at,
  i.closed_at,
  st_y(i.location::geometry) as incident_lat,
  st_x(i.location::geometry) as incident_lon,
  i.primary_device_id,
  d.display_name as device_name,
  d.region,
  i.risk_score
from incidents i
join devices d on d.device_id = i.primary_device_id
where (%(status)s::text is null or i.status = %(status)s)
order by i.opened_at desc
limit %(limit)s
"""

TELEMETRY_SERIES_SQL = """
select
  tr.id,
  tr.observed_at,
  st_y(tr.location::geometry) as reading_lat,
  st_x(tr.location::geometry) as reading_lon,
  tr.temperature_c, tr.humidity_pct, tr.pm25_ugm3, tr.smoke_ppm,
  tr.water_level_m, tr.wind_speed_mps,
  tr.battery_pct, tr.rssi_dbm, tr.sequence, tr.quality_flags
from telemetry_readings tr
where tr.device_id = %(device_id)s
  and (%(since)s::timestamptz is null or tr.observed_at >= %(since)s)
order by tr.observed_at desc, tr.id desc
limit %(limit)s
"""


def fetch_all(pool, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    with pool.connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params or {})
            return cur.fetchall()


def fetch_one(pool, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    with pool.connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params or {})
            return cur.fetchone()
