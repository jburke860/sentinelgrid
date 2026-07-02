"""Webhook alert delivery for newly-opened incidents.

Disabled unless SENTINELGRID_WEBHOOK_URL is set. Fire-and-forget from the
scoring loop's perspective: one retry, ~5s timeout, every failure is logged
and swallowed. SENTINELGRID_WEBHOOK_FORMAT=slack wraps the payload for Slack
incoming webhooks; anything else posts the raw incident JSON.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

log = logging.getLogger("sentinelgrid.worker.alerts")

TIMEOUT_S = 5.0
ATTEMPTS = 2  # first try + one retry


def webhook_url() -> str | None:
    return os.environ.get("SENTINELGRID_WEBHOOK_URL") or None


def format_payload(incident: dict[str, Any]) -> dict[str, Any]:
    if os.environ.get("SENTINELGRID_WEBHOOK_FORMAT", "").lower() == "slack":
        return {
            "text": (
                f":rotating_light: {incident['incident_key']} "
                f"[{str(incident['severity']).upper()}] {incident['title']} — "
                f"device {incident['device_id']} ({incident.get('region', '?')}), "
                f"risk {incident['risk_score']}, hazard {incident['hazard']}"
            )
        }
    return {"event": "incident.opened", **incident}


def _post(url: str, body: bytes) -> int:
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
        return int(response.status)


def notify_incident(incident: dict[str, Any]) -> bool:
    """POST one just-opened incident to the configured webhook. Never raises."""
    url = webhook_url()
    if not url:
        return False
    try:
        body = json.dumps(format_payload(incident), default=str).encode()
    except Exception as exc:  # noqa: BLE001
        log.warning("webhook payload serialization failed: %s", exc)
        return False
    for attempt in range(1, ATTEMPTS + 1):
        try:
            status = _post(url, body)
            if 200 <= status < 300:
                return True
            log.warning("webhook returned HTTP %s (attempt %d/%d)", status, attempt, ATTEMPTS)
        except Exception as exc:  # noqa: BLE001
            log.warning("webhook delivery failed (attempt %d/%d): %s", attempt, ATTEMPTS, exc)
    return False
