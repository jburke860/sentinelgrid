"""Pure shaping helpers: DB rows -> camelCase JSON structures.

Kept free of DB imports so the dashboard payload shape is unit-testable.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def epoch_ms(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp() * 1000)


def shape_latest(row: dict[str, Any]) -> dict[str, Any] | None:
    """Shape the latest-reading block of a device row (None if no readings)."""
    if row.get("reading_id") is None:
        return None
    return {
        "t": epoch_ms(row["observed_at"]),
        "lat": row["reading_lat"],
        "lon": row["reading_lon"],
        "values": {
            "temperature_c": row["temperature_c"],
            "humidity_pct": row["humidity_pct"],
            "pm25_ugm3": row["pm25_ugm3"],
            "smoke_ppm": row["smoke_ppm"],
            "water_level_m": row["water_level_m"],
            "wind_speed_mps": row["wind_speed_mps"],
        },
        "batteryPct": row["battery_pct"],
        "rssiDbm": row["rssi_dbm"],
        "sequence": row["sequence"],
        "flags": list(row["quality_flags"] or []),
        "riskScore": row["risk_score"] if row.get("risk_score") is not None else 0,
        "riskLevel": row["risk_level"] if row.get("risk_level") is not None else "normal",
    }


def shape_device(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "deviceId": row["device_id"],
        "displayName": row["display_name"],
        "regionId": row["region"],
        "kind": row["kind"],
        "lat": row["device_lat"],
        "lon": row["device_lon"],
        "firmwareVersion": row["firmware_version"],
        "status": row["status"],
        "lastSeenAt": epoch_ms(row["last_seen_at"]),
        "latest": shape_latest(row),
    }


def shape_incident(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "incidentKey": row["incident_key"],
        "status": row["status"],
        "severity": row["severity"],
        "hazard": row["hazard"],
        "title": row["title"],
        "summary": row["summary"],
        "openedAt": epoch_ms(row["opened_at"]),
        "acknowledgedAt": epoch_ms(row["acknowledged_at"]),
        "closedAt": epoch_ms(row["closed_at"]),
        "lat": row["incident_lat"],
        "lon": row["incident_lon"],
        "deviceId": row["primary_device_id"],
        "deviceName": row["device_name"],
        "regionId": row["region"],
        "riskScore": row["risk_score"],
    }


def shape_snapshot(
    device_rows: list[dict[str, Any]],
    incident_rows: list[dict[str, Any]],
    now_ms: int,
) -> dict[str, Any]:
    return {
        "simTime": now_ms,
        "devices": [shape_device(r) for r in device_rows],
        "incidents": [shape_incident(r) for r in incident_rows],
        "events": [],
    }
