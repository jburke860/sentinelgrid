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

## Two Ways to Run It

**Hosted demo (sim mode).** `web/` is the operator dashboard, deployable as a
static site with zero backend: a deterministic in-browser engine simulates 50
virtual nodes across 9 US regions, scores anomalies with the same z-score
model as the worker, and drives the incident queue. Baselines can anchor to
real NWS/USGS observations baked in at build time and refreshed daily by CI.

```sh
cd web
npm install
npm run dev        # local dev at http://localhost:3000
npm run build      # static export in web/out/ — deploy to any static host
```

See `web/README.md` for deployment options (Vercel, Netlify, GitHub Pages, or
a subpath of an existing site via `NEXT_PUBLIC_BASE_PATH`).

**Full local stack (live mode).** The real pipeline: the C++ `edge-sim` fleet
publisher → MQTT bridge → Mosquitto → FastAPI ingest → Postgres/PostGIS →
Python worker scoring/incidents → the same dashboard pointed at the API.

```sh
make stack-up      # postgres + mosquitto + minio + api (:8000) + worker
make bridge-run    # edge-sim fleet publisher piped into the MQTT bridge
# dashboard against the live API:
cd web && NEXT_PUBLIC_DATA_MODE=live NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

API docs at http://localhost:8000/docs. `make stack-down` to stop.

## Fleet

50 virtual nodes in 9 regions (Southern California, Pacific Northwest, Desert
Southwest, Colorado Front Range, Gulf Coast, Florida Peninsula, Mississippi
Valley, Southern Plains, Northeast Corridor), each with region-appropriate
hazard profiles: wildfire, flood, hurricane, extreme heat, tornado, winter
storm, air quality. Devices are seeded from `db/seeds/devices.json`, which is
the shared source of truth for the browser sim, the C++ publisher, and the
database.

## Local Commands

```sh
make check
make edge-run          # build and run the C++ fleet publisher (stdout NDJSON)
make infra-up          # infra only: postgres, mosquitto, minio
make stack-up          # infra + api + worker
make bridge-run        # edge-sim | scripts/mqtt_bridge.py
make api-test          # api unit tests
make worker-test       # worker unit tests (scoring model)
```

`make infra-up`/`make stack-up` start only free local services. Nothing here
creates cloud resources.

