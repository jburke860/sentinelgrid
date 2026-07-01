.PHONY: check edge-build edge-run infra-config infra-up infra-down \
	api-run worker-run bridge-run stack-up stack-down api-test worker-test

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

