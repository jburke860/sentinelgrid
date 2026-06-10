# SentinelGrid

SentinelGrid is a local-first edge telemetry platform for climate-risk monitoring. It uses virtual sensor nodes instead of physical hardware, then builds the same kind of software surface a real system would need: MQTT ingestion, geospatial storage, anomaly scoring, data-quality checks, and an operator dashboard.

The project is intentionally designed around free tools:

- C++ edge-device simulator
- MQTT with Mosquitto
- FastAPI backend
- PostgreSQL with PostGIS
- MinIO for S3-compatible local object storage
- Python worker jobs for replay, scoring, and data quality
- Next.js dashboard with Leaflet/OpenStreetMap and charts
- Docker Compose for local development
- GitHub Actions for CI

## Repository Layout

```text
sentinelgrid/
  edge-sim/        C++ virtual edge-device publisher
  api/             FastAPI ingestion and query API
  worker/          replay, anomaly scoring, and data-quality jobs
  web/             Next.js dashboard
  infra/           Docker Compose, Mosquitto, Postgres, MinIO config
  db/              migrations and seed data
  docs/            architecture and design notes
  scripts/         developer helper scripts
```

## Architecture

```text
Virtual sensor nodes
  edge-sim C++
      |
      | MQTT: sentinelgrid/v1/devices/{device_id}/telemetry
      v
Mosquitto broker
      |
      v
FastAPI ingest API  ---> PostgreSQL/PostGIS
      |                       ^
      v                       |
Worker jobs ------------------+
      |
      v
MinIO raw archives

Next.js dashboard ---> FastAPI query endpoints ---> PostgreSQL/PostGIS
```

## First Milestone

The first useful version should do this:

1. Run the local infrastructure with Docker Compose.
2. Publish synthetic telemetry from `edge-sim`.
3. Ingest telemetry into Postgres/PostGIS.
4. Score basic anomalies in the worker.
5. Show devices, incidents, and time-series data in the dashboard.

## Local Commands

```sh
make check
make edge-run
make infra-config
make infra-up
```

`make infra-up` starts only free local services. It does not create any cloud resources.

## Resume Positioning

Use honest wording:

> Built a local-first edge telemetry platform using C++ virtual sensor nodes, MQTT, FastAPI, PostgreSQL/PostGIS, Python anomaly scoring, Docker Compose, and a Next.js geospatial dashboard.

Avoid claiming physical sensor integration unless real hardware is added later.
