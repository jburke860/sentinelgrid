# Worker

Python jobs for anomaly scoring, incident lifecycle, and data-quality checks.
Runs as a simple loop (`app/main.py`); no orchestrator required.

## Configuration (env)

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid` | |
| `SCORE_INTERVAL_S` | `10` | seconds between job cycles |

Startup retries with backoff until PostgreSQL is reachable.

## Jobs (each cycle)

1. **Scoring** (`app/scoring.py`, model `zscore-baseline` v`0.1`): per-metric
   z-scores against fixed baselines (temp 30/3.5, humidity 28/8, pm25 16/6,
   smoke 2/1, water 1.2/0.15, wind 4.5/1.2), combined into hazard profiles
   (wildfire, flood, hurricane, heat, tornado, winter_storm, air_quality) as
   weighted sums of `max(0, direction * z)`.
   `risk_score = clamp(round(max_hazard * 16), 0, 100)`; levels: >=75
   critical, >=50 warning, >=25 watch, else normal. Every unscored
   `telemetry_readings` row gets an `anomaly_scores` row with
   `features` = z-scores and `explanation` = `{"hazard": ..., "top": [...]}`.
2. **Incidents**: opens an incident (`INC-<zero-padded id>`) when a device has
   >= 2 consecutive warning+ readings and no active (open / acknowledged /
   investigating) incident for that device + hazard; escalates severity to
   critical when the latest reading is critical; auto-resolves active
   incidents after >= 12 consecutive normal readings.
3. **Data quality**: flags readings whose per-device `sequence` went backwards
   by appending `out_of_order` to `quality_flags` (recent window).

## Run locally

```sh
python3 -m venv worker/.venv
worker/.venv/bin/pip install -r worker/requirements.txt
make worker-run
```

## Tests

```sh
make worker-test
```

Scoring tests are pure functions; no services needed.

## Docker

Built by `infra/docker-compose.yml` as the `worker` service.

## Future

- public data replay from saved fixtures
- raw data archiving to MinIO (`raw_archives`)
- orchestration (Dagster/Airflow/dbt) once the core loop is stable
