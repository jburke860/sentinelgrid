.PHONY: check edge-build edge-run infra-config infra-up infra-down

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

