#!/usr/bin/env python3
"""Bridge edge-sim NDJSON output into MQTT.

Reads newline-delimited JSON from stdin. Each line must carry a "topic"
field; the full line (minus nothing -- the payload is forwarded as-is) is
published to that topic.

Device presence (docs/MQTT_CONTRACT.md):
- a retained "online" status is published to
  sentinelgrid/v1/devices/{id}/status the first time a device is seen;
- retained "offline" statuses are published for all seen devices on clean
  exit;
- a Last Will on sentinelgrid/v1/fleet/status marks the whole fleet offline
  if the bridge dies uncleanly.

Usage:
    ./edge-sim/build/edge-sim | python scripts/mqtt_bridge.py

Environment:
    MQTT_HOST (default: localhost)
    MQTT_PORT (default: 1883)
    MQTT_USERNAME / MQTT_PASSWORD (default: sentinelgrid / sentinelgrid,
        matching infra/mosquitto/passwd; set empty to connect anonymously)
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import UTC, datetime

import paho.mqtt.client as mqtt

MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USERNAME = os.environ.get("MQTT_USERNAME", "sentinelgrid")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "sentinelgrid")

FLEET_STATUS_TOPIC = "sentinelgrid/v1/fleet/status"
DEVICE_STATUS_TOPIC_FMT = "sentinelgrid/v1/devices/{device_id}/status"


def log(msg: str) -> None:
    print(f"mqtt-bridge: {msg}", file=sys.stderr, flush=True)


def connect_with_retry(client: mqtt.Client) -> None:
    delay = 1.0
    while True:
        try:
            client.connect(MQTT_HOST, MQTT_PORT)
            log(f"connected to {MQTT_HOST}:{MQTT_PORT}")
            return
        except OSError as exc:
            log(f"connect to {MQTT_HOST}:{MQTT_PORT} failed ({exc}); retrying in {delay:.0f}s")
            time.sleep(delay)
            delay = min(delay * 2, 30.0)


def status_payload(device_id: str, state: str) -> str:
    return json.dumps(
        {
            "schema_version": "1.0",
            "device_id": device_id,
            "timestamp": datetime.now(UTC).isoformat(),
            "state": state,
        }
    )


def main() -> int:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="sentinelgrid-bridge")
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    # LWT: if the bridge dies without a clean shutdown, the broker announces
    # the whole simulated fleet as offline.
    client.will_set(FLEET_STATUS_TOPIC, "offline", qos=1, retain=True)
    connect_with_retry(client)
    client.loop_start()
    client.publish(FLEET_STATUS_TOPIC, "online", qos=1, retain=True)

    published = 0
    skipped = 0
    seen_devices: set[str] = set()
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                log(f"skipping non-JSON line: {line[:120]}")
                continue
            topic = payload.get("topic")
            if not isinstance(topic, str) or not topic:
                skipped += 1
                log("skipping line without a topic field")
                continue
            device_id = payload.get("device_id")
            if isinstance(device_id, str) and device_id not in seen_devices:
                seen_devices.add(device_id)
                client.publish(
                    DEVICE_STATUS_TOPIC_FMT.format(device_id=device_id),
                    status_payload(device_id, "online"),
                    qos=1, retain=True,
                )
            client.publish(topic, line, qos=0)
            published += 1
            if published % 500 == 0:
                log(f"published {published} messages")
    except KeyboardInterrupt:
        pass
    finally:
        # Clean shutdown: mark every seen device (and the fleet) offline.
        for device_id in sorted(seen_devices):
            client.publish(
                DEVICE_STATUS_TOPIC_FMT.format(device_id=device_id),
                status_payload(device_id, "offline"),
                qos=1, retain=True,
            )
        client.publish(FLEET_STATUS_TOPIC, "offline", qos=1, retain=True)
        time.sleep(0.5)  # let queued publishes flush
        client.loop_stop()
        client.disconnect()
        log(f"done: published={published} skipped={skipped} devices={len(seen_devices)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
