# API

FastAPI service for telemetry ingestion and dashboard queries.

Planned endpoint groups:

- `/health`
- `/v1/telemetry`
- `/v1/devices`
- `/v1/incidents`
- `/v1/timeseries`

The first implementation can accept direct HTTP telemetry before the MQTT consumer is wired in. That makes local testing easier.

