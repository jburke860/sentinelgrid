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
| `MQTT_USERNAME` / `MQTT_PASSWORD` | unset | broker credentials (compose sets the dev user) |
| `SENTINELGRID_API_KEY` | unset | when set, write endpoints require `X-API-Key` |
| `SENTINELGRID_RATE_LIMIT_PER_MIN` | `600` | per-client-IP sliding window; `0` disables; `/health` exempt |
| `SENTINELGRID_STREAM_INTERVAL_S` | `2.0` | SSE snapshot cadence |
| `SENTINELGRID_LOG_JSON` | `0` | set `1` for JSON-lines logs |

Startup is resilient: if PostgreSQL or Mosquitto are down the service still
boots, logs, and retries with backoff. DB-backed endpoints return `503` until
the pool is ready.

## Ingestion paths

- MQTT: background thread subscribed to `sentinelgrid/v1/devices/+/telemetry`;
  payloads are validated against `docs/MQTT_CONTRACT.md`, the device row's
  `last_seen_at`/`status` is upserted, and the reading (including the full raw
  JSON) is inserted into `telemetry_readings`.
- HTTP: `POST /ingest/telemetry` with the same payload, for test clients.

The same thread also consumes retained device status messages
(`sentinelgrid/v1/devices/+/status` → `devices.status`), marks the fleet
offline when the bridge's Last Will fires (`sentinelgrid/v1/fleet/status`),
and publishes operator actions to
`sentinelgrid/v1/incidents/{id}/commands` after a `PATCH /incidents/{id}`.

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
| GET | `/stream` | Server-Sent Events: `snapshot` event every ~2s |
| GET | `/metrics` | Prometheus metrics (ingest counters, HTTP counts, scoring lag) |

Incident lifecycle: `open -> acknowledged -> investigating -> resolved/dismissed`
(`investigate` from open or acknowledged; `resolve`/`dismiss` from any active
status). Invalid transitions return `409`. With `SENTINELGRID_API_KEY` set,
`POST /ingest/telemetry` and `PATCH /incidents/{id}` return `401` without a
matching `X-API-Key` header.

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
