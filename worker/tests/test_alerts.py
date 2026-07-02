"""Webhook alert delivery tests (monkeypatched HTTP, no network)."""
from __future__ import annotations

from datetime import UTC

import pytest

from app import alerts

INCIDENT = {
    "incident_key": "INC-000042",
    "severity": "critical",
    "hazard": "wildfire",
    "title": "Wildfire risk near Los Angeles Ridge Node 1",
    "device_id": "edge-ca-001",
    "region": "socal",
    "risk_score": 88,
    "opened_at": "2026-07-02T21:00:00+00:00",
}


def test_disabled_without_url(monkeypatch):
    monkeypatch.delenv("SENTINELGRID_WEBHOOK_URL", raising=False)
    calls = []
    monkeypatch.setattr(alerts, "_post", lambda url, body: calls.append(url) or 200)
    assert alerts.notify_incident(INCIDENT) is False
    assert calls == []


def test_posts_json_incident(monkeypatch):
    import json

    monkeypatch.setenv("SENTINELGRID_WEBHOOK_URL", "https://hooks.example/x")
    monkeypatch.delenv("SENTINELGRID_WEBHOOK_FORMAT", raising=False)
    captured = {}

    def fake_post(url, body):
        captured["url"] = url
        captured["payload"] = json.loads(body)
        return 200

    monkeypatch.setattr(alerts, "_post", fake_post)
    assert alerts.notify_incident(INCIDENT) is True
    assert captured["url"] == "https://hooks.example/x"
    assert captured["payload"]["event"] == "incident.opened"
    assert captured["payload"]["incident_key"] == "INC-000042"
    assert captured["payload"]["risk_score"] == 88


def test_slack_format(monkeypatch):
    import json

    monkeypatch.setenv("SENTINELGRID_WEBHOOK_URL", "https://hooks.slack.com/services/x")
    monkeypatch.setenv("SENTINELGRID_WEBHOOK_FORMAT", "slack")
    captured = {}
    monkeypatch.setattr(
        alerts, "_post", lambda url, body: captured.update(payload=json.loads(body)) or 200
    )
    assert alerts.notify_incident(INCIDENT) is True
    assert set(captured["payload"]) == {"text"}
    text = captured["payload"]["text"]
    assert "INC-000042" in text and "CRITICAL" in text and "edge-ca-001" in text


def test_retries_once_then_succeeds(monkeypatch):
    monkeypatch.setenv("SENTINELGRID_WEBHOOK_URL", "https://hooks.example/x")
    attempts = []

    def flaky_post(url, body):
        attempts.append(1)
        if len(attempts) == 1:
            raise OSError("connection reset")
        return 204

    monkeypatch.setattr(alerts, "_post", flaky_post)
    assert alerts.notify_incident(INCIDENT) is True
    assert len(attempts) == 2


def test_failures_are_swallowed(monkeypatch):
    monkeypatch.setenv("SENTINELGRID_WEBHOOK_URL", "https://hooks.example/x")

    def always_fails(url, body):
        raise OSError("unreachable")

    monkeypatch.setattr(alerts, "_post", always_fails)
    assert alerts.notify_incident(INCIDENT) is False  # never raises


def test_non_2xx_counts_as_failure(monkeypatch):
    monkeypatch.setenv("SENTINELGRID_WEBHOOK_URL", "https://hooks.example/x")
    attempts = []
    monkeypatch.setattr(alerts, "_post", lambda url, body: attempts.append(1) or 500)
    assert alerts.notify_incident(INCIDENT) is False
    assert len(attempts) == alerts.ATTEMPTS


@pytest.mark.parametrize("fmt", ["", "slack"])
def test_payload_serializes_datetimes(monkeypatch, fmt):
    from datetime import datetime

    monkeypatch.setenv("SENTINELGRID_WEBHOOK_URL", "https://hooks.example/x")
    if fmt:
        monkeypatch.setenv("SENTINELGRID_WEBHOOK_FORMAT", fmt)
    else:
        monkeypatch.delenv("SENTINELGRID_WEBHOOK_FORMAT", raising=False)
    monkeypatch.setattr(alerts, "_post", lambda url, body: 200)
    incident = {**INCIDENT, "opened_at": datetime.now(UTC)}
    assert alerts.notify_incident(incident) is True
