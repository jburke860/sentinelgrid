"""Snapshot shaping tests using fake DB rows (no DB required)."""
from __future__ import annotations

from datetime import datetime, timezone

from app.serialize import epoch_ms, shape_snapshot

OBSERVED = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
OPENED = datetime(2026, 7, 1, 11, 30, 0, tzinfo=timezone.utc)


def device_row(**overrides):
    row = {
        "device_id": "edge-ca-001",
        "display_name": "Los Angeles Ridge Node 1",
        "region": "socal",
        "kind": "ridge",
        "device_lat": 34.0522,
        "device_lon": -118.2437,
        "firmware_version": "0.1.0",
        "status": "online",
        "last_seen_at": OBSERVED,
        "reading_id": 10,
        "observed_at": OBSERVED,
        "reading_lat": 34.052,
        "reading_lon": -118.243,
        "temperature_c": 32.4,
        "humidity_pct": 19.2,
        "pm25_ugm3": 41.8,
        "smoke_ppm": 7.1,
        "water_level_m": 1.4,
        "wind_speed_mps": 5.2,
        "battery_pct": 78.5,
        "rssi_dbm": -67,
        "sequence": 1042,
        "quality_flags": ["low_battery"],
        "risk_score": 62,
        "risk_level": "warning",
    }
    row.update(overrides)
    return row


def incident_row():
    return {
        "id": 1,
        "incident_key": "INC-000001",
        "status": "open",
        "severity": "warning",
        "hazard": "wildfire",
        "title": "Wildfire risk near Los Angeles Ridge Node 1",
        "summary": "Elevated smoke and PM2.5.",
        "opened_at": OPENED,
        "acknowledged_at": None,
        "closed_at": None,
        "incident_lat": 34.0522,
        "incident_lon": -118.2437,
        "primary_device_id": "edge-ca-001",
        "device_name": "Los Angeles Ridge Node 1",
        "region": "socal",
        "risk_score": 62,
    }


def test_snapshot_top_level_shape():
    snap = shape_snapshot([device_row()], [incident_row()], now_ms=1234567890123)
    assert set(snap) == {"simTime", "devices", "incidents", "events"}
    assert snap["simTime"] == 1234567890123
    assert snap["events"] == []


def test_snapshot_device_shape():
    snap = shape_snapshot([device_row()], [], now_ms=0)
    dev = snap["devices"][0]
    assert set(dev) == {
        "deviceId", "displayName", "regionId", "kind", "lat", "lon",
        "firmwareVersion", "status", "lastSeenAt", "latest",
    }
    assert dev["deviceId"] == "edge-ca-001"
    assert dev["regionId"] == "socal"
    assert dev["lastSeenAt"] == epoch_ms(OBSERVED)

    latest = dev["latest"]
    assert set(latest) == {
        "t", "lat", "lon", "values", "batteryPct", "rssiDbm",
        "sequence", "flags", "riskScore", "riskLevel",
    }
    assert set(latest["values"]) == {
        "temperature_c", "humidity_pct", "pm25_ugm3",
        "smoke_ppm", "water_level_m", "wind_speed_mps",
    }
    assert latest["t"] == epoch_ms(OBSERVED)
    assert latest["riskScore"] == 62
    assert latest["riskLevel"] == "warning"
    assert latest["flags"] == ["low_battery"]


def test_snapshot_device_without_readings_has_null_latest():
    row = device_row(
        reading_id=None, observed_at=None, last_seen_at=None,
        risk_score=None, risk_level=None,
    )
    dev = shape_snapshot([row], [], now_ms=0)["devices"][0]
    assert dev["latest"] is None
    assert dev["lastSeenAt"] is None


def test_snapshot_risk_defaults_when_unscored():
    row = device_row(risk_score=None, risk_level=None)
    latest = shape_snapshot([row], [], now_ms=0)["devices"][0]["latest"]
    assert latest["riskScore"] == 0
    assert latest["riskLevel"] == "normal"


def test_snapshot_incident_shape():
    snap = shape_snapshot([], [incident_row()], now_ms=0)
    inc = snap["incidents"][0]
    assert set(inc) == {
        "id", "incidentKey", "status", "severity", "hazard", "title", "summary",
        "openedAt", "acknowledgedAt", "closedAt", "lat", "lon",
        "deviceId", "deviceName", "regionId", "riskScore",
    }
    assert inc["incidentKey"] == "INC-000001"
    assert inc["hazard"] == "wildfire"
    assert inc["openedAt"] == epoch_ms(OPENED)
    assert inc["acknowledgedAt"] is None
    assert inc["closedAt"] is None
