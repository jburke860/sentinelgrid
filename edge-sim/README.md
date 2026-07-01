# Edge Simulator

`edge-sim` is a self-contained C++ fleet simulator. It loads the device list
from `db/seeds/devices.json` and emits one NDJSON telemetry line per device
per cycle on stdout. Each line matches `docs/MQTT_CONTRACT.md` exactly, plus
an extra `topic` field (`sentinelgrid/v1/devices/{device_id}/telemetry`) so a
downstream bridge can publish it to MQTT directly.

No external libraries: the devices file is read with a minimal hand-rolled
JSON parser that covers the flat array format of `devices.json`.

## Build

```sh
cmake -S edge-sim -B edge-sim/build
cmake --build edge-sim/build
```

## Run

```sh
./edge-sim/build/edge-sim [flags]
```

Flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed <int>` | `42` | Deterministic RNG seed. Same seed = same value stream. |
| `--interval-ms <int>` | `2000` | Delay between emit cycles in milliseconds. |
| `--count <int>` | `0` | Number of cycles to emit. `0` = run forever. |
| `--devices <path>` | `db/seeds/devices.json` | Path to the device seed file. |

Examples:

```sh
# Two quick cycles for a smoke test
./edge-sim/build/edge-sim --count 2 --interval-ms 100

# Infinite run piped into the MQTT bridge
./edge-sim/build/edge-sim | python scripts/mqtt_bridge.py
```

## Simulated behavior

- Per-device deterministic RNG streams derived from `--seed`.
- Battery drains slowly over time; `low_battery` flag below 20%.
- RSSI wobbles around a per-device base; `weak_signal` flag below -85 dBm.
- Occasional `gps_jitter` flag (~2% of readings) with a larger position offset.
- Device `kind` biases readings slightly (coastal = windier, wash/coastal =
  higher water level).
- Monotonic `sequence` and `uptime_s` per device.

Diagnostics go to stderr; stdout carries only NDJSON.

## Future behavior

- replay public environmental data
- Zephyr `native_sim` target
- Wokwi ESP32 demo
