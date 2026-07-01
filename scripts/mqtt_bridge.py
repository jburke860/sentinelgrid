#!/usr/bin/env python3
"""Bridge edge-sim NDJSON output into MQTT.

Reads newline-delimited JSON from stdin. Each line must carry a "topic"
field; the full line (minus nothing -- the payload is forwarded as-is) is
published to that topic.

Usage:
    ./edge-sim/build/edge-sim | python scripts/mqtt_bridge.py

Environment:
    MQTT_HOST (default: localhost)
    MQTT_PORT (default: 1883)
"""
from __future__ import annotations

import json
import os
import sys
import time

import paho.mqtt.client as mqtt

MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))


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


def main() -> int:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="sentinelgrid-bridge")
    connect_with_retry(client)
    client.loop_start()

    published = 0
    skipped = 0
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
            client.publish(topic, line, qos=0)
            published += 1
            if published % 500 == 0:
                log(f"published {published} messages")
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()
        log(f"done: published={published} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
