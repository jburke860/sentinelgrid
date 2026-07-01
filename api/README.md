# API

FastAPI service for telemetry ingestion and dashboard queries. Raw SQL via
psycopg 3 with a small connection pool; no ORM.

## Configuration (env)

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid` | SQLAlchemy-style `postgresql+psycopg://` also accepted |
| `MQTT_HOST` | `localhost` | broker for the background ingest thread |
| `MQTT_PORT` | `1883` | |
| `MQTT_INGEST_ENABLED` | `1` | set `0` to disable the MQTT subscriber (tests) |

Startup is resilient: if PostgreSQL or Mosquitto are down the service still
boots, logs, and retries with backoff. DB-backed endpoints return `503` until
the pool is ready.

## Ingestion paths

- MQTT: background thread subscribed to `sentinelgrid/v1/devices/+/telemetry`;
  payloads are validated against `docs/MQTT_CONTRACT.md`, the device row's
  `last_seen_at`/`status` is upserted, and the reading (including the full raw
  JSON) is inserted into `telemetry_readings`.
- HTTP: `POST /ingest/telemetry` with the same payload, for test clients.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | liveness + DB pool state |
| POST | `/ingest/telemetry` | ingest one telemetry payload (202) |
| GET | `/devices` | devices joined with latest reading + latest anomaly score |
| GET | `/devices/{device_id}/telemetry?since=<iso>&limit=` | time series (chronological) |
| GET | `/incidents?status=` | incident list, optionally filtered |
| PATCH | `/incidents/{id}` | body `{"action": "acknowledge"\|"investigate"\|"resolve"\|"dismiss"}` |
| GET | `/snapshot` | one-call dashboard payload (camelCase, epoch-ms timestamps) |

Incident lifecycle: `open -> acknowledged -> investigating -> resolved/dismissed`
(`investigate` from open or acknowledged; `resolve`/`dismiss` from any active
status). Invalid transitions return `409`.

OpenAPI docs at `http://localhost:8000/docs`.

## Run locally

```sh
python3 -m venv api/.venv
api/.venv/bin/pip install -r api/requirements.txt
make api-run          # uvicorn app.main:app --reload on :8000
```

## Tests

```sh
make api-test
```

Unit tests (payload validation, snapshot shaping) run without services.
`tests/test_integration_db.py` skips cleanly unless PostgreSQL is reachable.

## Docker

Built by `infra/docker-compose.yml` as the `api` service (port 8000).
