"""Environment-driven configuration for the SentinelGrid API."""
from __future__ import annotations

import os

DEFAULT_DATABASE_URL = "postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    # Tolerate SQLAlchemy-style URLs (postgresql+psycopg://...) in .env files.
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def mqtt_host() -> str:
    return os.environ.get("MQTT_HOST", "localhost")


def mqtt_port() -> int:
    return int(os.environ.get("MQTT_PORT", "1883"))


def mqtt_enabled() -> bool:
    return os.environ.get("MQTT_INGEST_ENABLED", "1") not in ("0", "false", "no")


def mqtt_username() -> str | None:
    return os.environ.get("MQTT_USERNAME") or None


def mqtt_password() -> str | None:
    return os.environ.get("MQTT_PASSWORD") or None


def api_key() -> str | None:
    """When set, write endpoints require a matching X-API-Key header."""
    return os.environ.get("SENTINELGRID_API_KEY") or None


def rate_limit_per_min() -> int:
    """Per-client-IP request budget per minute (0 disables limiting)."""
    return int(os.environ.get("SENTINELGRID_RATE_LIMIT_PER_MIN", "600"))


def stream_interval_s() -> float:
    return float(os.environ.get("SENTINELGRID_STREAM_INTERVAL_S", "2.0"))


def log_json() -> bool:
    return os.environ.get("SENTINELGRID_LOG_JSON", "0") in ("1", "true", "yes")
