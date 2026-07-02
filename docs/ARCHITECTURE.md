# SentinelGrid Architecture

## Goal

Build a credible, no-hardware edge telemetry platform that demonstrates backend engineering, data engineering, geospatial querying, anomaly detection, and embedded-style systems thinking.

The system should behave like a real field-monitoring product even though the devices are virtual.

## System Components

### Edge Simulator

`edge-sim` is a C++ process that simulates remote devices. Each device publishes MQTT telemetry at a configurable interval.

Responsibilities:

- Generate realistic sensor readings.
- Replay public environmental observations later.
- Simulate device conditions such as battery drain, weak signal, sensor drift, packet loss, and offline recovery.
- Publish JSON telemetry to MQTT.

Important design choice: keep the simulator deterministic when a seed is provided. This makes tests, demos, and benchmarks repeatable.

### MQTT Broker

Mosquitto is the local message broker.

Topic pattern:

```text
sentinelgrid/v1/devices/{device_id}/telemetry
sentinelgrid/v1/devices/{device_id}/status
sentinelgrid/v1/incidents/{incident_id}/commands
```

### API

FastAPI exposes ingestion and query endpoints.

Responsibilities:

- Accept telemetry from an MQTT bridge or direct HTTP test clients.
- Validate payloads.
- Store readings in PostgreSQL/PostGIS.
- Serve dashboard queries for device state, incidents, time-series data, and map markers.
- Push live snapshots over Server-Sent Events (`GET /stream`).
- Track device presence from retained status topics and publish incident
  commands back to devices.
- Enforce optional API-key auth on writes and per-IP rate limits; expose
  Prometheus metrics at `GET /metrics`.
- Expose OpenAPI docs for portfolio review.

Schema changes ship two ways: idempotent `infra/db/init/*.sql` scripts
bootstrap fresh compose volumes, and matching Alembic revisions
(`db/alembic/`) upgrade existing databases.

### Database

PostgreSQL with PostGIS stores devices, readings, incidents, and derived scores.

Data is modeled for:

- time-series lookups by device and timestamp
- geospatial queries by bounding box and distance
- incident lifecycle workflows
- reproducible data-quality checks

### Worker

The worker runs Python jobs.

Responsibilities:

- Pull or replay public data sources.
- Run anomaly scoring: a z-score hazard model (driving incidents) against
  learned per-device baselines, plus an IsolationForest second opinion
  stored alongside each score (bootstrapped on synthetic samples, then
  periodically refit on recent low-risk telemetry; provenance tracked).
- Deliver webhook alerts for newly-opened incidents
  (`SENTINELGRID_WEBHOOK_URL`, optional Slack formatting).
- Run data-quality checks.
- Maintain hourly rollups and prune raw telemetry past the retention window.
- Archive raw telemetry batches to MinIO with checksums (`raw_archives`).
- Backfill derived incident records.
- Backtest the models against labeled anomaly windows (`app/backtest.py`).

Start with plain Python jobs. Add Dagster, Airflow, or dbt after the core platform works.

### Dashboard

The dashboard is a Next.js app for operators.

Views:

- live device map
- device health table
- incident queue
- time-series chart for selected device
- anomaly detail panel
- data-source/replay status

Use Leaflet with OpenStreetMap tiles to avoid paid map APIs.

## Data Flow

1. `edge-sim` generates telemetry.
2. Telemetry is published to Mosquitto.
3. The API ingestion service consumes messages and writes normalized rows.
4. Worker jobs score recent readings and create incidents.
5. The dashboard queries API endpoints and renders the current operating picture.
6. Raw replay inputs are stored in MinIO for reproducibility.

## Free Tooling Constraint

Everything should run locally without paid services.

Allowed:

- Docker Desktop or a compatible local Docker runtime
- Mosquitto
- PostgreSQL/PostGIS
- MinIO
- FastAPI
- SQLAlchemy/Alembic
- scikit-learn
- dbt Core
- Next.js
- Leaflet/OpenStreetMap
- GitHub Actions free tier

Avoid for the first version:

- AWS/GCP/Azure deployment
- paid map providers
- paid observability tools
- required hardware
- paid ESP32 simulators

## Future Embedded Track

After the core platform works, add one optional embedded-style target:

- Zephyr `native_sim` app with RTOS tasks and emulator-backed sensor reads, or
- Wokwi ESP32 demo that publishes sample MQTT telemetry.

This should be treated as a demo extension, not a dependency for the main project.

