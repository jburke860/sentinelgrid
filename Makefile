.PHONY: check edge-build edge-run infra-config infra-up infra-down \
	api-run worker-run bridge-run stack-up stack-down api-test worker-test \
	db-upgrade db-revision db-stamp backtest mosquitto-passwd lint loadtest

check:
	sh scripts/dev-check.sh

edge-build:
	cmake -S edge-sim -B edge-sim/build
	cmake --build edge-sim/build

edge-run: edge-build
	./edge-sim/build/edge-sim

infra-config:
	docker compose -f infra/docker-compose.yml config

infra-up:
	docker compose -f infra/docker-compose.yml up -d

infra-down:
	docker compose -f infra/docker-compose.yml down

api-run:
	cd api && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker-run:
	cd worker && .venv/bin/python -m app.main

bridge-run: edge-build
	./edge-sim/build/edge-sim | api/.venv/bin/python scripts/mqtt_bridge.py

stack-up:
	docker compose -f infra/docker-compose.yml up -d --build

stack-down:
	docker compose -f infra/docker-compose.yml down

api-test:
	cd api && .venv/bin/python -m pytest

worker-test:
	cd worker && .venv/bin/python -m pytest

# --- database migrations (alembic; DSN from DATABASE_URL) -------------------

db-upgrade:
	api/.venv/bin/alembic -c db/alembic.ini upgrade head

# Mark an existing init-script-bootstrapped database as baseline (run once).
db-stamp:
	api/.venv/bin/alembic -c db/alembic.ini stamp 0001

# usage: make db-revision m="add foo table"
db-revision:
	api/.venv/bin/alembic -c db/alembic.ini revision -m "$(m)"

# --- worker extras -----------------------------------------------------------

backtest:
	cd worker && .venv/bin/python -m app.backtest \
		--input data/sample_readings.ndjson --labels data/sample_labels.json

# Regenerate the mosquitto password hash (dev creds sentinelgrid/sentinelgrid).
mosquitto-passwd:
	docker run --rm --entrypoint sh eclipse-mosquitto:2 -c \
		'touch /tmp/passwd && chmod 700 /tmp/passwd && mosquitto_passwd -b /tmp/passwd sentinelgrid sentinelgrid && cat /tmp/passwd' \
		| tail -1 > infra/mosquitto/passwd
	chmod 600 infra/mosquitto/passwd

lint:
	ruff check api/app api/tests worker/app worker/tests scripts

# Requires k6 (https://k6.io). Override target/API key via env:
#   API_URL=http://localhost:8000 SENTINELGRID_API_KEY=... make loadtest
loadtest:
	k6 run scripts/loadtest.k6.js
