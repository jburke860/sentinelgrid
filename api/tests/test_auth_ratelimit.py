"""API-key auth, rate limiting, and /metrics tests (no DB required)."""
from __future__ import annotations

import pytest


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MQTT_INGEST_ENABLED", "0")
    from fastapi.testclient import TestClient

    from app import ratelimit
    from app.main import app

    ratelimit.reset()
    with TestClient(app) as test_client:
        yield test_client
    ratelimit.reset()


def test_health_open_without_key(client, monkeypatch):
    monkeypatch.setenv("SENTINELGRID_API_KEY", "secret")
    assert client.get("/health").status_code == 200


def test_write_requires_key_when_configured(client, monkeypatch):
    monkeypatch.setenv("SENTINELGRID_API_KEY", "secret")
    res = client.post("/ingest/telemetry", json={})
    assert res.status_code == 401
    res = client.patch("/incidents/1", json={"action": "acknowledge"})
    assert res.status_code == 401


def test_wrong_key_rejected(client, monkeypatch):
    monkeypatch.setenv("SENTINELGRID_API_KEY", "secret")
    res = client.post("/ingest/telemetry", json={}, headers={"X-API-Key": "nope"})
    assert res.status_code == 401


def test_correct_key_passes_auth_layer(client, monkeypatch):
    monkeypatch.setenv("SENTINELGRID_API_KEY", "secret")
    # Invalid body + valid key: auth passes, validation rejects with 422.
    res = client.post("/ingest/telemetry", json={}, headers={"X-API-Key": "secret"})
    assert res.status_code == 422


def test_no_key_configured_means_open(client, monkeypatch):
    monkeypatch.delenv("SENTINELGRID_API_KEY", raising=False)
    res = client.post("/ingest/telemetry", json={})
    assert res.status_code == 422  # straight to validation, no 401


def test_rate_limit_kicks_in(client, monkeypatch):
    monkeypatch.setenv("SENTINELGRID_RATE_LIMIT_PER_MIN", "3")
    statuses = [client.get("/snapshot").status_code for _ in range(5)]
    assert statuses.count(429) >= 2
    assert 429 not in statuses[:3]


def test_health_exempt_from_rate_limit(client, monkeypatch):
    monkeypatch.setenv("SENTINELGRID_RATE_LIMIT_PER_MIN", "1")
    statuses = [client.get("/health").status_code for _ in range(5)]
    assert statuses == [200] * 5


def test_metrics_endpoint(client):
    res = client.get("/metrics")
    assert res.status_code == 200
    assert "sentinelgrid_http_requests_total" in res.text
