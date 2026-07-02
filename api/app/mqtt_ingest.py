"""Background MQTT ingest: subscribes to telemetry and writes to PostgreSQL.

Runs in a daemon thread. Never crashes the API process: broker connection
failures retry with backoff, and per-message errors are logged and dropped.
Also handles retained device status messages (online/offline) and publishes
incident commands back to devices (docs/MQTT_CONTRACT.md).
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import UTC, datetime

import paho.mqtt.client as mqtt
from pydantic import ValidationError

from . import config, db, metrics
from .ingest import store_telemetry
from .schemas import TelemetryPayload

log = logging.getLogger("sentinelgrid.mqtt")

TELEMETRY_TOPIC = "sentinelgrid/v1/devices/+/telemetry"
STATUS_TOPIC = "sentinelgrid/v1/devices/+/status"
FLEET_STATUS_TOPIC = "sentinelgrid/v1/fleet/status"
COMMAND_TOPIC_FMT = "sentinelgrid/v1/incidents/{incident_id}/commands"

_stop = threading.Event()
_client: mqtt.Client | None = None
_connected = threading.Event()


def _on_connect(client: mqtt.Client, _userdata, _flags, reason_code, _props=None) -> None:
    if reason_code == 0:
        log.info("connected to mqtt broker; subscribing to telemetry + status")
        client.subscribe(TELEMETRY_TOPIC, qos=0)
        client.subscribe(STATUS_TOPIC, qos=0)
        client.subscribe(FLEET_STATUS_TOPIC, qos=0)
        _connected.set()
    else:
        log.warning("mqtt connect failed: %s", reason_code)


def _on_disconnect(_client, _userdata, _flags, _reason_code, _props=None) -> None:
    _connected.clear()


def _handle_status(topic: str, raw: bytes) -> None:
    """Retained device status: sentinelgrid/v1/devices/{id}/status."""
    device_id = topic.split("/")[3]
    try:
        body = json.loads(raw)
        state = body.get("state") if isinstance(body, dict) else None
    except ValueError:
        state = raw.decode("utf-8", errors="replace").strip()
    if state not in ("online", "offline"):
        log.warning("ignoring status with unknown state on %s: %r", topic, state)
        return
    try:
        with db.get_pool().connection() as conn:
            conn.execute(
                """
                update devices
                set status = %(state)s,
                    last_seen_at = case when %(state)s = 'online'
                                        then now() else last_seen_at end
                where device_id = %(device_id)s
                """,
                {"state": state, "device_id": device_id},
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("failed to store status for %s: %s", device_id, exc)


def _handle_fleet_status(raw: bytes) -> None:
    """Bridge LWT: when the fleet publisher dies, mark online devices offline."""
    state = raw.decode("utf-8", errors="replace").strip().lower()
    if state != "offline":
        return
    try:
        with db.get_pool().connection() as conn:
            conn.execute("update devices set status = 'offline' where status = 'online'")
        log.info("fleet publisher offline; marked online devices offline")
    except Exception as exc:  # noqa: BLE001
        log.warning("failed to apply fleet offline status: %s", exc)


def _on_message(_client, _userdata, msg: mqtt.MQTTMessage) -> None:
    if msg.topic == FLEET_STATUS_TOPIC:
        _handle_fleet_status(msg.payload)
        return
    if msg.topic.endswith("/status"):
        _handle_status(msg.topic, msg.payload)
        return
    try:
        payload = TelemetryPayload.model_validate(json.loads(msg.payload))
    except (ValidationError, ValueError) as exc:
        metrics.INGEST_FAILED.labels(source="mqtt").inc()
        log.warning("dropping invalid telemetry on %s: %s", msg.topic, exc)
        return
    try:
        store_telemetry(db.get_pool(), payload)
        metrics.INGEST_TOTAL.labels(source="mqtt").inc()
    except Exception as exc:  # noqa: BLE001 - DB may be down; drop and continue
        metrics.INGEST_FAILED.labels(source="mqtt").inc()
        log.warning("failed to store telemetry from %s: %s", payload.device_id, exc)


def publish_incident_command(incident_id: int, action: str, status: str) -> bool:
    """Publish an operator action to the incident command topic (no-op offline)."""
    if _client is None or not _connected.is_set():
        return False
    payload = json.dumps(
        {
            "schema_version": "1.0",
            "incident_id": incident_id,
            "action": action,
            "status": status,
            "issued_at": datetime.now(UTC).isoformat(),
        }
    )
    try:
        _client.publish(COMMAND_TOPIC_FMT.format(incident_id=incident_id), payload, qos=1)
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("failed to publish incident command: %s", exc)
        return False


def _run() -> None:
    global _client
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2, client_id="sentinelgrid-api-ingest"
    )
    if config.mqtt_username():
        client.username_pw_set(config.mqtt_username(), config.mqtt_password())
    client.on_connect = _on_connect
    client.on_disconnect = _on_disconnect
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    _client = client

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
    _connected.clear()
