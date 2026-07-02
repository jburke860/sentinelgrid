"""Worker v2: multi-model scores, learned baselines, hourly rollups.

Mirrors infra/db/init/005_worker_v2.sql (fresh compose volumes get the same
DDL from the init script; existing databases apply it via this revision).
Both are idempotent, so running one after the other is safe.

Revision ID: 0002
Revises: 0001
"""
from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
alter table anomaly_scores
  add column if not exists model_scores jsonb not null default '{}';

create table if not exists device_baselines (
  device_id text not null references devices(device_id),
  metric text not null,
  sample_count bigint not null default 0,
  mean double precision not null default 0,
  m2 double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, metric)
);

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
"""

DOWNGRADE_SQL = """
drop table if exists telemetry_rollup_1h;
drop table if exists device_baselines;
alter table anomaly_scores drop column if exists model_scores;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
