"""Integration tests that need a live PostgreSQL. Skip cleanly when absent.

Run the stack first: make stack-up (or docker compose -f infra/docker-compose.yml up -d)
"""
from __future__ import annotations

import os

import pytest

psycopg = pytest.importorskip("psycopg")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid"
).replace("postgresql+psycopg://", "postgresql://", 1)


def _db_available() -> bool:
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=2) as conn:
            conn.execute("select 1")
        return True
    except Exception:  # noqa: BLE001
        return False


pytestmark = pytest.mark.skipif(
    not _db_available(), reason="PostgreSQL is not reachable; start the stack to run"
)


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MQTT_INGEST_ENABLED", "0")
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        # wait for the background pool open
        import time

        from app import db

        for _ in range(50):
            if db.pool_ready():
                break
            time.sleep(0.1)
        yield test_client


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_ingest_then_snapshot(client):
    from tests.test_validation import VALID_PAYLOAD

    res = client.post("/ingest/telemetry", json=VALID_PAYLOAD)
    assert res.status_code == 202, res.text
    assert res.json()["readingId"] > 0

    snap = client.get("/snapshot").json()
    assert set(snap) == {"simTime", "devices", "incidents", "events"}
    device = next(d for d in snap["devices"] if d["deviceId"] == "edge-ca-001")
    assert device["latest"] is not None
    assert device["latest"]["values"]["temperature_c"] is not None


def test_device_timeseries(client):
    res = client.get("/devices/edge-ca-001/telemetry", params={"limit": 5})
    assert res.status_code == 200
    body = res.json()
    assert body["deviceId"] == "edge-ca-001"
    assert isinstance(body["points"], list)


def test_unknown_device_404(client):
    assert client.get("/devices/nope/telemetry").status_code == 404
