-- Migration: device kind + incident hazard.
--
-- Idempotent so it is safe both as a fresh-init script and as a migration
-- applied to an existing database. Note that 003_seed_devices.sql also
-- guards the devices.kind column because init scripts run in lexical order.

alter table devices
  add column if not exists kind text not null default 'ridge';

alter table incidents
  add column if not exists hazard text not null default 'wildfire';

create index if not exists idx_incidents_device_hazard
  on incidents (primary_device_id, hazard, status);
