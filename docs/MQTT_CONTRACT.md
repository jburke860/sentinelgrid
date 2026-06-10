# MQTT Contract

## Topic Names

Telemetry:

```text
sentinelgrid/v1/devices/{device_id}/telemetry
```

Device status:

```text
sentinelgrid/v1/devices/{device_id}/status
```

Incident commands:

```text
sentinelgrid/v1/incidents/{incident_id}/commands
```

## Telemetry Payload

```json
{
  "schema_version": "1.0",
  "device_id": "edge-ca-001",
  "timestamp": "2026-06-06T16:45:00Z",
  "location": {
    "lat": 34.0522,
    "lon": -118.2437
  },
  "readings": {
    "temperature_c": 32.4,
    "humidity_pct": 19.2,
    "pm25_ugm3": 41.8,
    "smoke_ppm": 7.1,
    "water_level_m": 1.4,
    "wind_speed_mps": 5.2
  },
  "health": {
    "battery_pct": 78.5,
    "rssi_dbm": -67,
    "uptime_s": 14420,
    "firmware_version": "0.1.0"
  },
  "quality": {
    "sequence": 1042,
    "source": "simulated",
    "flags": []
  }
}
```

## Quality Flags

Use these values consistently:

- `missing_reading`
- `out_of_order`
- `duplicate`
- `sensor_drift`
- `stuck_sensor`
- `gps_jitter`
- `low_battery`
- `weak_signal`
- `offline_recovery`

## Status Payload

```json
{
  "schema_version": "1.0",
  "device_id": "edge-ca-001",
  "timestamp": "2026-06-06T16:45:00Z",
  "state": "online",
  "battery_pct": 78.5,
  "rssi_dbm": -67,
  "firmware_version": "0.1.0"
}
```

