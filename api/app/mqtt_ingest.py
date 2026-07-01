"""Background MQTT ingest: subscribes to telemetry and writes to PostgreSQL.

Runs in a daemon thread. Never crashes the API process: broker connection
failures retry with backoff, and per-message errors are logged and dropped.
"""
from __future__ import annotations

import json
import logging
import threading
import time

import paho.mqtt.client as mqtt
from pydantic import ValidationError

from . import config, db
from .ingest import store_telemetry
from .schemas import TelemetryPayload

log = logging.getLogger("sentinelgrid.mqtt")

TELEMETRY_TOPIC = "sentinelgrid/v1/devices/+/telemetry"

_stop = threading.Event()


def _on_connect(client: mqtt.Client, _userdata, _flags, reason_code, _props=None) -> None:
    if reason_code == 0:
        log.info("connected to mqtt broker; subscribing to %s", TELEMETRY_TOPIC)
        client.subscribe(TELEMETRY_TOPIC, qos=0)
    else:
        log.warning("mqtt connect failed: %s", reason_code)


def _on_message(_client, _userdata, msg: mqtt.MQTTMessage) -> None:
    try:
        payload = TelemetryPayload.model_validate(json.loads(msg.payload))
    except (ValidationError, ValueError) as exc:
        log.warning("dropping invalid telemetry on %s: %s", msg.topic, exc)
        return
    try:
        store_telemetry(db.get_pool(), payload)
    except Exception as exc:  # noqa: BLE001 - DB may be down; drop and continue
        log.warning("failed to store telemetry from %s: %s", payload.device_id, exc)


def _run() -> None:
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2, client_id="sentinelgrid-api-ingest"
    )
    client.on_connect = _on_connect
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    delay = 1.0
    while not _stop.is_set():
        try:
            client.connect(config.mqtt_host(), config.mqtt_port())
            break
        except OSError as exc:
            log.warning(
                "mqtt broker %s:%s unreachable (%s); retrying in %.0fs",
                config.mqtt_host(), config.mqtt_port(), exc, delay,
            )
            if _stop.wait(delay):
                return
            delay = min(delay * 2, 30.0)

    # loop_forever handles reconnects after the first successful connect.
    while not _stop.is_set():
        try:
            client.loop_forever(retry_first_connection=True)
            return
        except Exception as exc:  # noqa: BLE001
            log.warning("mqtt loop error (%s); restarting in 5s", exc)
            if _stop.wait(5.0):
                return


def start_background_ingest() -> None:
    _stop.clear()
    threading.Thread(target=_run, name="mqtt-ingest", daemon=True).start()


def stop_background_ingest() -> None:
    _stop.set()
