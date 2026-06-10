#!/usr/bin/env sh
set -eu

echo "Checking SentinelGrid project skeleton..."
test -f README.md
test -f docs/ARCHITECTURE.md
test -f docs/MQTT_CONTRACT.md
test -f infra/docker-compose.yml
test -f infra/db/init/001_extensions.sql
test -f infra/db/init/002_schema.sql
test -f infra/db/init/003_seed_devices.sql
test -f edge-sim/CMakeLists.txt
test -f api/app/main.py
test -f worker/jobs/score_anomalies.py
echo "Skeleton looks complete."
