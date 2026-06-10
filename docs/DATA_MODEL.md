# Data Model

## Core Tables

### devices

Represents each virtual or physical edge node.

Columns:

- `id`
- `device_id`
- `display_name`
- `region`
- `firmware_version`
- `installed_at`
- `last_seen_at`
- `status`
- `location`

### telemetry_readings

Stores raw normalized telemetry events.

Columns:

- `id`
- `device_id`
- `observed_at`
- `ingested_at`
- `location`
- `temperature_c`
- `humidity_pct`
- `pm25_ugm3`
- `smoke_ppm`
- `water_level_m`
- `wind_speed_mps`
- `battery_pct`
- `rssi_dbm`
- `sequence`
- `quality_flags`
- `raw_payload`

Indexes:

- `(device_id, observed_at desc)`
- `gist(location)`
- `(observed_at desc)`

### anomaly_scores

Stores derived scoring outputs.

Columns:

- `id`
- `reading_id`
- `device_id`
- `scored_at`
- `risk_score`
- `risk_level`
- `model_name`
- `model_version`
- `features`
- `explanation`

### incidents

Tracks operator-facing incidents.

Columns:

- `id`
- `incident_key`
- `status`
- `severity`
- `title`
- `summary`
- `opened_at`
- `acknowledged_at`
- `closed_at`
- `location`
- `primary_device_id`
- `risk_score`

### raw_archives

Tracks raw files copied into MinIO.

Columns:

- `id`
- `source_name`
- `object_uri`
- `started_at`
- `finished_at`
- `record_count`
- `checksum`
- `metadata`

## Incident Statuses

- `open`
- `acknowledged`
- `investigating`
- `resolved`
- `dismissed`

## Risk Levels

- `normal`
- `watch`
- `warning`
- `critical`

