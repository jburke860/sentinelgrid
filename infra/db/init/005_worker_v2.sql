-- Migration: worker v2 — multi-model scores, learned baselines, hourly rollups.
--
-- Idempotent so it is safe both as a fresh-init script and as a migration
-- applied to an existing database. Mirrored by alembic revision 0002
-- (db/alembic/versions/0002_worker_v2.py); keep the two in sync.

-- Scores from additional models (e.g. isolation-forest), keyed by model name.
alter table anomaly_scores
  add column if not exists model_scores jsonb not null default '{}';

-- Incrementally learned per-device/per-metric baselines (Welford counters).
create table if not exists device_baselines (
  device_id text not null references devices(device_id),
  metric text not null,
  sample_count bigint not null default 0,
  mean double precision not null default 0,
  m2 double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, metric)
);

-- Hourly rollups so raw telemetry can be retention-pruned without losing history.
create table if not exists telemetry_rollup_1h (
  device_id text not null references devices(device_id),
  bucket timestamptz not null,
  reading_count integer not null,
  temperature_c_avg double precision, temperature_c_min double precision, temperature_c_max double precision,
  humidity_pct_avg double precision, humidity_pct_min double precision, humidity_pct_max double precision,
  pm25_ugm3_avg double precision, pm25_ugm3_min double precision, pm25_ugm3_max double precision,
  smoke_ppm_avg double precision, smoke_ppm_min double precision, smoke_ppm_max double precision,
  water_level_m_avg double precision, water_level_m_min double precision, water_level_m_max double precision,
  wind_speed_mps_avg double precision, wind_speed_mps_min double precision, wind_speed_mps_max double precision,
  primary key (device_id, bucket)
);

create index if not exists idx_rollup_1h_bucket
  on telemetry_rollup_1h (bucket desc);
