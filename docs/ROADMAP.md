# Roadmap

## Milestone 0: Architecture Skeleton

- Create project structure.
- Document architecture and contracts.
- Add local-only Docker Compose.
- Add starter service files.

## Milestone 1: Local Telemetry Loop

- Run Mosquitto and Postgres locally.
- Publish telemetry from the C++ simulator.
- Consume MQTT messages.
- Insert validated readings into Postgres.
- Add one API endpoint for latest device state.

## Milestone 2: Operator Dashboard

- Show devices on a Leaflet map.
- Add device health table.
- Add selected-device time-series chart.
- Add incident queue.

## Milestone 3: Anomaly Scoring

- Add threshold-based risk scoring.
- Detect missing data, stuck sensors, low battery, weak signal, and extreme readings.
- Persist scores and incidents.
- Add tests for scoring scenarios.

## Milestone 4: Public Data Replay

- Pull or import public weather, water, air-quality, and fire datasets.
- Archive raw source data in MinIO.
- Replay selected regions as virtual edge telemetry.
- Document source limitations and update cadence.

## Milestone 5: Portfolio Polish

- Add screenshots and demo GIF.
- Add benchmark numbers.
- Add GitHub Actions CI.
- Add a clean project page for the personal website.

