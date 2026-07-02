# Worker

Python jobs for anomaly scoring, incident lifecycle, data-quality checks,
rollups, retention, and raw archival. Runs as a simple loop (`app/main.py`);
no orchestrator required.

## Configuration (env)

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid` | |
| `SCORE_INTERVAL_S` | `10` | seconds between job cycles |
| `SENTINELGRID_MAINTENANCE_INTERVAL_S` | `300` | seconds between maintenance runs |
| `SENTINELGRID_RETENTION_DAYS` | `7` | raw telemetry retention; `0` disables pruning |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` | compose defaults | raw-archive target; archival no-ops if unreachable |
| `SENTINELGRID_LOG_JSON` | `0` | set `1` for JSON-lines logs |
| `SENTINELGRID_IFOREST_MIN_SAMPLES` | `1000` | recent low-risk readings required before the IsolationForest refits on real data |
| `SENTINELGRID_WEBHOOK_URL` | unset | POST newly-opened incidents here (unset = disabled) |
| `SENTINELGRID_WEBHOOK_FORMAT` | raw JSON | set `slack` for Slack incoming-webhook `{"text": ...}` payloads |

Startup retries with backoff until PostgreSQL is reachable.

## Jobs (each cycle)

1. **Scoring** (`app/scoring.py`, model `zscore-baseline` v`0.1`): per-metric
   z-scores against baselines, combined into hazard profiles (wildfire,
   flood, hurricane, heat, tornado, winter_storm, air_quality) as weighted
   sums of `max(0, direction * z)`.
   `risk_score = clamp(round(max_hazard * 16), 0, 100)`; levels: >=75
   critical, >=50 warning, >=25 watch, else normal. Every unscored
   `telemetry_readings` row gets an `anomaly_scores` row with
   `features` = z-scores and `explanation` = `{"hazard": ..., "top": [...]}`.
   - **Learned baselines** (`app/baselines.py`): normal-level readings feed
     per-device/per-metric Welford counters in `device_baselines`; once a
     pair has 300+ samples its learned (mean, std) replaces the hardcoded
     default (std floored at 25% of the default so noise can't look
     critical). Anomalous readings never train the baseline.
   - **Second model** (`app/iforest.py`, `isolation-forest` v`0.2`): an
     IsolationForest scores every reading too; the result (including model
     `provenance`) is stored in `anomaly_scores.model_scores` keyed by model
     name. It bootstraps on synthetic baseline-distributed samples
     (deterministic seed) and is periodically refit on real telemetry by the
     maintenance cycle. z-scores remain the incident driver.
2. **Incidents**: opens an incident (`INC-<zero-padded id>`) when a device has
   >= 2 consecutive warning+ readings and no active (open / acknowledged /
   investigating) incident for that device + hazard; escalates severity to
   critical when the latest reading is critical; auto-resolves active
   incidents after >= 12 consecutive normal readings.
   - **Webhook alerts** (`app/alerts.py`): each newly-opened incident is
     POSTed once to `SENTINELGRID_WEBHOOK_URL` (5s timeout, one retry;
     failures are logged, never break the loop). `SENTINELGRID_WEBHOOK_FORMAT=slack`
     wraps it for Slack incoming webhooks.
3. **Data quality**: flags readings whose per-device `sequence` went backwards
   by appending `out_of_order` to `quality_flags` (recent window).

## Maintenance (every `SENTINELGRID_MAINTENANCE_INTERVAL_S`)

- **Rollups**: upserts hourly per-device avg/min/max into
  `telemetry_rollup_1h` (recent 48h window, idempotent), so raw rows can be
  pruned without losing history.
- **Retention**: deletes raw `telemetry_readings` older than
  `SENTINELGRID_RETENTION_DAYS` (anomaly scores cascade).
- **Archival** (`app/archive.py`): batches unarchived raw payloads (min 100)
  into gzipped NDJSON, uploads to MinIO, and records the object in
  `raw_archives` with a sha256 checksum and id range. No-ops safely when
  MinIO is down.
- **IsolationForest retraining**: samples up to 5000 recent normal/watch
  readings (anomalous ones are excluded so events can't poison the "normal"
  envelope) and refits once `SENTINELGRID_IFOREST_MIN_SAMPLES` are available;
  the model swaps atomically and `model_scores` provenance flips from
  `synthetic` to `learned`.

## Backtesting

`app/backtest.py` replays telemetry (NDJSON file or the DB) through the
models and reports precision/recall/F1 against labeled anomaly windows:

```sh
make backtest                        # checked-in sample under data/
cd worker && .venv/bin/python -m app.backtest --from-db --since-hours 24 \
    --labels my_labels.json --model both
```

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

Scoring, baseline, IsolationForest, backtest, and archive-blob tests are all
pure functions; no services needed.

## Docker

Built by `infra/docker-compose.yml` as the `worker` service.

## Future

- public data replay from saved fixtures
- orchestration (Dagster/Airflow/dbt) once the core loop is stable
