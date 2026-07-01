"""Pydantic models for the MQTT/HTTP telemetry contract and API bodies.

See docs/MQTT_CONTRACT.md.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ALLOWED_QUALITY_FLAGS = {
    "missing_reading",
    "out_of_order",
    "duplicate",
    "sensor_drift",
    "stuck_sensor",
    "gps_jitter",
    "low_battery",
    "weak_signal",
    "offline_recovery",
}


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Readings(BaseModel):
    temperature_c: float | None = None
    humidity_pct: float | None = None
    pm25_ugm3: float | None = None
    smoke_ppm: float | None = None
    water_level_m: float | None = None
    wind_speed_mps: float | None = None


class Health(BaseModel):
    battery_pct: float = Field(ge=0, le=100)
    rssi_dbm: float
    uptime_s: int = Field(ge=0)
    firmware_version: str


class Quality(BaseModel):
    sequence: int = Field(ge=0)
    source: str
    flags: list[str] = Field(default_factory=list)


class TelemetryPayload(BaseModel):
    # The edge-sim adds a "topic" field on top of the contract; allow extras
    # so bridged lines validate without stripping.
    model_config = ConfigDict(extra="allow")

    schema_version: Literal["1.0"]
    device_id: str = Field(min_length=1)
    timestamp: datetime
    location: Location
    readings: Readings
    health: Health
    quality: Quality


class IncidentAction(BaseModel):
    action: Literal["acknowledge", "investigate", "resolve", "dismiss"]
