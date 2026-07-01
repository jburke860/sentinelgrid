"""Telemetry payload validation tests (no DB required)."""
from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from app.schemas import TelemetryPayload

VALID_PAYLOAD = {
    "topic": "sentinelgrid/v1/devices/edge-ca-001/telemetry",
    "schema_version": "1.0",
    "device_id": "edge-ca-001",
    "timestamp": "2026-06-06T16:45:00Z",
    "location": {"lat": 34.0522, "lon": -118.2437},
    "readings": {
        "temperature_c": 32.4,
        "humidity_pct": 19.2,
        "pm25_ugm3": 41.8,
        "smoke_ppm": 7.1,
        "water_level_m": 1.4,
        "wind_speed_mps": 5.2,
    },
    "health": {
        "battery_pct": 78.5,
        "rssi_dbm": -67,
        "uptime_s": 14420,
        "firmware_version": "0.1.0",
    },
    "quality": {"sequence": 1042, "source": "simulated", "flags": []},
}


def test_valid_payload_parses():
    payload = TelemetryPayload.model_validate(VALID_PAYLOAD)
    assert payload.device_id == "edge-ca-001"
    assert payload.location.lat == pytest.approx(34.0522)
    assert payload.quality.sequence == 1042
    assert payload.readings.smoke_ppm == pytest.approx(7.1)


def test_topic_field_is_tolerated():
    payload = TelemetryPayload.model_validate(VALID_PAYLOAD)
    # extra="allow" keeps the bridged topic without breaking the contract
    assert payload.model_extra.get("topic", "").endswith("/telemetry")


def test_payload_without_topic_is_valid():
    data = copy.deepcopy(VALID_PAYLOAD)
    del data["topic"]
    TelemetryPayload.model_validate(data)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.pop("device_id"),
        lambda d: d.pop("timestamp"),
        lambda d: d.pop("location"),
        lambda d: d.__setitem__("schema_version", "2.0"),
        lambda d: d.__setitem__("timestamp", "not-a-date"),
        lambda d: d["location"].__setitem__("lat", 123.0),
        lambda d: d["health"].__setitem__("battery_pct", 140),
        lambda d: d["quality"].__setitem__("sequence", -1),
        lambda d: d.__setitem__("device_id", ""),
    ],
)
def test_invalid_payloads_rejected(mutate):
    data = copy.deepcopy(VALID_PAYLOAD)
    mutate(data)
    with pytest.raises(ValidationError):
        TelemetryPayload.model_validate(data)


def test_missing_readings_are_allowed_as_null():
    data = copy.deepcopy(VALID_PAYLOAD)
    data["readings"] = {"temperature_c": 30.1}
    payload = TelemetryPayload.model_validate(data)
    assert payload.readings.water_level_m is None
