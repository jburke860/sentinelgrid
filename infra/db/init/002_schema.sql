create table if not exists devices (
  id bigserial primary key,
  device_id text not null unique,
  display_name text not null,
  region text not null,
  firmware_version text not null,
  installed_at timestamptz not null default now(),
  last_seen_at timestamptz,
  status text not null default 'provisioned',
  location geography(point, 4326) not null
);

create table if not exists telemetry_readings (
  id bigserial primary key,
  device_id text not null references devices(device_id),
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  location geography(point, 4326) not null,
  temperature_c double precision,
  humidity_pct double precision,
  pm25_ugm3 double precision,
  smoke_ppm double precision,
  water_level_m double precision,
  wind_speed_mps double precision,
  battery_pct double precision,
  rssi_dbm integer,
  sequence integer,
  quality_flags text[] not null default '{}',
  raw_payload jsonb not null
);

create table if not exists anomaly_scores (
  id bigserial primary key,
  reading_id bigint not null references telemetry_readings(id) on delete cascade,
  device_id text not null references devices(device_id),
  scored_at timestamptz not null default now(),
  risk_score integer not null check (risk_score >= 0 and risk_score <= 100),
  risk_level text not null check (risk_level in ('normal', 'watch', 'warning', 'critical')),
  model_name text not null,
  model_version text not null,
  features jsonb not null,
  explanation jsonb not null
);

create table if not exists incidents (
  id bigserial primary key,
  incident_key text not null unique,
  status text not null check (status in ('open', 'acknowledged', 'investigating', 'resolved', 'dismissed')),
  severity text not null check (severity in ('watch', 'warning', 'critical')),
  title text not null,
  summary text not null,
  opened_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  closed_at timestamptz,
  location geography(point, 4326) not null,
  primary_device_id text not null references devices(device_id),
  risk_score integer not null check (risk_score >= 0 and risk_score <= 100)
);

create table if not exists raw_archives (
  id bigserial primary key,
  source_name text not null,
  object_uri text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  record_count integer,
  checksum text,
  metadata jsonb not null default '{}'
);

create index if not exists idx_devices_location
  on devices using gist (location);

create index if not exists idx_telemetry_device_observed_at
  on telemetry_readings (device_id, observed_at desc);

create index if not exists idx_telemetry_observed_at
  on telemetry_readings (observed_at desc);

create index if not exists idx_telemetry_location
  on telemetry_readings using gist (location);

create index if not exists idx_anomaly_scores_device_scored_at
  on anomaly_scores (device_id, scored_at desc);

create index if not exists idx_incidents_status_opened_at
  on incidents (status, opened_at desc);

create index if not exists idx_incidents_location
  on incidents using gist (location);

